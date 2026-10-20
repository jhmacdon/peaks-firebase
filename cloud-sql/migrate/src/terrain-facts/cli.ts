import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { buildPacket, packetSha256, type Packet } from "./packet";
import { fetchPages } from "./fetch-pages";
import { researchSchema, type Research } from "./schema";
import { verify, type Verification } from "./verify";

/**
 * Route terrain facts, one route per run directory:
 *
 *   packet    read the route from production (read-only) into packet.json
 *   research  one Codex researcher, live web search, schema-bound answer
 *   verify    fetch every cited page, check quotes and citations, write review.md
 *
 * See TERRAIN-FACTS.md. Nothing here writes to the database.
 */

const MODEL = process.env.TERRAIN_MODEL ?? "gpt-6.1-sol";
const EFFORT = process.env.TERRAIN_EFFORT ?? "ultra";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function need(name: string): string {
  const v = arg(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
}
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8"));

async function packetCommand() {
  const routeId = need("route"), dir = resolve(need("dir"));
  if (existsSync(join(dir, "packet.json"))) throw new Error(`${dir} already has a packet; use a new run directory`);
  const db = new Pool({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || "peaks", user: process.env.DB_USER || "peaks-api", password: process.env.DB_PASS, max: 1 });
  try {
    await db.query("SET default_transaction_read_only = on");
    const packet = await buildPacket(db, routeId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "packet.json"), JSON.stringify(packet, null, 2) + "\n");
    console.log(`${packet.route_name}: ${packet.stretches.length} stretches, ${packet.waypoints.length} waypoints, ${(packet.length_m / 1000).toFixed(1)} km\npacket ${packetSha256(packet)}`);
  } finally { await db.end(); }
}

async function researchCommand() {
  const dir = resolve(need("dir"));
  if (existsSync(join(dir, "research.json"))) throw new Error(`${dir} already has research; use a new run directory`);
  const packet = await readJson<Packet>(join(dir, "packet.json"));
  const prompt = (await readFile(join(__dirname, "researcher-prompt.md"), "utf8"))
    + `\n\n<packet sha256="${packetSha256(packet)}">\n${JSON.stringify(packet, null, 1)}\n</packet>\n`;
  await writeFile(join(dir, "prompt.md"), prompt);
  await writeFile(join(dir, "research-schema.json"), JSON.stringify(researchSchema, null, 2));
  // An empty working root: the researcher has nothing local to read and the sandbox is read-only.
  const cwd = await mkdtemp(join(tmpdir(), "terrain-research-"));
  const argv = ["exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
    "-s", "read-only", "-C", cwd, "-m", MODEL,
    "-c", `model_reasoning_effort="${EFFORT}"`, "-c", `web_search="live"`, "-c", "project_doc_max_bytes=0",
    "--output-schema", join(dir, "research-schema.json"), "-o", join(dir, "research.raw.json"), "--json", "-"];
  console.log(`codex ${MODEL} (${EFFORT}) researching ${packet.route_name} ...`);
  const events = createWriteStream(join(dir, "events.jsonl"));
  const code = await new Promise<number>((done, fail) => {
    const child = spawn("codex", argv, { cwd, stdio: ["pipe", "pipe", "inherit"] });
    child.stdout.pipe(events);
    child.on("error", fail);
    child.on("close", c => done(c ?? 1));
    child.stdin.end(prompt);
  });
  if (code !== 0) throw new Error(`codex exited ${code}; see ${join(dir, "events.jsonl")}`);
  const research: Research = JSON.parse(await readFile(join(dir, "research.raw.json"), "utf8"));
  await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2) + "\n");
  console.log(`${research.claims.length} claims, ${research.features.length} features, ${research.sources_consulted.length} pages opened`);
}

