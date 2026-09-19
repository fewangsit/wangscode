// Owns ALL control flow for the feature-build pipeline: which phase runs
// next, whether a gate failure retries the same phase or jumps back to an
// earlier one, whether execution pauses for a human. The model never decides
// any of that; see agent-runner.ts (the only file that calls the model) and
// gates.ts (the only file that decides pass/fail).
//
// This used to be a CLI (`agentic-feature-loop build-feature`) with its own
// process, printing JSON to stdout and calling process.exit() at every stop
// point. Merged directly into wangs-agent so there is one source instead of
// a subprocess boundary — every process.exit() below became a return value
// instead; the phase/gate/retry logic itself is unchanged.
import path from "node:path";

import { runAgentTurn } from "./agent-runner.ts";
import { classifyLintFailure, classifyReviewFinding } from "./bug-routing.ts";
import { runGate } from "./gates.ts";
import { detectPackageScope } from "./project-conventions.ts";
import { buildPhasePrompt } from "./prompts.ts";
import { runRequirementsPhase } from "./requirements-phase.ts";
import {
  pageObjectContractJsonSchema,
  pageObjectContractZod,
  reviewFindingsJsonSchema,
  reviewFindingsZod,
} from "./schemas.ts";
import { initState, loadState, saveState } from "./state.ts";
import {
  MODEL_PHASES,
  PHASES,
  type ClarificationRecord,
  type CodePhaseName,
  type FeatureBuildArgs,
  type FeatureBuildResult,
  type PageObjectContract,
  type PhaseName,
  type PipelineContext,
  type PipelineState,
  type RequirementBundle,
} from "./types.ts";

const CODE_PHASES: readonly Exclude<PhaseName, "requirements">[] = PHASES.filter(
  (p): p is Exclude<PhaseName, "requirements"> => p !== "requirements",
);

const PHASE_TOOL_ALLOWLIST: Record<(typeof MODEL_PHASES)[number], string[]> = {
  "data-layer": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  "test-contract": ["Read", "Write", "Edit", "Glob", "Grep"],
  // "Agent" is the real SDK tool name for subagent dispatch (verified against
  // a live session reporting its own tool list) — the wangs-ui-querier
  // subagent itself is auto-discovered from the target project's
  // .claude/agents/wangs-ui-querier.md, not registered here.
  "ui-slice": ["Read", "Write", "Edit", "Glob", "Grep", "Agent"],
  connect: ["Read", "Write", "Edit", "Glob", "Grep"],
  review: ["Read", "Glob", "Grep"],
};

function isModelPhase(phase: PhaseName): phase is (typeof MODEL_PHASES)[number] {
  return (MODEL_PHASES as readonly string[]).includes(phase);
}

/** Requirements-clarify answers only — approval-gate answers never reach this. */
function applyAnswerToRequirements(state: PipelineState, answer: string): void {
  const acceptMatch = /^accept\s+(\S+)/i.exec(answer.trim());
  if (acceptMatch) {
    state.acceptedGapIds.push(acceptMatch[1]!);
    return;
  }
  const target = (state.gapReport?.gaps ?? []).find(
    (g) => !state.acceptedGapIds.includes(g.id) && !state.clarifications.some((c) => c.gapId === g.id),
  );
  if (target) {
    const record: ClarificationRecord = {
      gapId: target.id,
      question: target.description,
      answer,
      answeredBy: "developer",
      answeredAt: new Date().toISOString(),
    };
    state.clarifications.push(record);
  }
}

interface PhaseRunResult {
  ok: boolean;
  failureReport?: string;
  classification?: CodePhaseName;
}

