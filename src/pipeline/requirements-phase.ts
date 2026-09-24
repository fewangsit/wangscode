import fs from "node:fs";

import { runAgentTurn } from "./agent-runner.ts";
import { DOCS_KNOWLEDGE_TOOLS } from "../docs-knowledge.ts";
import { buildCacheableContext, buildGapCheckPrompt } from "./prompts.ts";
import { gapReportJsonSchema, gapReportZod } from "./schemas.ts";
import type { ClarificationRecord, GapReport, PipelineContext, PipelineState, RequirementBundle } from "./types.ts";

/**
 * Deliberate simplification vs. the original design doc: "extract" (1a) does
 * NOT call the model at all. Reading files given by path is plain file I/O —
 * dedicated reader subagents exist to protect an interactive session's
 * context window, which is not a concern here (nothing re-reads these files
 * later; the full text is embedded once into every subsequent phase prompt).
 * Skipping a model call here is strictly more reliable, not a shortcut.
 *
 * Reads paths from `state.docPaths` (set once on the feature's first
 * invocation — see run-build-feature.ts) rather than `ctx.args` directly, so
 * a `--resume --answer=...` call during the gap-check loop never needs --prd
 * etc. re-passed.
 */
/** Reads and concatenates several files, each under its own path-labeled heading, so a scenario/field stays attributable to the specific file it came from. */
function readMany(paths: string[]): string {
  return paths.map((p) => `--- ${p} ---\n${fs.readFileSync(p, "utf8")}`).join("\n\n");
}

function extract(state: PipelineState, clarifications: ClarificationRecord[]): RequirementBundle {
  const docPaths = state.docPaths;
  if (!docPaths) {
    throw new Error("unreachable: state.docPaths must be set before the requirements phase runs — see run-build-feature.ts");
  }
  const { prd, testCase, openapi } = docPaths;
  return {
    prd: fs.readFileSync(prd, "utf8"),
    testCases: readMany(testCase),
    openApiPaths: openapi,
    openApiContent: readMany(openapi),
    clarifications,
    sourcePaths: { prd, testCases: testCase },
  };
}

async function gapCheck(ctx: PipelineContext, bundle: RequirementBundle): Promise<GapReport> {
  const result = await runAgentTurn({
    repoRoot: ctx.repoRoot,
    prompt: buildGapCheckPrompt(bundle),
    // No file tools — gap-check reasons over text already in the system
    // prompt, never the target repo. DOCS_KNOWLEDGE_TOOLS is the one
    // exception: this is exactly the phase where a PRD's own cross-reference
    // to a sibling module ("detail: role/PRD/role.md §8.2") most needs
    // resolving before flagging something as a gap that isn't actually one.
    allowedTools: DOCS_KNOWLEDGE_TOOLS,
    outputFormat: { type: "json_schema", schema: gapReportJsonSchema },
    cacheablePrefix: buildCacheableContext(bundle),
    onMessage: ctx.args.onMessage,
  });
  if (!result.ok) {
    throw new Error(`gap-check turn failed: ${result.errors?.join("; ") ?? result.resultText}`);
  }
  return gapReportZod.parse(result.structuredOutput);
}

export type RequirementsOutcome =
  | { done: true; bundle: RequirementBundle; gapReport: GapReport }
  | { done: false; pendingQuestion: string; gapReport: GapReport };

/**
 * One call = one process invocation's worth of work. If gaps remain and the
 * developer hasn't answered yet, this returns `done: false` — the caller
 * (run.ts) persists state and exits; the NEXT invocation (--resume --answer)
 * calls this again, which folds the new clarification in via `state` and
 * re-checks. See §4.1 of the architecture doc: this loop's gate is a human
 * decision, never a command exit code, in both interactive and auto mode.
 */
export async function runRequirementsPhase(ctx: PipelineContext, state: PipelineState): Promise<RequirementsOutcome> {
  ctx.args.onPhaseStart?.("requirements");
  const bundle = extract(state, state.clarifications);
  const gapReport = await gapCheck(ctx, bundle);

  const unaccepted = gapReport.gaps.filter((g) => !state.acceptedGapIds.includes(g.id));
  if (unaccepted.length === 0) {
    return { done: true, bundle, gapReport };
  }

  const question = [
    `Fase requirements menemukan ${unaccepted.length} celah pada dokumen:`,
    ...unaccepted.map((g) => `- [${g.id}] (${g.kind}) ${g.description} — sumber: ${g.sources.join(", ")}`),
    "",
    'Jawab salah satu celah di atas (sebut ID-nya), atau ketik "accept <ID>" untuk melanjutkan meski celah itu dibiarkan.',
  ].join("\n");

  return { done: false, pendingQuestion: question, gapReport };
}
