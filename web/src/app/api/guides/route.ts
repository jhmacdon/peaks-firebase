import { GUIDES } from "../../../lib/guides";

// The native reader and web pages use the same reviewed copy. No database read.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ guides: GUIDES }, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
