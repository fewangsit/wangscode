import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "../src/engine/index.ts";

import { convertSessionMessagesToBlocks } from "../src/render.ts";
import { ChatStore } from "../src/tui/chat-store.ts";

describe("convertSessionMessagesToBlocks", () => {
  test("converts conversation with user, assistant, tool_use, and tool_result", () => {
    const rawMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "u1",
        session_id: "s1",
        message: { role: "user", content: "panggil mcp wangs-ui" },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "assistant",
        uuid: "a1",
        session_id: "s1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Saya panggil lewat subagent." }],
        },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "assistant",
        uuid: "a2",
        session_id: "s1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "Agent",
              input: { subagent_type: "wangs-ui-querier", description: "Daftar dokumentasi wangs-ui" },
            },
          ],
        },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "user",
        uuid: "u2",
        session_id: "s1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "User declined tool execution",
              is_error: true,
            },
          ],
        },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "user",
        uuid: "u3",
        session_id: "s1",
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user for tool use]" }],
        },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "assistant",
        uuid: "a3",
        session_id: "s1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "No response requested." }],
        },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "user",
        uuid: "u4",
        session_id: "s1",
        message: { role: "user", content: "lanjutkan" },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
    ];

    const blocks = convertSessionMessagesToBlocks(rawMessages);

    // Should contain: user ("panggil mcp wangs-ui"), assistant ("Saya panggil..."), tool (Agent), user ("lanjutkan")
    // Synthetic interrupt and "No response requested" should be filtered.
    expect(blocks.length).toBe(4);

    expect(blocks[0]).toMatchObject({ kind: "user", text: "panggil mcp wangs-ui" });
    expect(blocks[1]).toMatchObject({ kind: "assistant", text: "Saya panggil lewat subagent." });
    expect(blocks[2]).toMatchObject({
      kind: "tool",
      name: "Agent",
      toolUseId: "toolu_123",
      status: "error",
      resultText: "User declined tool execution",
    });
    expect(blocks[3]).toMatchObject({ kind: "user", text: "lanjutkan" });
  });

  test("populates ChatStore with replaceBlocks cleanly", () => {
    const chatStore = new ChatStore();
    chatStore.pushWelcome();
    expect(chatStore.store.get().length).toBe(1);

    const rawMessages: SessionMessage[] = [
      {
        type: "user",
        uuid: "u1",
        session_id: "s1",
        message: { role: "user", content: "hello" },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: "assistant",
        uuid: "a1",
        session_id: "s1",
        message: { role: "assistant", content: [{ type: "text", text: "world" }] },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
    ];

    const blocks = convertSessionMessagesToBlocks(rawMessages);
    chatStore.replaceBlocks(blocks);

    const currentBlocks = chatStore.store.get();
    expect(currentBlocks.length).toBe(2);
    expect(currentBlocks[0]).toMatchObject({ kind: "user", text: "hello" });
    expect(currentBlocks[1]).toMatchObject({ kind: "assistant", text: "world" });
    expect(chatStore.resumeEvent.get()).toBe(1);

    // Ensure nextId continues properly
    chatStore.pushHost("Resumed session.");
    const finalBlocks = chatStore.store.get();
    expect(finalBlocks.length).toBe(3);
    expect(finalBlocks[2]?.id).toBeGreaterThan(finalBlocks[1]?.id ?? 0);
  });

  test("resets ChatStore with reset() for new session cleanly", () => {
    const chatStore = new ChatStore();
    chatStore.pushWelcome();
    chatStore.pushUser("First message");
    chatStore.pushHost("Reply");
    expect(chatStore.store.get().length).toBe(3);

    const prevResumeEvent = chatStore.resumeEvent.get();
    chatStore.reset();

    const blocks = chatStore.store.get();
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({ id: 0, kind: "welcome" });
    expect(chatStore.resumeEvent.get()).toBe(prevResumeEvent + 1);

    // Ensure nextId resets to 1 for subsequent pushes
    chatStore.pushUser("New session user message");
    const updated = chatStore.store.get();
    expect(updated.length).toBe(2);
    expect(updated[1]).toMatchObject({ id: 1, kind: "user", text: "New session user message" });
  });
});
