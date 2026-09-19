import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";

import { WANGS_PERSONA_APPEND } from "./persona.ts";
import type { FeatureBuildController } from "./slash-commands.ts";
import { createFeatureBuildMcpServer } from "./feature-build-tool.ts";
import { WANGS_SUBAGENTS } from "./subagents.ts";

// One level up from this module's own file (src/ in dev via tsx, dist/ once
// built) always lands on the wangs-agent package root — so this resolves
// correctly whether run from source or from an installed npm package,
// regardless of the caller's cwd (which is the target *project*, not
// wangs-agent itself).
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WANGS_PLUGIN_ROOT = path.join(PACKAGE_ROOT, "wangs-plugin");

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
    // Project-specific skills bundled inside wangs-agent itself (see
    // wangs-plugin/) — a consumer repo needs zero .claude/skills config for
    // these; updating wangs-agent updates the skill content.
    plugins: [{ type: "local", path: WANGS_PLUGIN_ROOT }],
    // Subagents defined programmatically (Options.agents, confirmed real in
    // sdk.d.ts) instead of .claude/agents/*.md files a consumer repo would
    // otherwise have to carry — see subagents.ts.
    agents: WANGS_SUBAGENTS,
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
