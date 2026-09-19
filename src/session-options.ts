import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";

import { WANGS_PERSONA_APPEND } from "./persona.ts";
import type { FeatureBuildController } from "./slash-commands.ts";
import { createFeatureBuildMcpServer } from "./feature-build-tool.ts";

// Builds the Options object for the one long-lived `query()` call the REPL
// makes. `tools: {type:"preset", preset:"claude_code"}` and the systemPrompt
// preset-append (both confirmed real shapes in sdk.d.ts) are what let this
// chat "behave broadly like Claude Code" without hand-rewriting its default
// tool-use/safety framing — see the approved plan, section 5.
export function buildSessionOptions(
  cwd: string,
  canUseTool: CanUseTool,
  featureBuildController: FeatureBuildController,
): Options {
  return {
    cwd,
    model: "claude-sonnet-5",
    includePartialMessages: true,
    tools: { type: "preset", preset: "claude_code" },
    mcpServers: {
      "wangs-feature-build": createFeatureBuildMcpServer(featureBuildController),
    },
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: WANGS_PERSONA_APPEND,
      snapshot: true,
    },
    // Interactive terminal, a human is present — canUseTool prompts them
    // directly, so permissionMode stays "default" (not bypassPermissions,
    // which is only correct for the pipeline's own headless model phases —
    // see pipeline/agent-runner.ts).
    permissionMode: "default",
    canUseTool,
  };
}
