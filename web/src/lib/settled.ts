import { unstable_noStore as noStore } from "next/cache";

/** A missing related row or a slow Firestore/Postgres read shouldn't take a
 * whole catalog page down with it — the section it feeds simply doesn't
 * render (see the caller's fallback value). The primary record lookup on
 * each page is deliberately NOT wrapped in this: without it there's no
 * page.
 *
 * `noStore()` on the failure path is what keeps that graceful degradation
 * from turning into an hour of lying. These templates are cached under ISR
 * (see each segment's layout.tsx, revalidate = 3600), so without this a
 * single transient database blip would pin an empty section onto the page
 * for the full revalidation window instead of the next request trying
 * again. Same helper as destinations/[id]/page.tsx (Task 13) — duplicated
 * rather than imported there to avoid touching a file outside this task's
 * scope; new server pages should import this one. */
export async function settled<T>(task: Promise<T>, fallback: T): Promise<T> {
  try {
    return await task;
  } catch {
    noStore();
    return fallback;
  }
}
