// Buffers incoming stream deltas and reveals them on a timer instead of pasting each delta
// straight into the visible text — `stream_event` deltas arrive in whatever chunk size the
// network/SDK buffers at (multi-word bursts, not a steady per-character stream), so without this,
// text visibly jumps in bursts rather than looking like it's being typed. Reveal speed tracks a
// rolling estimate of the real incoming rate (characters/second) rather than a fixed animation
// speed, with a backlog-correction term so a burst doesn't leave the visible text permanently
// behind — pure logic, no React/SDK import, independently testable.
const MIN_CHARS_PER_SECOND = 35;
const MAX_CHARS_PER_SECOND = 400;
const EMA_ALPHA = 0.3;
// If draining the current backlog at the real incoming rate would take longer than this, reveal
// speed is boosted to drain it within roughly this long instead.
const BACKLOG_CATCHUP_SECONDS = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class Typewriter {
  private pending = "";
  private lastPushAt: number | null = null;
  private emaCharsPerSecond = 40; // sane default before any real delta has arrived
  // Once a large backlog triggers catch-up mode, the target rate is computed ONCE and held fixed
  // until the backlog actually clears (or grows even larger) — not recomputed from the shrinking
  // `pending` on every tick. Recomputing "drain whatever's left in 1 more second" every tick was
  // the actual bug in an earlier version: effective rate ends up ≈ remaining-chars-left each tick,
  // an exponential-decay curve that asymptotically approaches, but never actually reaches, fully
  // drained — confirmed via a real headless render where a 179-char burst was still only partially
  // revealed after several real seconds of ticking. A fixed-until-cleared target rate drains
  // linearly instead, which provably finishes in bounded time.
  private catchUpRate: number | null = null;

  push(delta: string, now: number = Date.now()): void {
    if (delta.length === 0) return;

    if (this.lastPushAt !== null) {
      const elapsedSeconds = Math.max((now - this.lastPushAt) / 1000, 0.001);
      const instantRate = clamp(delta.length / elapsedSeconds, MIN_CHARS_PER_SECOND, MAX_CHARS_PER_SECOND);
      this.emaCharsPerSecond = EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * this.emaCharsPerSecond;
    }
    this.lastPushAt = now;
    this.pending += delta;
  }

  /** Call on a fixed interval. Returns newly-revealed text to append, or null if nothing changed. */
  tick(elapsedMs: number): string | null {
    if (this.pending.length === 0) {
      this.catchUpRate = null;
      return null;
    }

    const backlogSeconds = this.pending.length / Math.max(this.emaCharsPerSecond, 1);
    if (backlogSeconds > BACKLOG_CATCHUP_SECONDS) {
      const neededRate = clamp(this.pending.length / BACKLOG_CATCHUP_SECONDS, MIN_CHARS_PER_SECOND, MAX_CHARS_PER_SECOND);
      // Only raise the target, never lower it mid-catch-up — a fresh push arriving while already
      // catching up should extend the target, not reset progress back down.
      if (this.catchUpRate === null || neededRate > this.catchUpRate) this.catchUpRate = neededRate;
    } else {
      this.catchUpRate = null;
    }

    const effectiveRate = this.catchUpRate ?? clamp(this.emaCharsPerSecond, MIN_CHARS_PER_SECOND, MAX_CHARS_PER_SECOND);
    const elapsedSeconds = elapsedMs / 1000;
    const charsToReveal = Math.min(Math.max(1, Math.round(effectiveRate * elapsedSeconds)), this.pending.length);

    const revealed = this.pending.slice(0, charsToReveal);
    this.pending = this.pending.slice(charsToReveal);
    return revealed;
  }

  /** Reveals everything still buffered immediately — used on shutdown/interrupt, not normal flow. */
  flush(): string {
    const rest = this.pending;
    this.pending = "";
    return rest;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }
}
