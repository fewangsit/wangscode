import { describe, expect, mock, test } from "bun:test";

// command-registry.ts calls the SDK's standalone `listSessions` directly (not injected via
// CommandContext) — mock.module intercepts the whole specifier before the module under test is
// imported, so /resume can be exercised without a real project directory or session files on disk.
const listSessionsMock = mock(async () => [] as Array<{ sessionId: string; summary: string; lastModified: number; firstPrompt?: string }>);
mock.module("@anthropic-ai/claude-agent-sdk", () => ({ listSessions: listSessionsMock }));

const { handleSlashCommand } = await import("../src/command-registry.ts");
const { ChatStore } = await import("../src/tui/chat-store.ts");
const { SessionStatusStore } = await import("../src/tui/session-status.ts");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles for the `Query` methods each command touches; the real type is huge and mostly irrelevant here.
type AnyCtx = any;

function lastHostText(chatStore: InstanceType<typeof ChatStore>): string {
  const blocks = chatStore.store.get();
  const last = blocks[blocks.length - 1];
  if (!last || last.kind !== "host") throw new Error(`expected a host block, got ${last?.kind}`);
  return last.text;
}

function makeContext(overrides: AnyCtx = {}): { ctx: AnyCtx; chatStore: InstanceType<typeof ChatStore> } {
  const chatStore = new ChatStore();
  const sessionStatus = new SessionStatusStore();
  const ctx: AnyCtx = {
    chatStore,
    sessionStatus,
    askLine: async () => "",
    getSession: () => {
      throw new Error("getSession() not stubbed for this test");
    },
    cwd: "/tmp/project",
    requestResume: () => undefined,
    ...overrides,
  };
  return { ctx, chatStore };
}

describe("handleSlashCommand", () => {
  test("returns false for a line that isn't a known command", async () => {
    const { ctx } = makeContext();
    const handled = await handleSlashCommand("just chatting", ctx);
    expect(handled).toBe(false);
  });

  test("/usage is not dispatched here — App.tsx intercepts it directly to open the full-screen usage overlay", async () => {
    const { ctx } = makeContext();
    const handled = await handleSlashCommand("/usage", ctx);
    expect(handled).toBe(false);
  });

  test("/model is not dispatched here — App.tsx intercepts it directly to open the interactive model picker overlay", async () => {
    const { ctx } = makeContext();
    const handled = await handleSlashCommand("/model", ctx);
    expect(handled).toBe(false);
  });

  test("/resume lists sessions from listSessions() and calls requestResume with the picked sessionId", async () => {
    listSessionsMock.mockImplementationOnce(async () => [
      { sessionId: "session-a", summary: "first chat", lastModified: Date.now() },
      { sessionId: "session-b", summary: "second chat", lastModified: Date.now() },
    ]);
    const resumeCalls: string[] = [];
    const { ctx, chatStore } = makeContext({
      askLine: async () => "2",
      requestResume: (sessionId: string) => {
        resumeCalls.push(sessionId);
      },
    });

    const handled = await handleSlashCommand("/resume", ctx);
    expect(handled).toBe(true);
    expect(resumeCalls).toEqual(["session-b"]);
    expect(lastHostText(chatStore)).toContain("session-b");
  });

  test("/resume reports when there are no previous sessions", async () => {
    listSessionsMock.mockImplementationOnce(async () => []);
    const { ctx, chatStore } = makeContext();

    await handleSlashCommand("/resume", ctx);
    expect(lastHostText(chatStore)).toContain("No previous sessions");
  });
});