async function runOnePhase(
  phase: Exclude<PhaseName, "requirements">,
  ctx: PipelineContext,
  state: PipelineState,
  bundle: RequirementBundle,
): Promise<PhaseRunResult> {
  if (phase === "e2e-run" || phase === "lint") {
    const gate = runGate(phase, { repoRoot: ctx.repoRoot, featureSlug: ctx.args.featureSlug });
    if (gate.ok) return { ok: true };
    const classification =
      gate.classification ??
      (phase === "lint" ? classifyLintFailure(gate.failureReport ?? "", ctx.args.featureSlug) : undefined);
    return { ok: false, failureReport: gate.failureReport, classification };
  }

  if (!isModelPhase(phase)) return { ok: true };

  const contract = state.artifacts["test-contract"];
  let prompt = buildPhasePrompt(phase, ctx.args.featureSlug, bundle, ctx.scope, contract);
  if (ctx.priorFailure) {
    prompt += `\n\n## Previous attempt failed this gate — fix this specifically, don't restart from scratch:\n${ctx.priorFailure}`;
  }

  let outputFormat: { type: "json_schema"; schema: Record<string, unknown> } | undefined;
  if (phase === "test-contract") {
    outputFormat = { type: "json_schema", schema: pageObjectContractJsonSchema };
  } else if (phase === "review") {
    outputFormat = { type: "json_schema", schema: reviewFindingsJsonSchema };
  }

  const turn = await runAgentTurn({
    repoRoot: ctx.repoRoot,
    prompt,
    allowedTools: PHASE_TOOL_ALLOWLIST[phase],
    outputFormat,
  });

  if (!turn.ok) {
    return { ok: false, failureReport: turn.errors?.join("; ") ?? turn.resultText };
  }

  if (phase === "test-contract") {
    const contractOut: PageObjectContract = pageObjectContractZod.parse(turn.structuredOutput);
    state.artifacts["test-contract"] = contractOut;
    // Real gate: spectra sync-types + type-check — confirms what was just
    // written (page objects, specs, fixtures) is at least structurally valid,
    // before any UI exists to build against it.
    const gate = runGate(phase, { repoRoot: ctx.repoRoot, featureSlug: ctx.args.featureSlug });
    return gate.ok ? { ok: true } : { ok: false, failureReport: gate.failureReport, classification: gate.classification };
  }

  if (phase === "review") {
    const { findings } = reviewFindingsZod.parse(turn.structuredOutput);
    state.artifacts.review = findings;
    const blockers = findings.filter((f) => f.severity === "BLOCKER");
    if (blockers.length === 0) return { ok: true };
    const first = blockers[0]!;
    return {
      ok: false,
      failureReport: blockers.map((b) => `${b.file}${b.line ? `:${b.line}` : ""} — ${b.rule}: ${b.summary}`).join("\n"),
      classification: classifyReviewFinding(first.rule),
    };
  }

  // data-layer, ui-slice, connect: gate is a real command, run it now.
  const gate = runGate(
    phase,
    { repoRoot: ctx.repoRoot, featureSlug: ctx.args.featureSlug },
    state.artifacts["test-contract"],
  );
  return gate.ok ? { ok: true } : { ok: false, failureReport: gate.failureReport, classification: gate.classification };
}

