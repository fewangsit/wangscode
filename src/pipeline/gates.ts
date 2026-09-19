// Every gate here is a real command or a real grep — never a model's
// self-assessment. This is the load-bearing idea of the whole orchestrator
// (see ARCHITECTURE.md): a phase only advances when one of these functions
// returns { ok: true }. Nothing here assumes a specific project's npm scope —
// only the shared conventions every Wangs Foundation project follows
// (packages/features/<slug>/, `pnpm type-check`, `pnpm lint`, @wangs-ui/*).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { CodePhaseName, GateResult, PageObjectContract, PhaseName } from "./types.ts";

function run(cmd: string, args: string[], cwd: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || (e.message ?? String(err));
    return { ok: false, output };
  }
}

export function runTypeCheck(repoRoot: string): GateResult {
  const { ok, output } = run("pnpm", ["type-check"], repoRoot);
  return ok ? { ok: true } : { ok: false, failureReport: output };
}

export function runLint(repoRoot: string): GateResult {
  const { ok, output } = run("pnpm", ["lint"], repoRoot);
  return ok ? { ok: true } : { ok: false, failureReport: output };
}

/**
 * Regenerates TestSpectra's ambient types (`Spectra.*`, `Fixture.*`, Page
 * Objects — see the `feature-workflow` skill, Step 2) from whatever
 * page-objects/specs/fixtures the test-contract phase just wrote under
 * packages/features/<slug>/e2e/, then runs the real type-checker so a
 * malformed Page Object or spec fails the gate immediately — before any UI
 * exists to build against it. `spectra sync-types` itself only regenerates
 * declarations; it does not type-check, hence the follow-up `runTypeCheck`.
 */
export function runSpectraSyncTypes(repoRoot: string): GateResult {
  const { ok: syncOk, output: syncOutput } = run("npx", ["spectra", "sync-types"], repoRoot);
  if (!syncOk) return { ok: false, failureReport: syncOutput, classification: "test-contract" };
  const tc = runTypeCheck(repoRoot);
  return tc.ok ? { ok: true } : { ok: false, failureReport: tc.failureReport, classification: "test-contract" };
}

/**
 * Runs the feature's real E2E specs (`spectra run`) and, if the test-contract
 * phase also authored any component tests, its component specs (`spectra
 * test`) — see the `feature-workflow` skill, Step 2, on when a component test
 * is warranted vs. e2e-only. Scoped by path
 * (`packages/features/<slug>/e2e`), not by package name or Nx project name —
 * that way this works on any project regardless of what npm scope or Nx
 * naming convention it uses. Requires TestSpectra (`@testspectra/cli`) to be
 * installed in the target project; this tool has no opinion on any other e2e
 * framework.
 */
export function runSpectraE2e(repoRoot: string, featureSlug: string): GateResult {
  const e2eDir = path.join(repoRoot, "packages", "features", featureSlug, "e2e");
  if (!fs.existsSync(e2eDir)) {
    return {
      ok: false,
      failureReport: `No e2e/ directory for feature "${featureSlug}" at ${e2eDir} — the test-contract phase must author it first.`,
      classification: "test-contract",
    };
  }
  const specsDir = path.join(e2eDir, "specs");

  // Pass explicit spec file paths, never a bare directory: `spectra run`
  // given a directory also picks up `.test.tsx` component specs (and vice
  // versa for `spectra test`) despite each command only claiming to support
  // its own extension — verified against the real 1.1.10 CLI, not the docs.
  const e2eSpecs = findFilesByExt(specsDir, ".test.ts").map((f) => path.relative(repoRoot, f));
  if (e2eSpecs.length === 0) {
    return {
      ok: false,
      failureReport: `No .test.ts E2E specs found under ${specsDir} — the test-contract phase must author at least one.`,
      classification: "test-contract",
    };
  }

  const { ok: runOk, output: runOutput } = run("npx", ["spectra", "run", "--headless", "-t", "web", ...e2eSpecs], repoRoot);
  if (!runOk) return { ok: false, failureReport: runOutput, classification: classifyE2eFailure(runOutput) };

  const componentSpecs = findFilesByExt(specsDir, ".test.tsx").map((f) => path.relative(repoRoot, f));
  if (componentSpecs.length === 0) return { ok: true };

  const { ok: testOk, output: testOutput } = run("npx", ["spectra", "test", "--headless", ...componentSpecs.flatMap((f) => ["-s", f])], repoRoot);
  return testOk ? { ok: true } : { ok: false, failureReport: testOutput, classification: classifyE2eFailure(testOutput) };
}

