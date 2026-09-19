import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FeatureBuildStepArgs {
  featureSlug: string;
  project: string;
  overview?: string;
  uiDesign?: string;
  functional?: string;
  testCase?: string;
  openapi?: string;
  mode?: "interactive" | "auto";
  resume?: boolean;
  answer?: string;
}

export interface FeatureBuildStepResult {
  status: "needs_input" | "completed" | "failed";
  pendingQuestion?: string;
  completedPhases?: string[];
  note?: string;
  escalation?: { phase: string; failureReport: string };
}

// agentic-feature-loop's package.json has no "./package.json" export entry
// (only "."), so `import.meta.resolve("agentic-feature-loop/package.json")`
// would throw ERR_PACKAGE_PATH_NOT_EXPORTED — resolve the real "." entry
// instead and derive the package root from it, then read package.json off
// disk directly (a plain fs read is not subject to the exports map).
function resolveAgenticFeatureLoopBin(): string {
  const resolvedIndexUrl = import.meta.resolve("agentic-feature-loop");
  const resolvedIndexPath = fileURLToPath(resolvedIndexUrl);
  const packageRoot = path.dirname(path.dirname(resolvedIndexPath)); // strip /dist/index.mjs
  const pkgJsonPath = path.join(packageRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { bin?: Record<string, string> };
  const binRel = pkg.bin?.["agentic-feature-loop"];
  if (!binRel) {
    throw new Error(`agentic-feature-loop's package.json at ${pkgJsonPath} has no "agentic-feature-loop" bin entry`);
  }
  return path.join(packageRoot, binRel);
}

/**
 * Runs one step of the deterministic feature-build pipeline as a real child
 * process — never in-process — because run-build-feature.ts calls
 * process.exit() on several real paths (arg validation, needs_input, failed)
 * that would kill this long-running chat host if imported directly. This
 * mirrors exactly what a human typing the CLI, or Claude Code's own
 * create-feature.md slash command, already does.
 */
export async function runFeatureBuildStep(args: FeatureBuildStepArgs): Promise<FeatureBuildStepResult> {
  const bin = resolveAgenticFeatureLoopBin();
  const cliArgs = [
    bin,
    "build-feature",
    `--feature=${args.featureSlug}`,
    `--project=${args.project}`,
    `--mode=${args.mode ?? "interactive"}`,
  ];

  if (args.resume) {
    cliArgs.push("--resume");
    if (args.answer !== undefined) cliArgs.push(`--answer=${args.answer}`);
  } else {
    if (!args.overview || !args.uiDesign || !args.functional || !args.testCase || !args.openapi) {
      throw new Error(
        "First feature-build call needs overview, uiDesign, functional, testCase, and openapi paths",
      );
    }
    cliArgs.push(
      `--overview=${args.overview}`,
      `--ui-design=${args.uiDesign}`,
      `--functional=${args.functional}`,
      `--test-case=${args.testCase}`,
      `--openapi=${args.openapi}`,
    );
  }

  try {
    const { stdout } = await execFileAsync(process.execPath, cliArgs, { cwd: args.project });
    return JSON.parse(stdout) as FeatureBuildStepResult;
  } catch (err) {
    // A "failed" status still exits non-zero (run-build-feature.ts's
    // exitFailed), but its real JSON is on stdout — parse it rather than
    // surfacing a generic exec error.
    const e = err as { stdout?: string };
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout) as FeatureBuildStepResult;
      } catch {
        // fall through to rethrow the original error
      }
    }
    throw err;
  }
}
