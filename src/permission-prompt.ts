import type { CanUseTool, PermissionResult, PermissionUpdate } from "./engine/index.ts";

import { formatToolLabel, parseToolName } from "./tui/format.ts";
import { Store } from "./tui/store.ts";

export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  label: string;
  /** Present only for mcp__ tools whose server the SDK identified — shown so the prompt names
   *  which MCP server is asking, not just the raw tool name. */
  mcpServerName: string | null;
  /** The SDK's own precomputed "don't ask again this session" rule set for this exact call —
   *  `undefined` when the SDK has no such suggestion (some tools/paths aren't rule-addressable).
   *  Returned verbatim as `updatedPermissions` when the user picks "always allow" below, rather
   *  than hand-building a PermissionUpdate — the SDK already knows the right rule shape for this
   *  tool/input, this code doesn't need to re-derive it. */
  suggestions: PermissionUpdate[] | undefined;
  resolve: (result: PermissionResult) => void;
}

/** One prompt at a time, mirrors InputRouter's own promptStore — the TUI overlay reads this via
 *  useSyncExternalStore instead of blocking on a plain-text askLine() prompt. */
export class PermissionRequestStore {
  readonly store = new Store<PermissionRequest | null>(null);
}

// v1 scope, intentionally not over-built: allow-once / always-allow-this-session / deny, no
// project- or user-settings persistence yet (PermissionUpdate's `destination` supports that later
// if asked for). Escape (handled in App.tsx) always denies. Never resolves to `null` — the SDK
// docs warn that fails closed and blocks indefinitely.
//
// Requests are serialized through a queue: the store only tracks one active request at a time — a
// subagent (or several parallel tool calls) can trigger several canUseTool invocations close
// together, and setting a second request before the first one's promise resolves would silently
// drop the first request's own resolver. Each request waits for the previous one to be fully
// answered before its own prompt appears.
export function makeCanUseTool(requestStore: PermissionRequestStore): CanUseTool {
  let queue: Promise<unknown> = Promise.resolve();

  return (toolName, input, opts): Promise<PermissionResult> => {
    const turn = queue.then(async (): Promise<PermissionResult> => {
      if (opts.signal.aborted) {
        return { behavior: "deny", message: "Request aborted." };
      }

      const parsed = parseToolName(toolName);
      const label = formatToolLabel(toolName, input, opts.title);
      return new Promise<PermissionResult>((resolve) => {
        requestStore.store.set({
          toolName,
          input,
          label,
          mcpServerName: opts.mcpServer?.name ?? parsed.serverName,
          suggestions: opts.suggestions,
          resolve: (result) => {
            requestStore.store.set(null);
            resolve(result);
          },
        });
      });
    });

    // Keep the chain alive even if this turn rejects, so a later request
    // isn't stuck waiting on a promise that will never settle for it.
    queue = turn.catch(() => undefined);
    return turn;
  };
}
