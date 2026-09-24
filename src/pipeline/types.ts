// Types for the feature-build pipeline. Originally agentic-feature-loop's
// own package; merged directly into wangs-code so there is one source, one
// process, no subprocess boundary. This file has no behavior of its own,
// only the shapes shared across the other pipeline modules.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

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
  /**
   * Full text of the feature's single-file PRD (`prd-single-file-convention.md`
   * — Overview/Aturan Logika Modul/Personas/UI Design/Functional/etc. all in
   * one document, not split). Embedded whole, never section-parsed: the
   * convention's own SSOT section ("Aturan Logika Modul") is referenced by
   * ID from half the other sections without restating it, so extracting only
   * some sections would silently drop context those sections depend on — the
   * org's own `check-8-sumbu.py` audit tool makes the same choice (keyword
   * search over the whole body, never per-section).
   */
  prd: string;
  /**
   * Combined text of every Test Case file for this feature — real modules
   * split this into a main file plus FE-only/BE-only variants (e.g.
   * `tc-user.md` + `tc-user-frontend.md` + `tc-user-backend.md`), not one
   * file. Each source is labeled by path in the combined text (see
   * requirements-phase.ts's `extract`), so scenarios stay attributable.
   */
  testCases: string;
  /** Paths of every API spec/LLD file that fed `openApiContent` — kept for `// Source: <path>` comments (see data-sources.md) and citations, not for re-reading. */
  openApiPaths: string[];
  /**
   * Combined text of every API doc for this feature — real modules split
   * this per endpoint-group into paired `.yaml` (OpenAPI) and `.md` (LLD:
   * RBAC, SQL, derived/computed fields the raw OpenAPI schema doesn't show)
   * files, not one `openapi.yaml`. Both kinds are accepted and concatenated
   * here, each labeled by path — the LLD text matters for data-layer/connect
   * phases just as much as the OpenAPI schema does.
   */
  openApiContent: string;
  clarifications: ClarificationRecord[];
  sourcePaths: {
    prd: string;
    testCases: string[];
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
  prd: string;
  testCase: string[];
  openapi: string[];
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
  /** Absolute path to the feature's single-file PRD (`PRD/{feature-name}.md`). */
  prd?: string;
  /** Absolute paths — one or more Test Case files (main + FE/BE variants, if the module splits them). */
  testCase?: string[];
  /** Absolute paths — one or more API spec/LLD files (real modules pair a `.yaml` + `.md` per endpoint group). */
  openapi?: string[];
  mode: Mode;
  resume: boolean;
  answer?: string;
  maxRetries?: number;
  /**
   * Optional UI hooks — see agent-runner.ts's own `onMessage` comment for why these exist. Without
   * them the pipeline behaves exactly as before (host code, no model calls of its own); with them,
   * a caller (slash-commands.ts) can stream a phase's live model activity into the chat instead of
   * the chat sitting silent for the whole phase.
   */
  onPhaseStart?: (phase: PhaseName) => void;
  onMessage?: (message: SDKMessage) => void;
}

export interface FeatureBuildResult {
  status: "needs_input" | "completed" | "failed";
  pendingQuestion?: string;
  completedPhases?: PhaseName[];
  note?: string;
  escalation?: { phase: PhaseName; failureReport: string };
}

export interface PipelineContext {
  /** The TARGET project's root — never wangs-code's own install location. */
  repoRoot: string;
  /** The target project's own npm scope (e.g. "@wangs-foundation"), detected at startup. */
  scope: string;
  args: FeatureBuildArgs;
  /** Set on retry when the previous attempt stopped at a clarify/approval gate. */
  priorFailure?: string;
}
