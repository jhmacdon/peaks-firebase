// Dedupe destinations that have been double-imported from OSM (or other
// sources) — same normalized name, same state, geographically clustered
// within --threshold meters. Picks a canonical row per cluster (lowest id,
// deterministic), reassigns FK references from the duplicates to the
// canonical, merges external_ids, and deletes the duplicates.
//
// Connected-components clustering at the threshold so a chain of close
// rows merges as one even when the chain spans >threshold end-to-end
// (e.g., six entries strung along a 400m creek with each adjacent pair
// within 200m). Distinct same-name destinations far apart (e.g., the four
// "Buttermilk Falls" in NY scattered statewide) stay separate because no
// edge connects their components.
//
// Usage:
//   tsx src/dedupe-destinations.ts --feature=waterfall --threshold=200 [--dry-run]
//   tsx src/dedupe-destinations.ts --feature=waterfall                 # 200m default
//
// Re-runnable. After dedupe, future bulk imports should also dedupe on
// entry — see --dedupe-by-proximity in import-osm-waterfalls-wa.ts.

import db from "./db";

type Candidate = {
  id: string;
  norm_name: string;
  state_code: string | null;
  lat: number;
  lng: number;
  external_ids: Record<string, unknown> | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const feature = args.find((a) => a.startsWith("--feature="))?.slice("--feature=".length);
  const thresholdStr = args.find((a) => a.startsWith("--threshold="))?.slice("--threshold=".length);
  const dryRun = args.includes("--dry-run");
  if (!feature) {
    throw new Error("--feature=<destination_feature> required (e.g. --feature=waterfall)");
  }
  const threshold = thresholdStr ? parseFloat(thresholdStr) : 200;
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(`Invalid --threshold: ${thresholdStr}`);
  }
  return { feature, threshold, dryRun };
}

// Haversine — same-state same-name candidates only span tens of km in the
// worst case, so spherical math is fine; no need to round-trip through PostGIS.
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    let cur = x;
    while ((this.parent.get(cur) ?? cur) !== cur) cur = this.parent.get(cur)!;
    // Path compression
    let walker = x;
    while (walker !== cur) {
      const next = this.parent.get(walker) ?? walker;
      this.parent.set(walker, cur);
      walker = next;
    }
    return cur;
  }
  union(a: string, b: string) {
    // Track both endpoints in parent so component extraction can find roots
    // (otherwise winner ids stay outside parent and get skipped).
    if (!this.parent.has(a)) this.parent.set(a, a);
    if (!this.parent.has(b)) this.parent.set(b, b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Deterministic: lower id becomes root so canonical selection is stable.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

async function loadCandidates(feature: string): Promise<Candidate[]> {
  const res = await db.query<{
    id: string;
    norm_name: string;
    state_code: string | null;
    lat: string;
    lng: string;
    external_ids: Record<string, unknown> | null;
  }>(
    `SELECT id,
            lower(trim(name)) AS norm_name,
            state_code,
            ST_Y(location::geometry)::text AS lat,
            ST_X(location::geometry)::text AS lng,
            external_ids
     FROM destinations
     WHERE $1::destination_feature = ANY(features)
       AND name IS NOT NULL
       AND trim(name) <> ''
       AND location IS NOT NULL`,
    [feature]
  );
  return res.rows.map((r) => ({
    id: r.id,
    norm_name: r.norm_name,
    state_code: r.state_code,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lng),
    external_ids: r.external_ids,
  }));
}

function clusterByProximity(rows: Candidate[], thresholdM: number): Map<string, string[]> {
  // Group by (norm_name, state_code) first — two rows can only be merged if
  // they share both. Then within each group, run union-find on edges where
  // distance ≤ threshold.
  const byKey = new Map<string, Candidate[]>();
  for (const r of rows) {
    const key = `${r.norm_name}|${r.state_code ?? ""}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const uf = new UnionFind();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      uf.find(group[i].id); // ensure tracked even if no edges
      for (let j = i + 1; j < group.length; j++) {
        const d = distanceM(group[i].lat, group[i].lng, group[j].lat, group[j].lng);
        if (d <= thresholdM) uf.union(group[i].id, group[j].id);
      }
    }
  }

  // Bucket by canonical root. Only return components with >1 member.
  const components = new Map<string, string[]>();
  for (const r of rows) {
    if (!uf.parent.has(r.id)) continue; // never touched (singleton group)
    const root = uf.find(r.id);
    const list = components.get(root);
    if (list) list.push(r.id);
    else components.set(root, [r.id]);
  }
  for (const [root, members] of components) {
    if (members.length < 2) components.delete(root);
  }
  return components;
}

async function mergeCluster(
  canonical: Candidate,
  duplicates: Candidate[]
): Promise<void> {
  const dupIds = duplicates.map((d) => d.id);

  // Reassign FK rows from each dup → canonical, ON CONFLICT DO NOTHING so
  // pre-existing canonical rows win on duplicate composite keys.
  // INSERT before DELETE so the cascading delete on destinations doesn't
  // wipe the relations we just preserved.
  const fkTables = [
    { table: "session_destinations", parentCol: "session_id", extraCols: "relation, source", extraVals: "relation, source" },
    { table: "list_destinations", parentCol: "list_id", extraCols: "ordinal", extraVals: "ordinal" },
    { table: "route_destinations", parentCol: "route_id", extraCols: "ordinal", extraVals: "ordinal" },
    { table: "plan_destinations", parentCol: "plan_id", extraCols: "ordinal", extraVals: "ordinal" },
  ];

  for (const fk of fkTables) {
    await db.query(
      `INSERT INTO ${fk.table} (${fk.parentCol}, destination_id, ${fk.extraCols})
       SELECT ${fk.parentCol}, $1::text, ${fk.extraVals}
       FROM ${fk.table}
       WHERE destination_id = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [canonical.id, dupIds]
    );
  }

  // Merge external_ids: union of canonical + every dup. Canonical wins on
  // key collision (so the OSM ID we already trust stays put).
  const mergedExternal: Record<string, unknown> = {};
  for (const d of duplicates) {
    if (d.external_ids) Object.assign(mergedExternal, d.external_ids);
  }
  if (canonical.external_ids) Object.assign(mergedExternal, canonical.external_ids);

  await db.query(
    `UPDATE destinations
       SET external_ids = $2::jsonb,
           updated_at = NOW()
     WHERE id = $1`,
    [canonical.id, JSON.stringify(mergedExternal)]
  );

  // Drop the duplicate destination rows. Cascade cleans up any FK rows
  // we couldn't preserve due to ON CONFLICT (canonical already had the same
  // composite key).
  await db.query(`DELETE FROM destinations WHERE id = ANY($1::text[])`, [dupIds]);
}

