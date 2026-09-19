import readline from "node:readline";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { AsyncInputQueue } from "./input-queue.ts";
import { makeCanUseTool } from "./permission-prompt.ts";
import { renderMessage } from "./render.ts";
import { buildSessionOptions } from "./session-options.ts";
import { FeatureBuildController } from "./slash-commands.ts";

export interface ReplParams {
  cwd: string;
}

export async function runRepl(params: ReplParams): Promise<void> {
  const inputQueue = new AsyncInputQueue();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  const featureBuildController = new FeatureBuildController(rl, params.cwd);
  const options = buildSessionOptions(params.cwd, makeCanUseTool(rl), featureBuildController);

  // One `query()` call for the whole process lifetime — `prompt` as an
  // AsyncIterable is what keeps this a genuine ongoing multi-turn session
  // instead of restarting per message (sdk.d.ts: `prompt: string |
  // AsyncIterable<SDKUserMessage>`).
  const session = query({ prompt: inputQueue, options });

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await session.interrupt().catch(() => undefined);
    inputQueue.close();
    rl.close();
  };

  rl.on("line", (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (trimmed === "/exit" || trimmed === "/quit") {
        await shutdown();
        return;
      }
      if (trimmed.length === 0) {
        rl.prompt();
        return;
      }

      // Host-intercepted first: /create-feature and any pending
      // needs_input answer never reach the model — see plan section 3.
      const handled = await featureBuildController.handleLine(trimmed, (text) => console.log(text));
      if (handled) {
        rl.prompt();
        return;
      }

      inputQueue.push(trimmed);
    })();
  });

  rl.on("close", () => {
    void shutdown().finally(() => process.exit(0));
  });

  console.log("Wangs Agent — ketik pesan, atau /exit untuk keluar.\n");
  rl.prompt();

  try {
    for await (const message of session) {
      renderMessage(message);
      if (message.type === "result") rl.prompt();
    }
  } catch (err) {
    console.error("\n[wangs-agent] session error:", err);
  }
}
