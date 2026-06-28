import { Request, Response, NextFunction } from "express";
import { getUid } from "../auth";

/**
 * Per-key in-flight concurrency limiter. Pure and synchronous so the
 * admit-vs-shed decision is unit-testable without Express or a real socket.
 *
 * Backs the per-user rate guard on the heavy session-write endpoints. A single
 * account — a misbehaving or old client fanning out point chunks in parallel,
 * or a launch/reachability retry storm — can hold at most `max` concurrent
 * heavy requests on one Cloud Run instance. Excess is shed as 429 (the client
 * backs off) instead of piling into the bounded DB pool and 503-ing the whole
 * service for everyone, search included (the incident in db.ts's pool notes).
 *
 * This is a backstop, not the primary fix: the iOS upload ledger + serial
 * coordinator already keep a well-behaved client to one in-flight upload. The
 * DB pool cap (db.ts `max`) is the hard ceiling; keeping `max` below it
 * guarantees one account can never consume the entire pool on its own.
 */
export class ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max: number) {}

  /** Admit one unit for `key` if under the cap. Returns false when at the cap. */
  tryAcquire(key: string): boolean {
    const cur = this.counts.get(key) ?? 0;
    if (cur >= this.max) return false;
    this.counts.set(key, cur + 1);
    return true;
  }

  /** Release one unit for `key`. Never drops below zero; forgets keys at zero. */
  release(key: string): void {
    const cur = this.counts.get(key) ?? 0;
    if (cur <= 1) this.counts.delete(key);
    else this.counts.set(key, cur - 1);
  }

  /** Current in-flight count for `key` (test/debug). */
  inFlight(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the per-user in-flight cap for the heavy session-write endpoints.
 *
 * Derived to sit ONE BELOW the per-instance DB pool size (db.ts `DB_POOL_MAX`)
 * so a single account can never exhaust the pool by itself — at the cap it
 * still leaves a connection for every other user's reads on that instance.
 * That is the precise "one user cannot take down the server" guarantee.
 *
 * Tracking `DB_POOL_MAX` (rather than a hard-coded number) is deliberate: the
 * deployed service runs a smaller pool (e.g. 4) than db.ts's local fallback
 * (8), and a fixed cap above the real pool would shed nothing before the pool
 * starved. `HEAVY_INFLIGHT_CAP_PER_USER` overrides explicitly when needed.
 */
export function resolveHeavyInflightCap(env: NodeJS.ProcessEnv = process.env): number {
  const explicit = Number.parseInt(env.HEAVY_INFLIGHT_CAP_PER_USER || "", 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  // db.ts's pool fallback is 8; mirror it so the derived cap matches the pool
  // the service actually runs with.
  const poolMax = parsePositiveInt(env.DB_POOL_MAX, 8);
  return Math.max(1, poolMax - 1);
}

export const HEAVY_INFLIGHT_CAP = resolveHeavyInflightCap();

/**
 * Express middleware: caps concurrent in-flight requests per authenticated uid
 * using `limiter`. Over the cap → 429 with `Retry-After`. Must run AFTER
 * requireAuth (it reads req.uid). The slot is released when the response
 * finishes or the socket closes, so a dropped connection can't leak a slot.
 */
export function perUserConcurrencyGuard(limiter: ConcurrencyLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const uid = getUid(req);
    if (!uid) {
      // Unauthenticated requests never reach here (requireAuth gates /api),
      // but fail open rather than wedge if that ever changes.
      next();
      return;
    }

    if (!limiter.tryAcquire(uid)) {
      res.setHeader("Retry-After", "5");
      res.status(429).json({
        error: "Too many concurrent uploads in flight; back off and retry",
        retryAfterSeconds: 5,
      });
      return;
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      limiter.release(uid);
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}
