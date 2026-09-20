import path from "node:path";

import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";

import { PRIMARY_RULES } from "./primary-rules.ts";
import { WANGS_PERSONA_APPEND } from "./persona.ts";
import type { FeatureBuildController } from "./slash-commands.ts";
import { createFeatureBuildMcpServer } from "./feature-build-tool.ts";
import { WANGS_SUBAGENTS } from "./subagents.ts";
import { PACKAGE_ROOT } from "./package-root.ts";

const WANGS_PLUGIN_ROOT = path.join(PACKAGE_ROOT, "wangs-plugin");

// Builds the Options object for the one long-lived `query()` call the REPL
// makes. `tools: {type:"preset", preset:"claude_code"}` and the systemPrompt
// preset-append (both confirmed real shapes in sdk.d.ts) are what let this
// chat "behave broadly like Claude Code" without hand-rewriting its default
// tool-use/safety framing — see the approved plan, section 5.
export function buildSessionOptions(cwd: string, canUseTool: CanUseTool, featureBuildController: FeatureBuildController): Options {
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
    // PRIMARY_RULES (rules/*.md, loaded via primary-rules.ts) are primary
    // rules, not discoverable skills — appended directly here so they're
    // always in context rather than gated behind the model deciding to
    // invoke a skill.
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `${WANGS_PERSONA_APPEND}\n\n${PRIMARY_RULES}`,
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
