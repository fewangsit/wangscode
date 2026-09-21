import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ChatStore } from "./tui/chat-store.ts";
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

function summarizeToolResultContent(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return truncate(content);
  const text = content.map((block) => (block.type === "text" ? (block.text ?? "") : `[${block.type}]`)).join("\n");
  return truncate(text);
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
