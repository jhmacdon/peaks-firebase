import fs from "node:fs/promises";
import path from "node:path";
import Image from "next/image";
import { PNG_HEADER_BYTES, readPngSize } from "../lib/png-size";

// AppScreenshots — the iOS screenshots row on the landing page. Reads
// whatever PNGs sit in web/public/app at render time and frames however many
// it finds, so dropping files into that folder is the whole job. No files, no
// row: the component renders nothing rather than an empty band.
//
// Frames are media, so they take rounded-media and a hairline-weight border,
// and no shadow (design-tokens.md law 6 — shadows are for floating chrome).

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "app");

interface Screenshot {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** "02-session-detail.png" → "Peaks for iOS: session detail". A leading sort
 * prefix is ordering, not copy, so it's dropped from the label. */
function screenshotAlt(fileName: string): string {
  const label = fileName
    .replace(/\.png$/i, "")
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return label ? `Peaks for iOS: ${label}` : "Peaks for iOS";
}

async function readScreenshot(fileName: string): Promise<Screenshot | null> {
  let file;
  try {
    file = await fs.open(path.join(SCREENSHOT_DIR, fileName));
  } catch {
    return null;
  }
  try {
    const header = Buffer.alloc(PNG_HEADER_BYTES);
    await file.read(header, 0, PNG_HEADER_BYTES, 0);
    const size = readPngSize(header);
    if (!size) return null;
    return {
      src: `/app/${fileName}`,
      alt: screenshotAlt(fileName),
      ...size,
    };
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

async function loadScreenshots(): Promise<Screenshot[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(SCREENSHOT_DIR);
  } catch {
    // No folder yet — the row simply isn't part of the page.
    return [];
  }

  const fileNames = entries.filter((name) => name.toLowerCase().endsWith(".png")).sort();
  const screenshots = await Promise.all(fileNames.map(readScreenshot));
  return screenshots.filter((shot): shot is Screenshot => shot !== null);
}

export async function AppScreenshots({ className = "" }: { className?: string }) {
  const screenshots = await loadScreenshots();
  if (screenshots.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex gap-5 overflow-x-auto pb-2 sm:justify-center">
        {screenshots.map((shot) => (
          <div
            key={shot.src}
            className="w-[200px] shrink-0 overflow-hidden rounded-media border border-border bg-fill md:w-[228px]"
          >
            <Image
              src={shot.src}
              alt={shot.alt}
              width={shot.width}
              height={shot.height}
              sizes="(min-width: 768px) 228px, 200px"
              className="block h-auto w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
