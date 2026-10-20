import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { htmlToText, type Page } from "./verify";

/**
 * Fetches each cited page once and keeps its text beside the run, so a review
 * reads the same words the checker matched.
 *
 * Plain HTTPS goes through the route factory's pinned-address fetcher. A site
 * that refuses scripts but serves a normal browser gets one headless Chromium
 * load. A bot check or captcha is a block: it is reported, never worked around.
 */

const CHALLENGE = /performing security verification|verify you are (?:a )?human|checking your browser|just a moment\.\.\.|enable javascript and cookies|captcha|access denied|attention required/i;
const PER_HOST_GAP_MS = 2_000;

type PublicFetch = (url: string) => Promise<{ status: number; body: string; content_type?: string | null }>;

async function publicFetch(): Promise<PublicFetch> {
  const root = resolve(__dirname, "../../../..");
  const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<{ fetchPublicPage: PublicFetch }>;
  return (await nativeImport(pathToFileURL(resolve(root, ".agents/skills/peaks-route-factory/scripts/build_route_review_packet.mjs")).href)).fetchPublicPage;
}

export function chromiumPath(): string | null {
  if (process.env.TERRAIN_BROWSER) return process.env.TERRAIN_BROWSER;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const app = join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(app)) return app;
  }
  return null;
}

async function browserText(url: string): Promise<{ status: number | null; text: string }> {
  const executablePath = chromiumPath();
  if (!executablePath) throw new Error("no Chromium for the browser fallback; set TERRAIN_BROWSER");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3_000);
    return { status: response?.status() ?? null, text: (await page.innerText("body")).replace(/\s+/g, " ").trim() };
  } finally { await browser.close(); }
}

const PDF_LIMIT = 40_000_000;

/** Agency route briefs are PDFs. Text comes from poppler's pdftotext, which reads but never runs a file. */
async function pdfText(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000), headers: { "user-agent": "PeaksRouteReviewer/1.0" } });
  if (!response.ok) return { status: response.status, text: "" };
  if (new URL(response.url).protocol !== "https:") throw new Error("PDF redirected off HTTPS");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > PDF_LIMIT) throw new Error(`PDF is over ${PDF_LIMIT / 1e6} MB`);
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("not a PDF");
  const file = join(tmpdir(), `terrain-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.pdf`);
  await writeFile(file, bytes);
  const { stdout } = await promisify(execFile)("pdftotext", ["-enc", "UTF-8", "-nopgbrk", file, "-"], { maxBuffer: 50_000_000, timeout: 60_000 });
  return { status: response.status, text: stdout.replace(/-\n(?=[a-z])/g, "").replace(/\s+/g, " ").trim() };
}

function blocked(status: number | null, text: string): boolean {
  return status === 401 || status === 403 || status === 429 || (text.length < 4_000 && CHALLENGE.test(text));
}

export async function fetchPage(url: string, fetcher: PublicFetch): Promise<Page> {
  const target = url.replace(/^http:\/\//i, "https://");
  let httpStatus: number | null = null, note = "";
  if (/\.pdf(?:$|[?#])/i.test(new URL(target).pathname + new URL(target).search)) {
    try {
      const { status, text } = await pdfText(target);
      if (status >= 200 && status < 300 && text) return { url, status: "ok", http_status: status, via: "https", text, error: null };
      return { url, status: blocked(status, "") ? "blocked" : "error", http_status: status, via: "https", text: "", error: `PDF ${status}` };
    } catch (error) { return { url, status: "error", http_status: null, via: null, text: "", error: error instanceof Error ? error.message : String(error) }; }
  }
  try {
    const response = await fetcher(target);
    httpStatus = response.status;
    if (response.status >= 200 && response.status < 300 && (!response.content_type || /html|text\/plain/i.test(response.content_type))) {
      const text = htmlToText(response.body);
      if (!blocked(response.status, text)) return { url, status: "ok", http_status: response.status, via: "https", text, error: null };
    }
    note = `HTTPS ${response.status}`;
  } catch (error) { note = error instanceof Error ? error.message : String(error); }
  try {
    const { status, text } = await browserText(target);
    if (blocked(status, text)) return { url, status: "blocked", http_status: status, via: "browser", text: "", error: `${note}; browser saw a block or bot check` };
    if (status != null && (status < 200 || status >= 300)) return { url, status: "error", http_status: status, via: "browser", text: "", error: `${note}; browser ${status}` };
    return { url, status: "ok", http_status: status, via: "browser", text, error: null };
  } catch (error) {
    return { url, status: blocked(httpStatus, "") ? "blocked" : "error", http_status: httpStatus, via: null, text: "", error: `${note}; ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Fetches every URL once per run directory, one request at a time per site. */
export async function fetchPages(urls: string[], cacheDir: string, log: (line: string) => void = () => {}): Promise<Map<string, Page>> {
  await mkdir(cacheDir, { recursive: true });
  const fetcher = await publicFetch(), out = new Map<string, Page>(), lastHit = new Map<string, number>();
  for (const url of [...new Set(urls)]) {
    const file = join(cacheDir, `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);
    if (existsSync(file)) { out.set(url, JSON.parse(await readFile(file, "utf8"))); continue; }
    let host = "";
    try { host = new URL(url).hostname; } catch { out.set(url, { url, status: "error", http_status: null, via: null, text: "", error: "bad URL" }); continue; }
    const wait = (lastHit.get(host) ?? 0) + PER_HOST_GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const page = await fetchPage(url, fetcher);
    lastHit.set(host, Date.now());
    log(`${page.status.padEnd(7)} ${page.via ?? "-"} ${url}${page.error ? `  (${page.error})` : ""}`);
    await writeFile(file, JSON.stringify({ ...page, fetched_at: new Date().toISOString() }));
    out.set(url, page);
  }
  return out;
}
