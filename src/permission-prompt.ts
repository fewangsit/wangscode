import readline from "node:readline";

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

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
export function makeCanUseTool(rl: readline.Interface): CanUseTool {
  return async (toolName, input, opts) => {
    if (opts.signal.aborted) {
      return { behavior: "deny", message: "Request aborted." };
    }

    const label = opts.title ?? `${toolName} ${JSON.stringify(input)}`;
    const answered = await askYesNo(rl, `\nAllow ${label}? [y/N] `);
    rl.prompt();

    if (answered) return { behavior: "allow", updatedInput: input };
    return { behavior: "deny", message: "User declined this tool call." };
  };
}