async function main() {
  const { feature, threshold, dryRun } = parseArgs();
  console.log(`Dedup destinations: feature=${feature} threshold=${threshold}m dryRun=${dryRun}`);

  const rows = await loadCandidates(feature);
  console.log(`  Loaded ${rows.length} candidate rows`);

  const components = clusterByProximity(rows, threshold);
  console.log(`  Found ${components.size} dedup clusters`);

  if (components.size === 0) {
    console.log("Nothing to do.");
    return;
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  let totalDeleted = 0;
  let totalKept = 0;
  let printed = 0;

  for (const [root, ids] of components) {
    const sortedIds = [...ids].sort();
    const canonicalId = sortedIds[0]; // lowest id = stable winner; matches union-find root
    if (canonicalId !== root) {
      throw new Error(`Internal: root ${root} != lowest id ${canonicalId} in cluster`);
    }
    const canonical = byId.get(canonicalId)!;
    const duplicates = sortedIds.slice(1).map((id) => byId.get(id)!);

    if (printed < 15) {
      const sample = `${canonical.norm_name} (${canonical.state_code ?? "—"})`;
      console.log(`  cluster: ${sample} — keep ${canonical.id}, drop ${duplicates.length}`);
      for (const d of duplicates) {
        const dM = Math.round(distanceM(canonical.lat, canonical.lng, d.lat, d.lng));
        console.log(`    drop ${d.id}  (${dM}m from canonical)`);
      }
      printed++;
    } else if (printed === 15) {
      console.log(`  ...(${components.size - 15} more clusters)`);
      printed++;
    }

    totalKept += 1;
    totalDeleted += duplicates.length;

    if (!dryRun) await mergeCluster(canonical, duplicates);
  }

  console.log("");
  console.log(dryRun ? "Dedup (dry-run) summary:" : "Dedup complete:");
  console.log(`  Clusters: ${components.size}`);
  console.log(`  Rows kept (canonical): ${totalKept}`);
  console.log(`  Rows ${dryRun ? "would-be" : ""} deleted: ${totalDeleted}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
