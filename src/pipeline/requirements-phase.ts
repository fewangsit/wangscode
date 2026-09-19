import fs from "node:fs";

import { runAgentTurn } from "./agent-runner.ts";
import { buildGapCheckPrompt } from "./prompts.ts";
import { gapReportJsonSchema, gapReportZod } from "./schemas.ts";
import type { ClarificationRecord, GapReport, PipelineContext, PipelineState, RequirementBundle } from "./types.ts";

/**
 * Deliberate simplification vs. the original design doc: "extract" (1a) does
 * NOT call the model at all. Reading four files given by path is plain file
 * I/O — dedicated reader subagents exist to protect an interactive session's
 * context window, which is not a concern here (nothing re-reads these files
 * later; the full text is embedded once into every subsequent phase prompt).
 * Skipping a model call here is strictly more reliable, not a shortcut.
 *
 * Reads paths from `state.docPaths` (set once on the feature's first
 * invocation — see run-build-feature.ts) rather than `ctx.args` directly, so
 * a `--resume --answer=...` call during the gap-check loop never needs
 * --overview/--ui-design/etc. re-passed.
 */
function extract(state: PipelineState, clarifications: ClarificationRecord[]): RequirementBundle {
  const docPaths = state.docPaths;
  if (!docPaths) {
    throw new Error("unreachable: state.docPaths must be set before the requirements phase runs — see run-build-feature.ts");
  }
  const { overview, uiDesign, functional, testCase, openapi } = docPaths;
  return {
    overview: fs.readFileSync(overview, "utf8"),
    uiDesign: fs.readFileSync(uiDesign, "utf8"),
    functional: fs.readFileSync(functional, "utf8"),
    testCases: fs.readFileSync(testCase, "utf8"),
    openApiPath: openapi,
    openApiContent: fs.readFileSync(openapi, "utf8"),
    clarifications,
    sourcePaths: { overview, uiDesign, functional, testCase },
  };
}

async function gapCheck(ctx: PipelineContext, bundle: RequirementBundle): Promise<GapReport> {
  const result = await runAgentTurn({
    repoRoot: ctx.repoRoot,
    prompt: buildGapCheckPrompt(bundle),
    allowedTools: [], // pure analysis over text already in the prompt — no tools needed
    outputFormat: { type: "json_schema", schema: gapReportJsonSchema },
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
