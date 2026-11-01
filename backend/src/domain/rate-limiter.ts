/** Tiny fixed-window limiter used on login. In-memory is fine for a single-instance prototype. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly max: number, private readonly windowMs: number, private readonly clock: () => number = Date.now) {}

  /** Returns true when the call is allowed. */
  hit(key: string): boolean {
    const now = this.clock();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= this.max;
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
