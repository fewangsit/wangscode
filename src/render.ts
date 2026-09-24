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
/**
 * The part of message rendering that's identical whether the stream comes from the main
 * interactive session or a throwaway pipeline-phase `query()` call (see
 * `createPipelineProgressRenderer` below) — content-block streaming (thinking/tool_use/text) and
 * tool-result completion. Session-status effects (`system/init`, usage accounting) are NOT here:
 * a pipeline phase's `system/init` is for an unrelated ephemeral session and must never overwrite
 * the status bar's view of the real interactive session. Returns true if the message was handled.
 */
function applyStreamedContent(chatStore: ChatStore, tracked: Map<number, TrackedBlock>, message: SDKMessage): boolean {
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
      return true;
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
      return true;
    }

    if (event.type === "content_block_stop") {
      const entry = tracked.get(event.index);
      tracked.delete(event.index);
      if (entry?.kind === "tool_use") {
        chatStore.finishToolInput(entry.toolUseId);
      }
      return true;
    }

    return true;
  }

  if (message.type === "assistant") {
    const block = message.message.content[0];
    if (!block) return true;
    if (block.type === "text") chatStore.finishAssistant();
    else if (block.type === "thinking" || block.type === "redacted_thinking") chatStore.finishThinking();
    // tool_use completion is already handled via the stream_event content_block_stop path above.
    return true;
  }

  if (message.type === "user") {
    const content = message.message.content;
    if (!Array.isArray(content)) return true;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      chatStore.completeToolCall(block.tool_use_id, summarizeToolResultContent(block.content), block.is_error ?? false);
    }
    return true;
  }

  return false;
}

/**
 * Pipeline-phase turns (agent-runner.ts's `runAgentTurn`, one throwaway `query()` per phase — see
 * that file's own comment on why) used to render NOTHING to the chat while a phase ran: the
 * pipeline's own for-await loop only looked at the final `result` message. A single phase can run
 * for minutes of real tool-calling; with zero streaming that is indistinguishable from "stuck, no
 * progress" — confirmed as the actual root cause of a real user report, not a hang bug. This gives
 * pipeline turns the same live thinking/tool-call/text rendering as interactive chat, minus the
 * session-status effects (see `applyStreamedContent`'s comment — a phase's own ephemeral
 * `system/init` must never overwrite the status bar's view of the real interactive session).
 */
export function createPipelineProgressRenderer(chatStore: ChatStore): (message: SDKMessage) => void {
  const tracked = new Map<number, TrackedBlock>();
  return function renderMessage(message: SDKMessage): void {
    applyStreamedContent(chatStore, tracked, message);
  };
}

export function createMessageRenderer(chatStore: ChatStore, sessionStatus: SessionStatusStore): (message: SDKMessage) => void {
  const tracked = new Map<number, TrackedBlock>();

  return function renderMessage(message: SDKMessage): void {
    if (applyStreamedContent(chatStore, tracked, message)) return;

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

// The SDK's public `SessionMessage` type doesn't declare a `timestamp` field, but a real session
// transcript entry (confirmed against an actual `~/.claude/projects/*/*.jsonl` file) carries one —
// an ISO string, same convention `SDKAssistantMessage`/`SDKUserMessage`'s own documented
// `timestamp` field uses. Read defensively so an entry (or an older transcript format) without one
// just skips "Worked for Xs" reconstruction for that turn rather than throwing.
function timestampOf(m: SessionMessage): number | null {
  const raw = (m as { timestamp?: string }).timestamp;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Converts historical session messages (from getSessionMessages) into renderable ChatBlocks.
 * Links tool_use blocks to subsequent tool_result blocks, and preserves user/assistant dialogue.
 *
 * Also reconstructs a "✻ Worked for Xs" `turn-complete` block per finished turn from the real
 * message timestamps in the transcript — this is what makes that note survive a full app restart
 * + `/resume` (it's otherwise pushed live by `chatStore.endTurn()`, which has nothing to work from
 * on a freshly-restarted process; see that method's comment).
 */
export function convertSessionMessagesToBlocks(messages: SessionMessage[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let nextId = 0;
  const toolBlocksByUseId = new Map<string, ToolCallBlock>();

  // Tracks the turn currently being accumulated: `start` is the real user message that opened it,
  // `last` is the most recent timestamp seen since (a tool_result-carrying user message counts —
  // it's still part of the same turn's tool loop, not a new one).
  let turnStartMs: number | null = null;
  let turnLastMs: number | null = null;

  const flushTurn = (): void => {
    if (turnStartMs !== null && turnLastMs !== null && turnLastMs > turnStartMs) {
      blocks.push({ id: nextId++, kind: "turn-complete", durationMs: turnLastMs - turnStartMs });
    }
    turnStartMs = null;
    turnLastMs = null;
  };

  for (const m of messages) {
    const ts = timestampOf(m);

    if (m.type === "user") {
      const msg = m.message as { role?: string; content?: unknown } | undefined;
      const content = msg?.content;

      // Decided up front, before pushing anything — flushing the previous turn has to happen
      // BEFORE this message's own blocks are pushed, not after, or the "✻ Worked for Xs" note for
      // the turn that just ended lands one block too late (after this message's own text instead
      // of before it).
      const startsNewTurn =
        typeof content === "string" ||
        (Array.isArray(content) &&
          content.some(
            (item) =>
              item !== null &&
              typeof item === "object" &&
              "type" in item &&
              (item as { type: string }).type === "text" &&
              typeof (item as { text?: string }).text === "string" &&
              (item as { text?: string }).text!.length > 0 &&
              !(item as { text?: string }).text!.startsWith("["),
          ));

      if (startsNewTurn) {
        flushTurn();
        turnStartMs = ts;
        turnLastMs = ts;
      } else if (ts !== null) {
        turnLastMs = ts;
      }

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
      if (ts !== null) turnLastMs = ts;

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

  flushTurn(); // close out whichever turn was still open when the transcript ends

  return blocks;
}