function findFilesByExt(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFilesByExt(full, ext));
    else if (entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function classifyE2eFailure(output: string): CodePhaseName | undefined {
  // §4.4 bug-routing table, mechanized: text-match the failure against the
  // known signatures instead of asking a model to guess where the bug is.
  if (/element not found|~[\w-]+|selector|TESTSPECTRA_TEST_ERROR.*to be visible/i.test(output)) return "ui-slice";
  if (/waitForCall|timeout waiting for call|intercept/i.test(output)) return "connect";
  if (/mismatch|unexpected field|missing field/i.test(output)) return "data-layer";
  if (/has no exported member|Cannot find module|is not listed within the file list/i.test(output)) return "test-contract";
  return undefined;
}

export function checkSelectorContract(repoRoot: string, contract: PageObjectContract): GateResult {
  const uiDir = path.join(repoRoot, "packages", "features", contract.featureSlug, "ui");
  if (!fs.existsSync(uiDir)) {
    return { ok: false, failureReport: `UI directory does not exist yet: ${uiDir}`, classification: "ui-slice" };
  }
  const missing: string[] = [];
  for (const sel of contract.requiredSelectors) {
    // TestSpectra's real `~name` resolution (docs/v2/cli/selectors.md) checks THREE web
    // sources in priority order: aria-labelledby, aria-label, title. `aria-labelledby`
    // is deliberately NOT grepped here — its value is an id reference to another
    // element's text content, not the accessible name itself, so a literal
    // `aria-labelledby="${sel.name}"` grep would never match a real usage and would be
    // actively misleading. `accessibilityLabel` stays for React Native — that's the JSX
    // prop developers write; it compiles down to Android's `content-desc` / iOS's
    // accessibility identifier at the platform level, but the source-level check is
    // unaffected by that.
    const patterns =
      sel.kind === "a11y"
        ? [`aria-label="${sel.name}"`, `title="${sel.name}"`, `accessibilityLabel="${sel.name}"`]
        : [`id="${sel.name}"`, `testID="${sel.name}"`];
    if (!patterns.some((p) => grepRecursive(uiDir, p))) missing.push(`${sel.kind}:${sel.name}`);
  }
  return missing.length === 0
    ? { ok: true }
    : {
        ok: false,
        failureReport: `Missing selector attribute(s) in ${uiDir}: ${missing.join(", ")}. Every selector in the Page Object contract must exist as aria-label/title/accessibilityLabel (or id/testID for the rare native-id case) on the rendered component.`,
        classification: "ui-slice",
      };
}

function grepRecursive(dir: string, needle: string): boolean {
  const { ok } = run("grep", ["-rq", "--", needle, dir], dir);
  return ok;
}

/**
 * Dependency-rule check (§6): a feature's ViewModel must never import a
 * platform-specific @wangs-ui subpath or react-native, and a View must never
 * import a DataSource directly. Mechanical grep, not model judgment. The
 * @wangs-ui/* names are universal (the design system every target project
 * shares) — not project-specific, unlike the scope check in gates that
 * touch a project's OWN packages.
 */
export function checkDependencyRules(repoRoot: string, featureSlug: string): GateResult {
  const uiScreens = path.join(repoRoot, "packages", "features", featureSlug, "ui", "screens");
  if (!fs.existsSync(uiScreens)) return { ok: true };
  const violations: string[] = [];

  for (const screenDir of fs.readdirSync(uiScreens)) {
    const dir = path.join(uiScreens, screenDir);
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const content = fs.readFileSync(full, "utf8");
      const isViewModel = /^use.*ViewModel\.ts$/.test(file);
      const isView = file.endsWith(".tsx");

      if (isViewModel && /@wangs-ui\/react-core|@wangs-ui\/react-icons|from "react-native"/.test(content)) {
        violations.push(`${full}: ViewModel imports a platform-specific library`);
      }
      if (isView && /from ['"]\.\.\/\.\.\/\.\.\/data['"]|RemoteDataSource/.test(content)) {
        violations.push(`${full}: View imports a DataSource directly`);
      }
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, failureReport: violations.join("\n"), classification: "connect" };
}

/**
 * "What We Deliberately Don't Have" (architecture-overview rule): this project has no
 * Model/Domain layer. Mechanical existence check, not left to the model's own self-review —
 * slicing-review's own BLOCKER rule for a model/ folder is otherwise unverified, since the
 * same model that might create the folder while writing code is the one grading itself in
 * the review phase. No `classification` set: the phase currently running is whichever phase
 * just wrote the offending folder, so the default (retry the current phase) is correct.
 */
export function checkNoModelFolder(repoRoot: string, featureSlug: string): GateResult {
  const modelDir = path.join(repoRoot, "packages", "features", featureSlug, "model");
  if (!fs.existsSync(modelDir)) return { ok: true };
  return {
    ok: false,
    failureReport: `A model/ folder exists at ${modelDir} — this project has no Model/Domain layer (see the architecture-overview rule). Entity types are redundant (the DTO in data/dto/ already is the entity type); a validator shared across screens belongs in ui/validators/ per the feature-pattern rule's placement table, not here. Delete this folder and move its contents to the correct place.`,
  };
}

export function runGate(phase: PhaseName, ctx: { repoRoot: string; featureSlug: string }, artifact?: unknown): GateResult {
  switch (phase) {
    case "requirements":
      return { ok: true }; // gated by the internal gap-check loop itself, not here
    case "data-layer": {
      const noModel = checkNoModelFolder(ctx.repoRoot, ctx.featureSlug);
      if (!noModel.ok) return noModel;
      return runTypeCheck(ctx.repoRoot);
    }
    case "test-contract":
      return runSpectraSyncTypes(ctx.repoRoot);
    case "ui-slice": {
      const noModel = checkNoModelFolder(ctx.repoRoot, ctx.featureSlug);
      if (!noModel.ok) return noModel;
      return artifact ? checkSelectorContract(ctx.repoRoot, artifact as PageObjectContract) : { ok: true };
    }
    case "connect": {
      const noModel = checkNoModelFolder(ctx.repoRoot, ctx.featureSlug);
      if (!noModel.ok) return noModel;
      const tc = runTypeCheck(ctx.repoRoot);
      if (!tc.ok) return tc;
      return checkDependencyRules(ctx.repoRoot, ctx.featureSlug);
    }
    case "e2e-run":
      return runSpectraE2e(ctx.repoRoot, ctx.featureSlug);
    case "lint": {
      const tc = runTypeCheck(ctx.repoRoot);
      if (!tc.ok) return tc;
      return runLint(ctx.repoRoot);
    }
    case "review":
      return { ok: true }; // caller checks findings.filter(BLOCKER).length === 0 after parsing structured_output
  }
}
