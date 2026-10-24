import { checkSummary } from "./apply";
import { REVIEW_KINDS, type Research, type ReviewerDecision } from "./schema";
import { findQuote, type Page, type Verification } from "./verify";

/** Checks saved evidence without fetching pages, planning, or changing a decision. */
export function checkDecision(decision: ReviewerDecision, research: Research, verification: Verification, pages: ReadonlyMap<string, Page>): string[] {
  const problems: string[] = [];
  if (decision.route_id !== verification.route_id) problems.push("route_id does not match verification.json");
  if (decision.packet_sha256 !== verification.packet_sha256) problems.push("packet_sha256 does not match verification.json");

  const counts = new Map<string, number>();
  for (const c of [...research.claims, ...decision.reviewer_claims]) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  for (const [id, count] of counts) if (count > 1) problems.push(`claim id ${id} repeats`);
  // A repeated id is never usable: an unchecked quote cannot shadow a checked one.
  const usable = new Map<string, { source_url: string; quote: string }>();
  for (const c of research.claims) {
    const checks = verification.claims.filter(check => check.id === c.id);
    if (counts.get(c.id) === 1 && checks.length === 1 && checks[0].status.startsWith("verified") && checks[0].source_url === c.source_url) usable.set(c.id, c);
  }
  for (const c of decision.reviewer_claims) {
    const page = pages.get(c.source_url);
    if (!page || page.status !== "ok" || !findQuote(c.quote, page.text)) {
      problems.push(`reviewer_claims.${c.id}: quote is not on its saved page`);
    } else if (counts.get(c.id) === 1) {
      usable.set(c.id, c);
    }
  }

  const checkBasis = (path: string, ids: string[]) => {
    for (const id of ids) if (!usable.has(id)) problems.push(`${path}: claim ${id} is not verified`);
  };
  for (const [index, label] of decision.labels.entries()) {
    if (!(REVIEW_KINDS as readonly string[]).includes(label.kind)) problems.push(`labels.${index}: unknown kind ${label.kind}`);
    checkBasis(`labels.${index}.basis`, label.basis);
    // Josiah's rule: a scramble needs two publishers. Count distinct sites behind the label.
    if (label.kind === "scramble") {
      const hosts = new Set(label.basis.map(id => usable.get(id)?.source_url).filter((u): u is string => !!u).map(u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }));
      if (hosts.size < 2) problems.push(`labels.${index}: a scramble needs claims from two publishers (has ${hosts.size})`);
    }
    if (label.kind === "climb" && !label.basis.some(id => /\b5\.\d|class 5|fifth class|5th class|\blow[ -]?(?:5(?![\d,.])|fifth)/i.test(usable.get(id)?.quote ?? "")))
      problems.push(`labels.${index}: a climb needs a basis quote with a stated 5th-class rating`);
  }
  checkBasis("summary_basis", decision.summary_basis);

  const summaryUrls = new Set(decision.summary_basis.map(id => usable.get(id)?.source_url).filter((url): url is string => !!url));
  for (const source of decision.summary?.sources ?? []) if (!summaryUrls.has(source.url)) problems.push(`summary.sources: ${source.url} has no summary basis claim`);
  try { checkSummary(decision.summary); }
  catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }

  for (const [index, interval] of decision.apply.entries()) {
    if (!(REVIEW_KINDS as readonly string[]).includes(interval.kind)) problems.push(`apply.${index}: unknown kind ${interval.kind}`);
    if (interval.kind === "hold" && interval.display_name != null) problems.push(`apply.${index}: a hold cannot have a display_name`);
    if (interval.kind === "hold" && !decision.labels.some(label => label.kind === "hold" && label.basis.length > 0))
      problems.push(`apply.${index}: a hold needs a label of kind hold citing the source that suggests hands`);
    if (["scramble", "climb", "climbers_route"].includes(interval.kind) && !decision.labels.some(label => label.kind === interval.kind && label.basis.length > 0))
      problems.push(`apply.${index}: ${interval.kind} needs a label of the same kind with a non-empty basis`);
  }
  return problems;
}

/**
 * A page cut down for a reviewer: its opening (title, route summary) plus a window around each
 * cited quote, in page order, joined with a gap marker. Short pages pass through whole.
 */
export function excerptPage(text: string, quotes: string[], window = 2500, head = 2000, cap = 24000): string {
  if (text.length <= cap) return text;
  // Work on whitespace-collapsed text so search positions and slices agree; quote checks ignore whitespace.
  const flat = text.replace(/\s+/g, " "), lower = flat.toLowerCase(), spans: [number, number][] = [[0, head]];
  for (const quote of quotes) {
    const probe = quote.toLowerCase().replace(/\s+/g, " ").slice(0, 60).trim();
    const at = probe ? lower.indexOf(probe) : -1;
    if (at >= 0) spans.push([Math.max(0, at - window), Math.min(flat.length, at + quote.length + window)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]); }
  return merged.map(([a, b]) => flat.slice(a, b)).join("\n[…]\n").slice(0, cap);
}
