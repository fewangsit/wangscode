import path from "node:path";

import type { CanUseTool, Options, SessionStore } from "@anthropic-ai/claude-agent-sdk";

import { PRIMARY_RULES } from "./primary-rules.ts";
import { WANGS_PERSONA_APPEND } from "./persona.ts";
import type { FeatureBuildController } from "./slash-commands.ts";
import { createFeatureBuildMcpServer } from "./feature-build-tool.ts";
import { WANGS_SUBAGENTS } from "./subagents.ts";
import { PACKAGE_ROOT } from "./package-root.ts";
import { DOCS_KNOWLEDGE_MCP_SERVERS, DOCS_KNOWLEDGE_USAGE_NOTE } from "./docs-knowledge.ts";

const WANGS_PLUGIN_ROOT = path.join(PACKAGE_ROOT, "wangs-plugin");

// Exported so repl.tsx can seed the status bar/welcome banner with these immediately at startup —
// they're requested values we already know before `query()` is ever called, not values the SDK
// discovers for us, so there's no real reason the UI should show "(connecting...)" for them while
// waiting on the `system`/`init` message, which in practice doesn't arrive until the first turn
// actually runs (confirmed: the underlying `claude` subprocess doesn't broadcast its own init
// until it starts handling real work, not merely on spawn).
export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_PERMISSION_MODE = "default";

export interface SessionOptionsExtras {
  /** Mirrors transcripts to external storage when set (see postgres-session-store.ts) — omitted entirely when no store is configured, so the SDK falls back to its normal local-file behavior. */
  sessionStore?: SessionStore;
  /** Session ID to resume — consumed only at `query()` call time (see repl.tsx's restart loop). */
  resume?: string;
}

// Builds the Options object for the one long-lived `query()` call the REPL
// makes. `tools: {type:"preset", preset:"claude_code"}` and the systemPrompt
// preset-append (both confirmed real shapes in sdk.d.ts) are what let this
// chat "behave broadly like Claude Code" without hand-rewriting its default
// tool-use/safety framing — see the approved plan, section 5.
export function buildSessionOptions(
  cwd: string,
  canUseTool: CanUseTool,
  featureBuildController: FeatureBuildController,
  extras: SessionOptionsExtras = {},
): Options {
  return {
    cwd,
    model: DEFAULT_MODEL,
    includePartialMessages: true,
    ...(extras.sessionStore ? { sessionStore: extras.sessionStore } : {}),
    ...(extras.resume ? { resume: extras.resume } : {}),
    tools: { type: "preset", preset: "claude_code" },
    mcpServers: {
      "wangs-feature-build": createFeatureBuildMcpServer(featureBuildController),
      ...DOCS_KNOWLEDGE_MCP_SERVERS,
    },
    // Project-specific skills bundled inside wangs-code itself (see
    // wangs-plugin/) — a consumer repo needs zero .claude/skills config for
    // these; updating wangs-code updates the skill content.
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
      append: `${WANGS_PERSONA_APPEND}\n\n${PRIMARY_RULES}\n\n${DOCS_KNOWLEDGE_USAGE_NOTE}`,
      snapshot: true,
    },
    // Interactive terminal, a human is present — canUseTool prompts them
    // directly, so permissionMode stays "default" (not bypassPermissions,
    // which is only correct for the pipeline's own headless model phases —
    // see pipeline/agent-runner.ts).
    permissionMode: DEFAULT_PERMISSION_MODE,
    canUseTool,
  };
}