export async function runFeatureBuildPipeline(args: FeatureBuildArgs): Promise<FeatureBuildResult> {
  const repoRoot = path.resolve(args.project);
  const scope = detectPackageScope(repoRoot);
  const ctx: PipelineContext = { repoRoot, scope, args };

  const state = args.resume
    ? loadState(repoRoot, args.featureSlug)
    : (loadState(repoRoot, args.featureSlug) ?? initState(args.featureSlug, args.mode));

  if (args.resume && !state) {
    throw new Error(`No state found for feature "${args.featureSlug}" — cannot resume.`);
  }
  if (!state) throw new Error("unreachable: state is always set above");

  // Requirement doc paths are only needed on the very first call for this
  // feature — every later resume call (including through the gap-check
  // clarify loop) reuses state.docPaths, persisted here.
  if (!state.docPaths) {
    const { overview, uiDesign, functional, testCase, openapi } = args;
    if (!overview || !uiDesign || !functional || !testCase || !openapi) {
      throw new Error(
        "First call for a feature needs overview, uiDesign, functional, testCase, and openapi paths. " +
          "Later resume calls don't need them again — they're persisted in .feature-build/<slug>/state.json.",
      );
    }
    state.docPaths = { overview, uiDesign, functional, testCase, openapi };
    saveState(repoRoot, args.featureSlug, state);
  }

  if (state.status === "completed") {
    return {
      status: "completed",
      note: `Already completed. Delete .feature-build/${args.featureSlug}/ to rebuild.`,
      completedPhases: state.completedPhases,
    };
  }

  const requirementsDone = state.completedPhases.includes("requirements");
  let pendingApproval = args.resume && args.answer !== undefined ? args.answer : undefined;

  if (pendingApproval !== undefined && !requirementsDone) {
    applyAnswerToRequirements(state, pendingApproval);
    pendingApproval = undefined; // consumed by the requirements loop, not a phase-approval
  }

  state.status = "running";
  saveState(repoRoot, args.featureSlug, state);

  // ---- Phase: requirements (own internal clarify loop — §4.1) ----
  if (!state.completedPhases.includes("requirements")) {
    const outcome = await runRequirementsPhase(ctx, state);
    state.gapReport = outcome.gapReport;
    if (!outcome.done) {
      state.status = "needs_input";
      state.pendingQuestion = outcome.pendingQuestion;
      saveState(repoRoot, state.featureSlug, state);
      return { status: "needs_input", pendingQuestion: outcome.pendingQuestion };
    }
    state.artifacts.requirements = outcome.bundle;
    state.completedPhases.push("requirements");
    saveState(repoRoot, args.featureSlug, state);
  }

  const bundle = state.artifacts.requirements;
  if (!bundle) throw new Error("unreachable: requirements phase always sets state.artifacts.requirements");

  // ---- Phases 2-8: code/gate phases, with cursor-based retry+rewind ----
  let cursor = 0;
  while (cursor < CODE_PHASES.length) {
    const phase = CODE_PHASES[cursor]!;

    if (state.completedPhases.includes(phase)) {
      cursor++;
      continue;
    }

    if (args.mode === "interactive") {
      const gateKey = `approved:${phase}`;
      if (!state.acceptedGapIds.includes(gateKey)) {
        if (pendingApproval !== undefined) {
          state.acceptedGapIds.push(gateKey);
          pendingApproval = undefined;
        } else {
          const question = `Siap menjalankan fase "${phase}". Lanjut? Ketik apa saja untuk melanjutkan.`;
          state.status = "needs_input";
          state.pendingQuestion = question;
          saveState(repoRoot, state.featureSlug, state);
          return { status: "needs_input", pendingQuestion: question };
        }
      }
    }

    const result = await runOnePhase(phase, ctx, state, bundle);

    if (result.ok) {
      state.completedPhases.push(phase);
      state.retryCounts[phase] = 0;
      ctx.priorFailure = undefined;
      saveState(repoRoot, args.featureSlug, state);
      cursor++;
      continue;
    }

    // Gate failed. Route to the classified origin phase (§4.4), or retry
    // this same phase if no more-specific origin was identified.
    const targetPhase = result.classification ?? phase;
    const targetIndex = CODE_PHASES.indexOf(targetPhase);
    const retryCount = (state.retryCounts[targetPhase] ?? 0) + 1;

    if (retryCount > (args.maxRetries ?? 3)) {
      state.status = "failed";
      state.escalation = { phase: targetPhase, failureReport: result.failureReport ?? "gate failed with no report" };
      saveState(repoRoot, state.featureSlug, state);
      return { status: "failed", escalation: state.escalation };
    }

    state.retryCounts[targetPhase] = retryCount;
    ctx.priorFailure = result.failureReport;
    // Un-complete every phase from the target onward — their outputs may now
    // be stale relative to the fix about to be made. "requirements" is
    // always kept: it's handled entirely outside CODE_PHASES (so
    // CODE_PHASES.indexOf("requirements") is -1, always < targetIndex) and
    // must never be un-completed by a code-phase retry/rewind — otherwise
    // every later-phase retry forces a full, redundant gap-check re-run.
    state.completedPhases = state.completedPhases.filter(
      (p) => p === "requirements" || CODE_PHASES.indexOf(p) < targetIndex,
    );
    saveState(repoRoot, args.featureSlug, state);
    cursor = targetIndex;
  }

  state.status = "completed";
  saveState(repoRoot, args.featureSlug, state);
  return { status: "completed", completedPhases: state.completedPhases };
}
