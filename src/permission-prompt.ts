import readline from "node:readline";

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

function askYesNo(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

// v1 scope, intentionally not over-built: one blocking y/n prompt per tool
// call (bare Enter always denies, regardless of the SDK's defaultToNo hint —
// simplest and safest), no "always allow this session" UX yet
// (PermissionUpdate exists in the SDK for that later). Never resolves to
// `null` — the SDK docs warn that fails closed and blocks indefinitely.
//
// Requests are serialized through a queue: readline.question() is not
// reentrant — a subagent (or several parallel tool calls) can trigger
// several canUseTool invocations close together, and firing rl.question()
// again before the previous one's callback resolves corrupts readline's
// internal state (confirmed live: overlapping prompts, and the user's
// answer to one landing as a normal chat message instead). Each request
// waits for the previous one to be fully answered before its own prompt
// appears.
export function makeCanUseTool(rl: readline.Interface): CanUseTool {
  let queue: Promise<unknown> = Promise.resolve();

  return (toolName, input, opts): Promise<PermissionResult> => {
    const turn = queue.then(async (): Promise<PermissionResult> => {
      if (opts.signal.aborted) {
        return { behavior: "deny", message: "Request aborted." };
      }

      const label = opts.title ?? `${toolName} ${JSON.stringify(input)}`;
      const answered = await askYesNo(rl, `\nAllow ${label}? [y/N] `);
      rl.prompt();

      if (answered) return { behavior: "allow", updatedInput: input };
      return { behavior: "deny", message: "User declined this tool call." };
    });

    // Keep the chain alive even if this turn rejects, so a later request
    // isn't stuck waiting on a promise that will never settle for it.
    queue = turn.catch(() => undefined);
    return turn;
  };
}