async function verifyCommand() {
  const dir = resolve(need("dir"));
  const packet = await readJson<Packet>(join(dir, "packet.json"));
  const research = await readJson<Research>(join(dir, "research.json"));
  const pages = await fetchPages(research.claims.map(c => c.source_url), join(dir, "pages"), line => console.log(line));
  const result = verify(packet, packetSha256(packet), research, pages);
  await writeFile(join(dir, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  await writeFile(join(dir, "review.md"), reviewSheet(packet, research, result));
  const bad = result.findings.filter(f => !f.ok).length, verified = result.claims.filter(c => c.status.startsWith("verified")).length;
  console.log(`${verified}/${result.claims.length} quotes verified; ${bad} findings fail; ${result.structural.length} structural problems\n${join(dir, "review.md")}`);
}

/** One page a reviewer reads top to bottom: each finding, then each quote with its check. */
export function reviewSheet(packet: Packet, research: Research, v: Verification): string {
  const check = new Map(v.claims.map(c => [c.id, c]));
  const lines = [`# ${packet.route_name} — terrain review`, "", `Route \`${packet.route_id}\`, packet \`${v.packet_sha256.slice(0, 12)}\`. Checker: **${v.ok ? "all checks pass" : "has failures"}**.`, ""];
  if (v.structural.length) lines.push("## Structural problems", "", ...v.structural.map(s => `- ${s}`), "");
  lines.push("## Stretches", "", "| Stretch | Name | km | ft | Terrain | Claims |", "|---|---|---|---|---|---|");
  for (const s of packet.stretches) {
    const f = research.stretches.find(x => x.stretch_id === s.id);
    lines.push(`| ${s.id} | ${s.name ?? "—"} | ${(s.start_m / 1000).toFixed(2)}–${(s.end_m / 1000).toFixed(2)} | ${s.start_ft ?? "?"}→${s.end_ft ?? "?"} | ${f?.terrain ?? "missing"} | ${f?.claim_ids.join(", ") ?? ""} |`);
  }
  lines.push("", "## Route", "");
  for (const [k, val] of Object.entries(research.route)) lines.push(`- **${k}**: ${val.value} ${val.claim_ids.length ? `(${val.claim_ids.join(", ")})` : ""}`);
  lines.push("", "## Features", "");
  for (const f of research.features) {
    const loc = v.locations[f.id];
    lines.push(`### ${f.id}: ${f.type}, class ${f.yds_class}, hands ${f.hands}${f.conflicting ? " — CONFLICTING" : ""}`, "",
      `- Where: ${f.location.anchor}${f.location.waypoint_id ? ` ${f.location.waypoint_id}` : ""}${f.location.stretch_ids.length ? ` ${f.location.stretch_ids.join(",")}` : ""}${f.location.from_ft != null ? ` ${f.location.from_ft}–${f.location.to_ft} ft` : ""} — ${f.location.note}`,
      `- Resolves to: ${loc ? `${(loc.start_m / 1000).toFixed(2)}–${(loc.end_m / 1000).toFixed(2)} km (${loc.how})` : "no interval"}`,
      `- Season: ${f.season ?? "—"}; claims ${f.claim_ids.join(", ")}; place claims ${f.location.claim_ids.join(", ")}`, `- Note: ${f.note}`, "");
  }
  const failing = v.findings.filter(f => !f.ok);
  lines.push("## Failed findings", "", ...(failing.length ? failing.map(f => `- \`${f.path}\` = ${f.value}: ${f.problems.join("; ")}`) : ["None."]), "");
  lines.push("## Claims", "");
  for (const c of research.claims) {
    const k = check.get(c.id)!;
    lines.push(`**${c.id}** · ${k.status} · ${c.publisher} (${c.source_type}) · ${c.source_url}${k.detail ? ` · ${k.detail}` : ""}`, "", `> ${c.quote}`, "", `Establishes: ${c.establishes}`, "");
  }
  if (research.unknowns.length) lines.push("## Unknowns", "", ...research.unknowns.map(s => `- ${s}`), "");
  if (research.conflicts.length) lines.push("## Conflicts", "", ...research.conflicts.map(s => `- ${s}`), "");
  lines.push("## Pages opened", "", ...research.sources_consulted.map(s => `- ${s}`), "");
  return lines.join("\n");
}

const commands: Record<string, () => Promise<void>> = { packet: packetCommand, research: researchCommand, verify: verifyCommand };
const command = commands[process.argv[2] ?? ""];
if (!command) { console.error("usage: terrain-facts <packet|research|verify> --dir <run dir> [--route <id>]"); process.exit(2); }
command().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
