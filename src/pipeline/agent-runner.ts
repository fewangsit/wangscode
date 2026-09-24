// Thin wrapper around @anthropic-ai/claude-agent-sdk's query(). This is the
// ONLY file that calls the model. Every other file in this directory is
// plain host code (state, gates, routing) — see docs/ + the architecture
// doc this implements for why that split matters: control flow must live in
// code the model cannot talk its way around.
import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { DOCS_KNOWLEDGE_MCP_SERVERS } from "../docs-knowledge.ts";
import { resolveWangsUiMcpServer } from "../mcp-sync.ts";
import { PRIMARY_RULES } from "../primary-rules.ts";
import { WANGS_SUBAGENTS } from "../subagents.ts";
import { PIPELINE_SYSTEM_PREAMBLE } from "./system-prompt.ts";

export interface RunAgentTurnParams {
  repoRoot: string;
  prompt: string;
  allowedTools: string[];
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
  model?: string;
  /**
   * Identical text across every phase turn in one feature-build run (today:
   * the RequirementBundle — see prompts.ts's buildCacheableContext). Placed
   * before SYSTEM_PROMPT_DYNAMIC_BOUNDARY in `systemPrompt` so the SDK marks
   * it eligible for prompt caching, instead of pasting it fresh into `prompt`
   * on every one of the 5+ model-calling phases like before. Omit for turns
   * with no such shared content (review has none today).
   */
  cacheablePrefix?: string;
  /**
   * Forwards every raw SDK message from this turn's `query()` call — the caller (see
   * run-build-feature.ts / requirements-phase.ts) is expected to wire this to
   * `createPipelineProgressRenderer` (render.ts) so a phase's thinking/tool-calls/text stream into
   * the chat UI live instead of the chat sitting silent until the whole phase finishes. Optional:
   * omitting it changes nothing about the turn itself.
   */
  onMessage?: (message: SDKMessage) => void;
}

export interface AgentTurnResult {
  ok: boolean;
  resultText: string;
  structuredOutput: unknown;
  totalCostUsd: number;
  errors?: string[];
}

export async function runAgentTurn(params: RunAgentTurnParams): Promise<AgentTurnResult> {
  // wangs-ui-querier (subagents.ts) deliberately doesn't hardcode its own mcpServers — it's meant
  // to inherit whatever "wangs-ui" server is live on the session it runs in, so it always talks to
  // the exact @wangs-ui/mcp version matching this project's installed @wangs-ui/* packages. That
  // only works if something actually registers a "wangs-ui" server here — previously nothing did,
  // so the ui-slice phase's wangs-ui-querier subagent never had a real connection to inherit.
  const wangsUiMcp = resolveWangsUiMcpServer(params.repoRoot);

  const options: Options = {
    cwd: params.repoRoot,
    model: params.model ?? "claude-sonnet-5",
    allowedTools: params.allowedTools,
    // Without this the turn emits only completed `assistant` messages — never the
    // `stream_event` content-block deltas the chat renderer streams from (see render.ts's
    // createPipelineProgressRenderer). The interactive session sets this too
    // (session-options.ts), which is why chat streams live but a pipeline phase used to sit
    // completely silent (thinking/tool-calls included) until the whole phase finished — the
    // exact "stuck, no stream, no progress" symptom. `onMessage` below is fed every raw message,
    // so it needs these deltas to render anything at all.
    includePartialMessages: true,
    // Only reachable when the caller's allowedTools includes "Agent" (today,
    // only the ui-slice phase) — registering it unconditionally here is
    // harmless for every other phase and keeps this one place in sync with
    // subagents.ts instead of re-deciding per phase.
    agents: WANGS_SUBAGENTS,
    // Only reachable when the caller's allowedTools actually lists one of
    // DOCS_KNOWLEDGE_TOOLS (see run-build-feature.ts's PHASE_TOOL_ALLOWLIST
    // and requirements-phase.ts's gap-check) — registering it unconditionally
    // here is harmless for phases that don't list those tools, same
    // reasoning as `agents` above.
    mcpServers: { ...DOCS_KNOWLEDGE_MCP_SERVERS, ...(wangsUiMcp ? { "wangs-ui": wangsUiMcp } : {}) },
    // `type: "custom"` instead of the SDK's "claude_code" preset — needed to
    // place SYSTEM_PROMPT_DYNAMIC_BOUNDARY at all (the preset's own `append`
    // is a plain string, no boundary support). PIPELINE_SYSTEM_PREAMBLE
    // carries what the preset's own text actually contributes to a headless
    // tool-using turn (see system-prompt.ts for what was captured vs.
    // deliberately dropped) — tool *definitions* are unaffected either way,
    // confirmed via a real captured request: they travel in the API's
    // `tools` field, never baked into `system` text. PRIMARY_RULES (same as
    // before) and, when given, cacheablePrefix (new — see this file's
    // RunAgentTurnParams) sit before the boundary so the SDK marks that
    // whole prefix eligible for cross-call prompt caching; the actual
    // phase-specific ask still goes in `prompt` below, unchanged.
    systemPrompt: {
      type: "custom",
      prompt: [PIPELINE_SYSTEM_PREAMBLE, PRIMARY_RULES, ...(params.cacheablePrefix ? [params.cacheablePrefix] : []), SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
    },
    // Headless CLI orchestrator — there is no terminal for interactive
    // approval prompts. The real safety boundary is `allowedTools` above,
    // scoped per phase by the caller (see run.ts's PHASE_TOOL_ALLOWLIST).
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    // Keep adaptive thinking (the model default) but ask for SUMMARY text instead of the
    // headless default ('omitted'). Without this, thinking_delta frames carry only an
    // `estimated_tokens` counter and no `.thinking` string — confirmed live against this SDK —
    // so the chat renderer's thinking block stays at 0 characters (just a 💭 with nothing in it)
    // for the entire phase. With 'summarized' the actual reasoning streams into the chat through
    // the same `onMessage` deltas the interactive session uses (see includePartialMessages above).
    thinking: { type: "adaptive", display: "summarized" },
    ...(params.outputFormat ? { outputFormat: params.outputFormat } : {}),
  };

  let resultText = "";
  let structuredOutput: unknown;
  let ok = false;
  let totalCostUsd = 0;
  let errors: string[] | undefined;

  for await (const message of query({ prompt: params.prompt, options })) {
    params.onMessage?.(message);
    if (message.type === "result") {
      totalCostUsd = message.total_cost_usd;
      if (message.subtype === "success") {
        ok = !message.is_error;
        resultText = message.result;
        structuredOutput = message.structured_output;
      } else {
        ok = false;
        ({ errors } = message);
      }
    }
  }

  return { ok, resultText, structuredOutput, totalCostUsd, errors };
}
