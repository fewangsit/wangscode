import { runFeatureBuildPipeline } from "./pipeline/index.ts";
import type { FeatureBuildResult } from "./pipeline/index.ts";
import { PromptCancelled } from "./tui/input-router.ts";
import type { PendingFeatureBuild } from "./types.ts";

export interface FeatureBuildStartArgs {
  featureSlug: string;
  /** Absolute path to the feature's single-file PRD (`PRD/{feature-name}.md`, prd-single-file-convention.md). */
  prd: string;
  /** One or more Test Case files (main + FE/BE variants, if the module splits them). */
  testCase: string[];
  /** One or more API spec/LLD files (real modules pair a `.yaml` + `.md` per endpoint group). */
  openapi: string[];
  mode?: "interactive" | "auto";
}

/** A failure that never reached the pipeline's own PhaseName-scoped status-reporting (bad path, a phase throwing unexpectedly, ...) — "host" is deliberately not a real PhaseName. */
interface HostFailureResult {
  status: "failed";
  escalation: { phase: "host"; failureReport: string };
}

type ControllerResult = FeatureBuildResult | HostFailureResult;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hostFailure(err: unknown): HostFailureResult {
  return { status: "failed", escalation: { phase: "host", failureReport: errorMessage(err) } };
}

function renderResult(result: ControllerResult): string {
  if (result.status === "needs_input") return result.pendingQuestion ?? "(needs_input, no question given)";
  if (result.status === "completed") {
    return `Done. Phases: ${(result.completedPhases ?? []).join(" -> ")}`;
  }
  return `Failed at phase "${result.escalation?.phase}":\n${result.escalation?.failureReport}`;
}

/**
 * Owns the "build a feature end-to-end" workflow's host-side state — the
 * SAME code path whether triggered by the model's `create_feature` tool or
 * the literal `/create-feature` slash command. Never lets the deterministic
 * pipeline run more than one step concurrently, and intercepts the user's
 * next plain message when a build is awaiting a clarification answer, so
 * replying is just "type in the chat" — no re-invoking the model to reformat
 * a resume call.
 */
export class FeatureBuildController {
  private pending: PendingFeatureBuild | null = null;
  private busy = false;

  constructor(
    private readonly askLine: (prompt: string) => Promise<string>,
    private readonly project: string,
  ) {}

  isBusy(): boolean {
    return this.busy;
  }

  isAwaitingAnswer(): boolean {
    return this.pending?.awaitingAnswer ?? false;
  }

  /**
   * Never throws — a crash here (bad path, a phase erroring outside its own
   * status-reporting convention) must never take the whole chat process down
   * with it. Callers (the /create-feature prompt AND the model-invoked
   * create_feature tool) can treat the return value as the whole story.
   */
  async start(args: FeatureBuildStartArgs): Promise<ControllerResult> {
    this.busy = true;
    try {
      const result = await runFeatureBuildPipeline({ ...args, project: this.project, mode: args.mode ?? "interactive", resume: false });
      this.applyResult(args.featureSlug, result);
      return result;
    } catch (err) {
      return hostFailure(err);
    } finally {
      this.busy = false;
    }
  }

  private async answer(answer: string): Promise<ControllerResult> {
    if (!this.pending) return hostFailure(new Error("no pending feature build awaiting an answer"));
    this.busy = true;
    try {
      const result = await runFeatureBuildPipeline({
        featureSlug: this.pending.featureSlug,
        project: this.pending.project,
        mode: "interactive",
        resume: true,
        answer,
      });
      this.applyResult(this.pending.featureSlug, result);
      return result;
    } catch (err) {
      return hostFailure(err);
    } finally {
      this.busy = false;
    }
  }

  private applyResult(featureSlug: string, result: FeatureBuildResult): void {
    this.pending = result.status === "needs_input" ? { featureSlug, project: this.project, awaitingAnswer: true } : null;
  }

  private async ask(question: string): Promise<string> {
    const line = await this.askLine(question);
    return line.trim();
  }

  /** Splits a comma-separated answer into trimmed, non-empty paths — real modules pass several Test Case / API spec files, not one. */
  private async askPaths(question: string): Promise<string[]> {
    const line = await this.ask(question);
    return line
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }

  /** Esc during any of the questions below rejects the pending `askLine()` with `PromptCancelled` (see input-router.ts) — caught here so it aborts the whole sequence silently instead of leaving a half-answered prompt hanging or falling through to `onInterrupt()`. Cancelled just means cancelled — no message, straight back to the normal prompt. */
  private async runInteractivePrompt(print: (text: string) => void): Promise<void> {
    try {
      const featureSlug = await this.ask("Feature slug (kebab-case) — Esc to cancel: ");
      const prd = await this.ask("Path to the single-file PRD (PRD/<feature-name>.md) — Esc to cancel: ");
      const testCase = await this.askPaths("Path(s) to the Test Case file(s), comma-separated if more than one — Esc to cancel: ");
      const openapi = await this.askPaths(
        "Path(s) to the API spec/LLD file(s) (.yaml and/or .md), comma-separated if more than one — Esc to cancel: ",
      );
      print("\nRunning the feature-build pipeline...\n");
      const result = await this.start({ featureSlug, prd, testCase, openapi });
      print(renderResult(result));
    } catch (err) {
      if (err instanceof PromptCancelled) return;
      throw err;
    }
  }

  /**
   * First look at every line the user types, before it would otherwise reach
   * the model. Returns true if handled here (never pushed to the chat).
   */
  async handleLine(line: string, print: (text: string) => void): Promise<boolean> {
    const trimmed = line.trim();

    if (this.busy) {
      print("[Wangs Code] A feature-build is already running — wait for it to finish or answer its question.");
      return true;
    }

    if (this.isAwaitingAnswer()) {
      const result = await this.answer(trimmed);
      print(renderResult(result));
      return true;
    }

    if (trimmed === "/create-feature" || trimmed === "/cf") {
      await this.runInteractivePrompt(print);
      return true;
    }

    return false;
  }
}
