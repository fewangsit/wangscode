import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

import type { InputRouter } from "./tui/input-router.ts";

// v1 scope, intentionally not over-built: one blocking y/n prompt per tool
// call (bare Enter always denies, regardless of the SDK's defaultToNo hint —
// simplest and safest), no "always allow this session" UX yet
// (PermissionUpdate exists in the SDK for that later). Never resolves to
// `null` — the SDK docs warn that fails closed and blocks indefinitely.
//
// Requests are serialized through a queue: `router.askLine()` only tracks one
// active prompt at a time — a subagent (or several parallel tool calls) can
// trigger several canUseTool invocations close together, and firing a second
// askLine() before the first one's promise resolves would silently drop the
// first prompt's own resolver. Each request waits for the previous one to be
// fully answered before its own prompt appears.
export function makeCanUseTool(router: InputRouter): CanUseTool {
  let queue: Promise<unknown> = Promise.resolve();

  return (toolName, input, opts): Promise<PermissionResult> => {
    const turn = queue.then(async (): Promise<PermissionResult> => {
      if (opts.signal.aborted) {
        return { behavior: "deny", message: "Request aborted." };
      }

      const label = opts.title ?? `${toolName} ${JSON.stringify(input)}`;
      const answer = await router.askLine(`Allow ${label}? [y/N]`);
      const allowed = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";

      if (allowed) return { behavior: "allow", updatedInput: input };
      return { behavior: "deny", message: "User declined this tool call." };
    });

    // Keep the chain alive even if this turn rejects, so a later request
    // isn't stuck waiting on a promise that will never settle for it.
    queue = turn.catch(() => undefined);
    return turn;
  };
}
