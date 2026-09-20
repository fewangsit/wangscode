import { describe, expect, test } from "bun:test";

import { Typewriter } from "../../src/tui/typewriter.ts";

describe("Typewriter", () => {
  test("reveals nothing before any push", () => {
    const tw = new Typewriter();
    expect(tw.tick(1000)).toBeNull();
  });

  test("reveals text over multiple ticks rather than all at once", () => {
    const tw = new Typewriter();
    tw.push("hello world", 0);

    const first = tw.tick(50); // 50ms tick, well under a full second
    expect(first).not.toBeNull();
    expect(first!.length).toBeLessThan("hello world".length);
    expect(tw.hasPending()).toBe(true);
  });

  test("a slow incoming rate does not dump the whole buffer in one small tick", () => {
    const tw = new Typewriter();
    // A long line arriving a few characters at a time, slowly — a genuinely slow stream, not a
    // trivial one; a tiny buffer being fully revealed in one tick isn't meaningfully "instant".
    const words = "the quick brown fox jumps over the lazy dog and then keeps going for a while";
    let t = 0;
    for (const chunk of words.match(/.{1,4}/g) ?? []) {
      tw.push(chunk, t);
      t += 500; // a new small chunk every 500ms — slow
    }

    const revealed = tw.tick(100); // one 100ms tick
    expect(revealed).not.toBeNull();
    expect(revealed!.length).toBeLessThan(words.length);
  });

  test("a fast incoming rate reveals proportionally faster", () => {
    const slow = new Typewriter();
    slow.push("a", 0);
    slow.push("b", 500);

    const fast = new Typewriter();
    fast.push("a", 0);
    fast.push("b", 10); // same 1-char delta, 50x faster arrival

    const slowRevealed = slow.tick(100)!.length;
    const fastRevealed = fast.tick(100)!.length;
    expect(fastRevealed).toBeGreaterThanOrEqual(slowRevealed);
  });

  test("a large backlog accelerates reveal speed instead of staying flat forever", () => {
    const tw = new Typewriter();
    // Push a huge burst all at once, simulating a big network chunk.
    tw.push("x".repeat(2000), 0);

    // Warm up a slow-ish baseline rate first by ticking briefly is unnecessary here — a fresh
    // Typewriter's default ema is modest, so an immediate huge backlog should trigger the
    // catch-up factor on the very first tick.
    const firstTickRevealed = tw.tick(100)!.length;

    // Compare against what a non-accelerated (flat) rate would reveal in the same tick: the
    // default ema is 40 chars/sec, so 100ms flat would be ~4 chars. The backlog is enormous
    // (2000 chars), so acceleration must reveal noticeably more than that.
    expect(firstTickRevealed).toBeGreaterThan(4);
  });

  test("a large burst fully drains within a bounded number of real ticks, not asymptotically", () => {
    // Regression test: an earlier version of the catch-up formula made effective reveal rate
    // proportional to the remaining backlog itself, which is an exponential-decay curve that
    // gets arbitrarily close to (but never actually reaches) fully drained — confirmed via a real
    // headless render where a 179-char burst was still not fully revealed after 2.8+ real seconds
    // of ticking. A single large push must genuinely finish within a small, bounded number of
    // fixed-size ticks (simulating a real ~30ms tick loop), not just "smaller than before".
    const tw = new Typewriter();
    tw.push("x".repeat(2000), 0);

    let ticks = 0;
    const maxTicks = 200; // 200 * 30ms = 6s of simulated real time — generous, must finish well before this
    while (tw.hasPending() && ticks < maxTicks) {
      tw.tick(30);
      ticks++;
    }

    expect(tw.hasPending()).toBe(false);
    expect(ticks).toBeLessThan(maxTicks);
  });

  test("never reveals more than what is pending", () => {
    const tw = new Typewriter();
    tw.push("short", 0);
    const revealed = tw.tick(10_000); // a huge elapsed time
    expect(revealed).toBe("short");
    expect(tw.hasPending()).toBe(false);
  });

  test("flush reveals everything immediately regardless of rate", () => {
    const tw = new Typewriter();
    tw.push("buffered content", 0);
    expect(tw.flush()).toBe("buffered content");
    expect(tw.hasPending()).toBe(false);
  });

  test("push with an empty string is a no-op", () => {
    const tw = new Typewriter();
    tw.push("", 0);
    expect(tw.hasPending()).toBe(false);
    expect(tw.tick(1000)).toBeNull();
  });

  test("concatenated ticks eventually reveal the full pushed text in order", () => {
    const tw = new Typewriter();
    const full = "the quick brown fox jumps over the lazy dog";
    tw.push(full, 0);

    let revealed = "";
    for (let i = 0; i < 50 && tw.hasPending(); i++) {
      revealed += tw.tick(30) ?? "";
    }
    revealed += tw.flush();

    expect(revealed).toBe(full);
  });
});
