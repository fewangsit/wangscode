import { describe, expect, test } from "bun:test";
import { SessionStatusStore } from "../../src/tui/session-status.ts";

describe("SessionStatusStore", () => {
  test("resetForNewSession clears sessionId and modelUsage while keeping model, cwd, and effort", () => {
    const sessionStatus = new SessionStatusStore();
    sessionStatus.seedKnownConfig({
      cwd: "/home/project",
      model: "claude-sonnet-5",
      permissionMode: "default",
    });
    sessionStatus.applyInit({
      session_id: "prev-session-123",
      model: "claude-opus-4",
      permissionMode: "default",
      cwd: "/home/project",
      effort: "high",
    });
    sessionStatus.accumulateUsage({
      "claude-opus-4": {
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputTokens: 100,
        outputTokens: 200,
        thinkingTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.05,
      },
    });

    const before = sessionStatus.store.get();
    expect(before.sessionId).toBe("prev-session-123");
    expect(before.model).toBe("claude-opus-4");
    expect(before.cwd).toBe("/home/project");
    expect(before.effort).toBe("high");
    expect(before.modelUsage["claude-opus-4"]?.inputTokens).toBe(100);

    sessionStatus.resetForNewSession();

    const after = sessionStatus.store.get();
    expect(after.sessionId).toBeNull();
    expect(after.modelUsage).toEqual({});
    expect(after.model).toBe("claude-opus-4");
    expect(after.cwd).toBe("/home/project");
    expect(after.effort).toBe("high");
    expect(after.permissionMode).toBe("default");
  });
});
