import { describe, expect, mock, test } from "bun:test";

// command-registry.ts calls the SDK's standalone `listSessions` directly (not injected via
// CommandContext) — mock.module intercepts the whole specifier before the module under test is
// imported, so /resume can be exercised without a real project directory or session files on disk.
const listSessionsMock = mock(async () => [] as Array<{ sessionId: string; summary: string; lastModified: number; firstPrompt?: string }>);
const renameSessionMock = mock(async () => undefined);
const actualEngine = await import("../src/engine/index.ts");
mock.module("../src/engine/index.ts", () => ({
  ...actualEngine,
  listSessions: listSessionsMock,
  renameSession: renameSessionMock,
}));

const { handleSlashCommand, HOST_COMMANDS } = await import("../src/command-registry.ts");
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
    requestNewSession: () => undefined,
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

  test("/resume <sessionId> directly requests resume without prompt", async () => {
    const resumeCalls: string[] = [];
    const { ctx, chatStore } = makeContext({
      requestResume: (sessionId: string) => {
        resumeCalls.push(sessionId);
      },
    });

    const handled = await handleSlashCommand("/resume session-direct", ctx);
    expect(handled).toBe(true);
    expect(resumeCalls).toEqual(["session-direct"]);
    expect(lastHostText(chatStore)).toContain("session-direct");
  });

  test("/mcp is not dispatched here — App.tsx intercepts it directly to open the interactive MCP overlay", async () => {
    const { ctx } = makeContext();
    const handled = await handleSlashCommand("/mcp", ctx);
    expect(handled).toBe(false);
  });

  describe("/rename", () => {
    test("renames the active session directly when title arg is provided", async () => {
      const { ctx, chatStore } = makeContext();
      ctx.sessionStatus.applyInit({
        session_id: "active-session-123",
        model: "claude-3-5-sonnet",
        permissionMode: "default",
        cwd: "/tmp/project",
      });

      const handled = await handleSlashCommand("/rename My Great Feature", ctx);
      expect(handled).toBe(true);
      expect(renameSessionMock).toHaveBeenCalledWith("active-session-123", "My Great Feature", expect.objectContaining({ dir: "/tmp/project" }));
      expect(lastHostText(chatStore)).toContain("Renamed session to **My Great Feature**");
    });

    test("prompts for new title via askLine when no arg is provided", async () => {
      const { ctx, chatStore } = makeContext({
        askLine: async () => "Prompted Session Title",
      });
      ctx.sessionStatus.applyInit({
        session_id: "active-session-456",
        model: "claude-3-5-sonnet",
        permissionMode: "default",
        cwd: "/tmp/project",
      });

      const handled = await handleSlashCommand("/rename", ctx);
      expect(handled).toBe(true);
      expect(renameSessionMock).toHaveBeenCalledWith(
        "active-session-456",
        "Prompted Session Title",
        expect.objectContaining({ dir: "/tmp/project" }),
      );
      expect(lastHostText(chatStore)).toContain("Renamed session to **Prompted Session Title**");
    });

    test("reports error when there is no active session", async () => {
      const { ctx, chatStore } = makeContext();

      const handled = await handleSlashCommand("/rename New Name", ctx);
      expect(handled).toBe(true);
      expect(lastHostText(chatStore)).toContain("No active session to rename");
    });

    test("reports error when new title is empty", async () => {
      const { ctx, chatStore } = makeContext({
        askLine: async () => "   ",
      });
      ctx.sessionStatus.applyInit({
        session_id: "active-session-789",
        model: "claude-3-5-sonnet",
        permissionMode: "default",
        cwd: "/tmp/project",
      });

      const handled = await handleSlashCommand("/rename", ctx);
      expect(handled).toBe(true);
      expect(lastHostText(chatStore)).toContain("Session title cannot be empty");
    });
  });

  describe("/new", () => {
    test("calls requestNewSession without arguments when just /new is dispatched", async () => {
      let calledWith: string | undefined = "NOT_CALLED";
      const { ctx } = makeContext({
        requestNewSession: (initialPrompt?: string) => {
          calledWith = initialPrompt;
        },
      });

      const handled = await handleSlashCommand("/new", ctx);
      expect(handled).toBe(true);
      expect(calledWith).toBeUndefined();
    });

    test("calls requestNewSession with initial prompt when /new <prompt> is dispatched", async () => {
      let calledWith: string | undefined = "NOT_CALLED";
      const { ctx } = makeContext({
        requestNewSession: (initialPrompt?: string) => {
          calledWith = initialPrompt;
        },
      });

      const handled = await handleSlashCommand("/new build a navbar component", ctx);
      expect(handled).toBe(true);
      expect(calledWith).toBe("build a navbar component");
    });

    test("HOST_COMMANDS includes /new with description", () => {
      const newCmd = HOST_COMMANDS.find((c) => c.name === "/new");
      expect(newCmd).toBeDefined();
      expect(newCmd?.description).toBe("Start a new session");
    });
  });
});
