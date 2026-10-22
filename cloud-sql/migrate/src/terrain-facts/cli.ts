import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { buildPacket, packetSha256, type Packet } from "./packet";
import { fetchPages } from "./fetch-pages";
import { researchSchema, reviewerDecisionSchema, type Research, type ReviewerDecision } from "./schema";
import { verify, type Page, type Verification } from "./verify";
import { applyPlan, checkSummary, loadRoute, plan, sha, type Decision, type Plan } from "./apply";
import { checkDecision, excerptPage } from "./review-check";
import { comparePlans } from "./review-compare";

/**
 * Route terrain facts, one route per run directory:
 *
 *   packet    read the route from production (read-only) into packet.json
 *   research  one Codex researcher, live web search, schema-bound answer
 *   verify    fetch every cited page, check quotes and citations, write review.md
 *   review    two separate Codex reviewers, saved pages only
 *   compare   check both decisions and read-only plans; pass or send to a person
 *
 * See TERRAIN-FACTS.md. Nothing here writes to the database.
 */

const MODEL = process.env.TERRAIN_MODEL ?? "gpt-6.1-sol";
const EFFORT = process.env.TERRAIN_EFFORT ?? "ultra";
/** Reviewers read saved pages only; ultra's parallel helpers add cost there without new evidence. */
const REVIEW_EFFORT = process.env.TERRAIN_REVIEW_EFFORT ?? "high";

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

/** The route read retries on a dropped connection: a busy shared db-f1-micro resets idle sockets. */
async function loadRouteRetry(db: Pool, routeId: string): ReturnType<typeof loadRoute> {
  for (let attempt = 1; ; attempt++) {
    try { return await loadRoute(db, routeId); }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt >= 5 || !/ECONNRESET|Connection terminated|timeout|ETIMEDOUT|EPIPE/i.test(msg)) throw error;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
}

