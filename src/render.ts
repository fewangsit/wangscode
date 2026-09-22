import type { SDKMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ChatBlock, ChatStore, ToolCallBlock } from "./tui/chat-store.ts";
import { stripModelOnlyNote } from "./tui/format.ts";
import type { SessionStatusStore } from "./tui/session-status.ts";

type TrackedBlock = { kind: "thinking" } | { kind: "tool_use"; toolUseId: string };

/**
 * Applies streamed SDK messages to the chat scrollback + session status. Stateful (tracks which
 * content-block `index` maps to which kind, and for tool_use which `toolUseId`, while a block
 * streams — see the `Map` below), so this is a factory returning a closure, not a bare function,
 * unlike the earlier single-message-type version this replaces.
 *
 * Ground truth for every message shape handled here was verified directly against the installed
 * `sdk.d.ts`/`messages.d.ts`, not assumed:
 * - `content_block_start`/`content_block_delta`/`content_block_stop` all carry `index: number`
 *   (messages.d.ts ~3028-3042) — content blocks within one API response are 0-based and
 *   monotonic, and more than one `tool_use` block can be in flight at once under different
 *   indices (parallel tool calls), so `toolUseId` is tracked per-index here, not via a single
 *   "most recent" slot, which would misattribute deltas the moment two tool calls overlap.
 * - `SDKAssistantMessage`'s own doc comment (sdk.d.ts ~3403): "the CLI emits one assistant message
 *   per completed content block" — each `type: 'assistant'` message carries exactly one block in
 *   `message.content`, so which `finish*()` to call depends on that block's own `type`, not a
 *   blanket "assistant message means text finished" assumption.
 */
export function createMessageRenderer(chatStore: ChatStore, sessionStatus: SessionStatusStore): (message: SDKMessage) => void {
  const tracked = new Map<number, TrackedBlock>();

  return function renderMessage(message: SDKMessage): void {
    if (message.type === "stream_event") {
      const event = message.event;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "thinking" || block.type === "redacted_thinking") {
          tracked.set(event.index, { kind: "thinking" });
          chatStore.appendThinkingDelta("");
        } else if (block.type === "tool_use") {
          tracked.set(event.index, { kind: "tool_use", toolUseId: block.id });
          chatStore.startToolCall(block.id, block.name);
        }
        return;
      }

      if (event.type === "content_block_delta") {
        const entry = tracked.get(event.index);
        if (entry?.kind === "thinking" && event.delta.type === "thinking_delta") {
          chatStore.appendThinkingDelta(event.delta.thinking);
        } else if (entry?.kind === "tool_use" && event.delta.type === "input_json_delta") {
          chatStore.appendToolInputDelta(entry.toolUseId, event.delta.partial_json);
        } else if (entry === undefined && event.delta.type === "text_delta") {
          chatStore.appendAssistantDelta(event.delta.text);
        }
        return;
      }

      if (event.type === "content_block_stop") {
        const entry = tracked.get(event.index);
        tracked.delete(event.index);
        if (entry?.kind === "tool_use") {
          chatStore.finishToolInput(entry.toolUseId);
        }
        return;
      }

      return;
    }

    if (message.type === "assistant") {
      const block = message.message.content[0];
      if (!block) return;
      if (block.type === "text") chatStore.finishAssistant();
      else if (block.type === "thinking" || block.type === "redacted_thinking") chatStore.finishThinking();
      // tool_use completion is already handled via the stream_event content_block_stop path above.
      return;
    }

    if (message.type === "user") {
      const content = message.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        chatStore.completeToolCall(block.tool_use_id, summarizeToolResultContent(block.content), block.is_error ?? false);
      }
      return;
    }

    if (message.type === "system" && message.subtype === "init") {
      sessionStatus.applyInit({
        session_id: message.session_id,
        model: message.model,
        permissionMode: message.permissionMode,
        cwd: message.cwd,
        effort: message.effort,
      });
      return;
    }

    if (message.type === "system" && message.subtype === "mirror_error") {
      chatStore.pushFooter("[Wangs Code] session mirror write failed — local transcript is still intact");
      return;
    }

    if (message.type === "result") {
      if (message.modelUsage) sessionStatus.accumulateUsage(message.modelUsage);
      if (message.subtype === "success") {
        chatStore.pushFooter(`[cost: $${message.total_cost_usd.toFixed(6)}]`);
      } else {
        chatStore.pushFooter(`[error: ${message.subtype}]`);
      }
    }

    // Every other message type (compact_boundary, hook_*, task_*, notification,
    // permission_denied, etc. — see the plan's Stage 1 scope note) is deliberately not rendered.
  };
}

export function summarizeToolResultContent(content: unknown): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return truncate(stripModelOnlyNote(content));
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "type" in block) {
          const b = block as { type: string; text?: string };
          return b.type === "text" ? (b.text ?? "") : `[${b.type}]`;
        }
        return String(block);
      })
      .join("\n");
    return truncate(stripModelOnlyNote(text));
  }
  return truncate(JSON.stringify(content));
}

export function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Converts historical session messages (from getSessionMessages) into renderable ChatBlocks.
 * Links tool_use blocks to subsequent tool_result blocks, and preserves user/assistant dialogue.
 */
export function convertSessionMessagesToBlocks(messages: SessionMessage[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let nextId = 0;
  const toolBlocksByUseId = new Map<string, ToolCallBlock>();

  for (const m of messages) {
    if (m.type === "user") {
      const msg = m.message as { role?: string; content?: unknown } | undefined;
      const content = msg?.content;

      if (typeof content === "string") {
        blocks.push({ id: nextId++, kind: "user", text: content });
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (!item || typeof item !== "object" || !("type" in item)) continue;
          const block = item as {
            type: string;
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
            text?: string;
          };

          if (block.type === "tool_result" && block.tool_use_id) {
            const toolBlock = toolBlocksByUseId.get(block.tool_use_id);
            if (toolBlock) {
              toolBlock.status = block.is_error ? "error" : "done";
              toolBlock.resultText = summarizeToolResultContent(block.content);
            }
          } else if (block.type === "text" && block.text && !block.text.startsWith("[")) {
            blocks.push({ id: nextId++, kind: "user", text: block.text });
          }
        }
      }
    } else if (m.type === "assistant") {
      const msg = m.message as { role?: string; content?: unknown } | undefined;
      const content = msg?.content;

      if (Array.isArray(content)) {
        for (const item of content) {
          if (!item || typeof item !== "object" || !("type" in item)) continue;
          const block = item as {
            type: string;
            text?: string;
            thinking?: string;
            id?: string;
            name?: string;
            input?: unknown;
          };

          if (block.type === "text") {
            if (block.text && block.text !== "No response requested.") {
              blocks.push({
                id: nextId++,
                kind: "assistant",
                text: block.text,
                streaming: false,
              });
            }
          } else if (block.type === "thinking") {
            if (block.thinking && block.thinking.trim().length > 0) {
              blocks.push({
                id: nextId++,
                kind: "thinking",
                text: block.thinking,
                streaming: false,
              });
            }
          } else if (block.type === "tool_use" && block.id && block.name) {
            const toolBlock: ToolCallBlock = {
              id: nextId++,
              kind: "tool",
              toolUseId: block.id,
              name: block.name,
              input: block.input ?? null,
              status: "done",
              isSkill: block.name === "Skill",
            };
            toolBlocksByUseId.set(block.id, toolBlock);
            blocks.push(toolBlock);
          }
        }
      }
    }
  }

  return blocks;
}
