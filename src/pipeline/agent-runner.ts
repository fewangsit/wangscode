// Thin wrapper around @anthropic-ai/claude-agent-sdk's query(). This is the
// ONLY file that calls the model. Every other file in this directory is
// plain host code (state, gates, routing) — see docs/ + the architecture
// doc this implements for why that split matters: control flow must live in
// code the model cannot talk its way around.
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";

import { PRIMARY_RULES } from "../primary-rules.ts";
import { WANGS_SUBAGENTS } from "../subagents.ts";

export interface RunAgentTurnParams {
  repoRoot: string;
  prompt: string;
  allowedTools: string[];
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
  model?: string;
}

export interface AgentTurnResult {
  ok: boolean;
  resultText: string;
  structuredOutput: unknown;
  totalCostUsd: number;
  errors?: string[];
}

export async function runAgentTurn(params: RunAgentTurnParams): Promise<AgentTurnResult> {
  const options: Options = {
    cwd: params.repoRoot,
    model: params.model ?? "claude-sonnet-5",
    allowedTools: params.allowedTools,
    // Only reachable when the caller's allowedTools includes "Agent" (today,
    // only the ui-slice phase) — registering it unconditionally here is
    // harmless for every other phase and keeps this one place in sync with
    // subagents.ts instead of re-deciding per phase.
    agents: WANGS_SUBAGENTS,
    // Previously absent entirely — every phase turn ran on the SDK's bare
    // default system prompt, so PRIMARY_RULES (architecture + coding
    // discipline, not a discoverable skill: see primary-rules.ts) never
    // actually reached the phases that write React/TypeScript code
    // (data-layer, test-contract, ui-slice, connect, review). Harmless on
    // the tool-less gap-check turn.
    systemPrompt: { type: "preset", preset: "claude_code", append: PRIMARY_RULES },
    // Headless CLI orchestrator — there is no terminal for interactive
    // approval prompts. The real safety boundary is `allowedTools` above,
    // scoped per phase by the caller (see run.ts's PHASE_TOOL_ALLOWLIST).
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    ...(params.outputFormat ? { outputFormat: params.outputFormat } : {}),
  };

  let resultText = "";
  let structuredOutput: unknown;
  let ok = false;
  let totalCostUsd = 0;
  let errors: string[] | undefined;

  for await (const message of query({ prompt: params.prompt, options })) {
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