async function packetCommand() {
  const routeId = need("route"), dir = resolve(need("dir"));
  if (existsSync(join(dir, "packet.json"))) throw new Error(`${dir} already has a packet; use a new run directory`);
  const db = pool();
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
  // A focus run answers one open question from review: where hands are needed, or whether.
  const focus = arg("focus");
  const prompt = (await readFile(join(__dirname, "researcher-prompt.md"), "utf8"))
    + (focus ? `\n\n## Focus question\n\nA reviewer could not settle this from a first round of research. Answer it above all else, with the same rules for quotes. Look especially for guidebooks, land-agency pages and route pages, which count for more than trip reports. If nothing settles it, say so in \`unknowns\`.\n\n${focus}\n` : "")
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

async function reviewCommand() {
  const dir = resolve(need("dir")), as = need("as");
  if (as !== "a" && as !== "b") throw new Error("--as must be a or b");
  const output = join(dir, `decision.${as}.json`), raw = join(dir, `decision.${as}.raw.json`);
  if (existsSync(output)) throw new Error(`${output} already exists; use a new run directory`);
  let prompt = await readFile(join(__dirname, "reviewer-prompt.md"), "utf8");
  const schema = join(dir, `review-schema.${as}.json`), eventFile = join(dir, `events.review-${as}.jsonl`);
  await writeFile(schema, JSON.stringify(reviewerDecisionSchema, null, 2));
  // Config docs: https://learn.chatgpt.com/docs/config-file/config-basic#web-search-mode
  // "disabled" turns off the web search tool.
  // Each reviewer reads a fresh copy of the inputs only, so neither sees the other's decision.
  const work = await mkdtemp(join(tmpdir(), `terrain-review-${as}-`));
  for (const name of ["review.md", "packet.json", "research.json", "verification.json", "pages"])
    await cp(join(dir, name), join(work, name), { recursive: true });
  // Reviewers get each page's opening and the text around every cited quote, not whole pages
  // (most of a page is navigation and comments). checkDecision still reads the full pages.
  const research = await readJson<Research>(join(dir, "research.json"));
  for (const file of (await readdir(join(work, "pages"))).filter(f => f.endsWith(".json"))) {
    const page = await readJson<Page>(join(work, "pages", file));
    const quotes = research.claims.filter(c => c.source_url === page.url).map(c => c.quote);
    page.text = excerptPage(page.text ?? "", quotes);
    await writeFile(join(work, "pages", file), JSON.stringify(page));
  }
  // Inline every input so the review is one pass: each shell read would resend the whole context.
  const block = async (name: string) => `<file name="${name}">\n${await readFile(join(work, name), "utf8")}\n</file>`;
  const pageBlocks = await Promise.all((await readdir(join(work, "pages"))).filter(f => f.endsWith(".json")).sort().map(f => block(join("pages", f))));
  prompt += "\n\n## Inputs\n\nEvery input file is below; do not run commands to read them again.\n\n"
    + [await block("review.md"), await block("packet.json"), await block("research.json"), await block("verification.json"), ...pageBlocks].join("\n\n");
  const argv = ["exec", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
    "-s", "read-only", "-C", work, "-m", MODEL,
    "-c", `model_reasoning_effort="${REVIEW_EFFORT}"`, "-c", `web_search="disabled"`, "-c", "project_doc_max_bytes=0",
    "--output-schema", schema, "-o", raw, "--json", "-"];
  console.log(`codex ${MODEL} (${REVIEW_EFFORT}) reviewing as ${as} ...`);
  const events = createWriteStream(eventFile);
  const code = await new Promise<number>((done, fail) => {
    const child = spawn("codex", argv, { cwd: work, stdio: ["pipe", "pipe", "inherit"] });
    events.on("error", fail);
    child.stdout.pipe(events);
    child.on("error", error => { events.end(); fail(error); });
    child.on("close", c => events.end(() => done(c ?? 1)));
    child.stdin.on("error", fail);
    child.stdin.end(prompt);
  });
  await rm(work, { recursive: true, force: true });
  if (code !== 0) throw new Error(`codex exited ${code}; see ${eventFile}`);
  const decision = await readJson<ReviewerDecision>(raw);
  // A hold keeps the segment as it is, so a name on it means nothing; drop it rather than fail the plan.
  for (const interval of decision.apply) if (interval.kind === "hold") interval.display_name = null;
  // Identifiers come from the files, not the model's retyping (one review dropped two hex digits).
  const ver = await readJson<Verification>(join(dir, "verification.json"));
  decision.route_id = ver.route_id; decision.packet_sha256 = ver.packet_sha256;
  // A hold needs a source suggesting hands. Reviewers still hold stretches that no source describes;
  // drop those holds (the stretch keeps its mapped kind) instead of sending the route to a person.
  if (decision.apply.some(i => i.kind === "hold") && !decision.labels.some(l => l.kind === "hold" && l.basis.length > 0)) {
    decision.apply = decision.apply.filter(i => i.kind !== "hold");
    decision.labels = decision.labels.filter(l => l.kind !== "hold");
    decision.open = [...decision.open.map(o => o.replace(/^HOLD:/, "Undescribed (hold dropped, no source suggests hands):")),];
  }
  await writeFile(output, JSON.stringify(decision, null, 2) + "\n", { flag: "wx" });
  console.log(output);
}

async function compareCommand() {
  const dir = resolve(need("dir"));
  const a = await readJson<ReviewerDecision>(join(dir, "decision.a.json"));
  const b = await readJson<ReviewerDecision>(join(dir, "decision.b.json"));
  const research = await readJson<Research>(join(dir, "research.json"));
  const verification = await readJson<Verification>(join(dir, "verification.json"));
  const pages = new Map<string, Page>();
  for (const file of (await readdir(join(dir, "pages"))).filter(f => f.endsWith(".json"))) {
    const page = await readJson<Page>(join(dir, "pages", file));
    pages.set(page.url, page);
  }
  const check = (decision: ReviewerDecision): string[] => {
    try { return checkDecision(decision, research, verification, pages); }
    catch (error) { return [`invalid decision: ${error instanceof Error ? error.message : String(error)}`]; }
  };
  const aProblems = check(a), bProblems = check(b);
  let aPlan: Plan | null = null, bPlan: Plan | null = null;
  const db = pool();
  try {
    await db.query("SET default_transaction_read_only = on");
    const { rows, sharedWith, held } = await loadRouteRetry(db, verification.route_id);
    const makePlan = (decision: ReviewerDecision, problems: string[]): Plan | null => {
      try { return plan(verification.route_id, rows, decision, sharedWith, held); }
      catch (error) { problems.push(`plan failed: ${error instanceof Error ? error.message : String(error)}`); return null; }
    };
    aPlan = makePlan(a, aProblems);
    bPlan = makePlan(b, bProblems);
  } catch (error) {
    const problem = `could not read route: ${error instanceof Error ? error.message : String(error)}`;
    aProblems.push(problem); bProblems.push(problem);
  } finally { await db.end(); }
  const result = comparePlans(aPlan, bPlan, aProblems, bProblems);
  await writeFile(join(dir, "compare.json"), JSON.stringify(result, null, 2) + "\n");
  if (result.agree && !result.escalate) {
    const chosen = result.prefer === "b" ? b : a;
    const decision = { ...chosen, reviewed_by: `codex reviewer ${result.prefer}; reviewer ${result.prefer === "a" ? "b" : "a"} agreed`,
      default: "Unlabelled stretches keep mapped kinds; unbacked scramble/climb reset to trail." };
    try { await writeFile(join(dir, "decision.json"), JSON.stringify(decision, null, 2) + "\n", { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  console.log(`${result.escalate ? "ESCALATE" : "AGREE"}: ${(result.reasons.join("; ") || "checks and intervals agree").replace(/\s+/g, " ")}`);
}

/** One page a reviewer reads top to bottom: each finding, then each quote with its check. */
export function reviewSheet(packet: Packet, research: Research, v: Verification): string {
  const check = new Map(v.claims.map(c => [c.id, c]));
  const lines = [`# ${packet.route_name} — terrain review`, "", `Route \`${packet.route_id}\`, packet \`${v.packet_sha256.slice(0, 12)}\`. Checker: **${v.ok ? "all checks pass" : "has failures"}**.`, ""];
  if (v.structural.length) lines.push("## Structural problems", "", ...v.structural.map(s => `- ${s}`), "");
  lines.push("## Stretches", "", "| Stretch | Name | km | ft | Steepest 50 m | Terrain | Claims |", "|---|---|---|---|---|---|---|");
  for (const s of packet.stretches) {
    const f = research.stretches.find(x => x.stretch_id === s.id);
    const steep = s.steepest_50m ? `${s.steepest_50m.grade_pct}% at ${(s.steepest_50m.at_m / 1000).toFixed(2)} km` : "—";
    lines.push(`| ${s.id} | ${s.name ?? "—"} | ${(s.start_m / 1000).toFixed(2)}–${(s.end_m / 1000).toFixed(2)} | ${s.start_ft ?? "?"}→${s.end_ft ?? "?"} | ${steep} | ${f?.terrain ?? "missing"} | ${f?.claim_ids.join(", ") ?? ""} |`);
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

function pool() {
  return new Pool({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || "peaks", user: process.env.DB_USER || "peaks-api", password: process.env.DB_PASS, max: 1 });
}

/** Dry run prints the plan and its hash; `--apply --expected-plan <hash>` writes exactly that plan. */
async function applyCommand() {
  const dir = resolve(need("dir")), write = process.argv.includes("--apply");
  const decision = await readJson<Decision & { reviewed_by: string; labels?: { basis: string[] }[]; reviewer_claims?: { id: string; source_url: string }[] }>(join(dir, "decision.json"));
  if (!Array.isArray(decision.apply)) throw new Error("decision.json has no apply intervals");
  const research = await readJson<Research>(join(dir, "research.json"));
  const packet = await readJson<Packet>(join(dir, "packet.json"));
  if (decision.packet_sha256 !== packetSha256(packet)) throw new Error("decision is for another packet");
  const urls = new Map([...research.claims, ...(decision.reviewer_claims ?? [])].map(c => [c.id, c.source_url]));
  const sources = [...new Set((decision.labels ?? []).flatMap(l => l.basis).map(id => urls.get(id)).filter((u): u is string => !!u))];
  const db = pool();
  try {
    // A decision whose split already ran names segments that are gone; its summary can still land alone.
    if (process.argv.includes("--summary-only")) {
      const summary = checkSummary(decision.summary);
      if (!summary) throw new Error("decision has no summary");
      if (!write) { console.log(`summary: ${summary.line}`); return; }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT refresh_route_terrain($1)`, [[decision.route_id]]);
        await client.query(`UPDATE routes SET terrain_summary = $2::jsonb WHERE id = $1`, [decision.route_id, JSON.stringify({ ...summary, reviewed_at: new Date().toISOString().slice(0, 10) })]);
        await client.query("COMMIT");
        console.log(`summary applied to ${decision.route_id}`);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      return;
    }
    const { rows, sharedWith, held } = await loadRouteRetry(db, decision.route_id);
    const p = plan(decision.route_id, rows, decision, sharedWith, held), hash = sha(p);
    await writeFile(join(dir, write ? "apply-plan.applied.json" : "apply-plan.json"), JSON.stringify({ hash, ...p }, null, 2) + "\n");
    for (const flag of p.flags) console.log(`flag   ${flag}`);
    for (const op of p.ops) console.log(op.op === "kind" ? `kind   ${op.segment_id} ${op.from} -> ${op.to}${op.display_name ? ` "${op.display_name}"` : ""} (${op.route_m.join("-")} m)` : `split  ${op.segment_id} at ${op.cuts_m.join(", ")} m -> ${op.pieces.map(x => `${x.kind}${x.display_name ? ` "${x.display_name}"` : ""} ${x.length_m} m`).join(" | ")}`);
    if (p.holds.add.length || p.holds.clear.length) console.log(`holds: +${p.holds.add.length} -${p.holds.clear.length}${p.holds.clear.length ? ` (settles ${p.holds.clear.join(", ")})` : ""}`);
    if (p.shared_with.length) console.log(`shared with ${p.shared_with.length} other routes: ${p.shared_with.join(", ")}`);
    console.log(`plan ${hash}`);
    if (!write) return;
    if (arg("expected-plan") !== hash) throw new Error("--expected-plan does not match this plan; review the dry run first");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const routes = await applyPlan(client, p, { plan_sha256: hash, reviewed_by: decision.reviewed_by, sources, hold_question: (decision as any).open?.find((o: string) => o.startsWith("HOLD:")) });
      await client.query("COMMIT");
      console.log(`applied; routes touched: ${routes.join(", ")}`);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } finally { await db.end(); }
}

const commands: Record<string, () => Promise<void>> = { packet: packetCommand, research: researchCommand, verify: verifyCommand, review: reviewCommand, compare: compareCommand, apply: applyCommand };
const command = commands[process.argv[2] ?? ""];
if (!command) { console.error("usage: terrain-facts <packet|research|verify|review|compare|apply> --dir <run dir> [--route <id>] [--focus <question>] [--as <a|b>] [--apply --expected-plan <hash>] [--summary-only]"); process.exit(2); }
command().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
