// Types for the feature-build pipeline. Originally agentic-feature-loop's
// own package; merged directly into wangs-agent so there is one source, one
// process, no subprocess boundary. This file has no behavior of its own,
// only the shapes shared across the other pipeline modules.

export const PHASES = ["requirements", "data-layer", "test-contract", "ui-slice", "connect", "e2e-run", "lint", "review"] as const;

export type PhaseName = (typeof PHASES)[number];

/** Phases that call the model. e2e-run and lint are gate-only — see gates.ts. */
export const MODEL_PHASES = ["data-layer", "test-contract", "ui-slice", "connect", "review"] as const satisfies readonly PhaseName[];

export type Mode = "interactive" | "auto";

export interface GapItem {
  id: string;
  kind: "missing" | "contradiction" | "ambiguous";
  description: string;
  sources: string[];
}

export interface GapReport {
  gaps: GapItem[];
}

export interface ClarificationRecord {
  gapId: string;
  question: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
}

export interface RequirementBundle {
  overview: string;
  uiDesign: string;
  functional: string;
  testCases: string;
  /** Kept for the `// Source: <method> <path> — openapi.yaml` comment convention (see data-sources.md), not for re-reading — see `openApiContent`. */
  openApiPath: string;
  /** The spec's full raw text — embedded like the other four docs, so the gap-check phase (which gets no tools) can actually cross-reference it instead of only seeing a path it cannot read. */
  openApiContent: string;
  clarifications: ClarificationRecord[];
  sourcePaths: {
    overview: string;
    uiDesign: string;
    functional: string;
    testCase: string;
  };
}

export interface RequiredSelector {
  kind: "a11y" | "native-id";
  name: string;
  role: string;
  describedIn: string;
}

export interface PageObjectContract {
  featureSlug: string;
  screenName: string;
  requiredSelectors: RequiredSelector[];
  filePath: string;
}

export interface ReviewFinding {
  severity: "BLOCKER" | "WARNING" | "INFO";
  file: string;
  line?: number;
  rule: string;
  summary: string;
}

export type CodePhaseName = Exclude<PhaseName, "requirements">;

export interface GateResult {
  ok: boolean;
  failureReport?: string;
  /** Which phase this failure should be routed back to (§4.4 bug routing). */
  classification?: CodePhaseName;
}

export interface PipelineArtifacts {
  requirements?: RequirementBundle;
  "test-contract"?: PageObjectContract;
  review?: ReviewFinding[];
}

export type PipelineStatus = "running" | "needs_input" | "completed" | "failed";

export interface RequirementDocPaths {
  overview: string;
  uiDesign: string;
  functional: string;
  testCase: string;
  openapi: string;
}

export interface PipelineState {
  featureSlug: string;
  mode: Mode;
  status: PipelineStatus;
  pendingQuestion?: string;
  completedPhases: PhaseName[];
  artifacts: PipelineArtifacts;
  retryCounts: Partial<Record<PhaseName, number>>;
  acceptedGapIds: string[];
  clarifications: ClarificationRecord[];
  gapReport?: GapReport;
  escalation?: { phase: PhaseName; failureReport: string };
  /**
   * Set once, on the first (non-resume) call for this feature. Every
   * subsequent resume call reads requirement source docs from these
   * persisted paths instead of requiring them to be re-passed — only the
   * first call needs them.
   */
  docPaths?: RequirementDocPaths;
  createdAt: string;
  updatedAt: string;
}

/** One call into the pipeline — the in-process equivalent of a single `agentic-feature-loop build-feature` CLI invocation. */
export interface FeatureBuildArgs {
  featureSlug: string;
  /** The target Wangs Foundation project's root — always resolved by the caller, never defaulted here. */
  project: string;
  overview?: string;
  uiDesign?: string;
  functional?: string;
  testCase?: string;
  openapi?: string;
  mode: Mode;
  resume: boolean;
  answer?: string;
  maxRetries?: number;
}

export interface FeatureBuildResult {
  status: "needs_input" | "completed" | "failed";
  pendingQuestion?: string;
  completedPhases?: PhaseName[];
  note?: string;
  escalation?: { phase: PhaseName; failureReport: string };
}

export interface PipelineContext {
  /** The TARGET project's root — never wangs-agent's own install location. */
  repoRoot: string;
  /** The target project's own npm scope (e.g. "@wangs-foundation"), detected at startup. */
  scope: string;
  args: FeatureBuildArgs;
  /** Set on retry when the previous attempt stopped at a clarify/approval gate. */
  priorFailure?: string;
}
