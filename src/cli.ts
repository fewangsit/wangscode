#!/usr/bin/env bun
// Bun, not node: the terminal UI (@opentui/core) loads a native FFI binding that only
// initializes under Bun's runtime today — confirmed directly ("OpenTUI native FFI is not
// available for this runtime yet" under plain `node`, real ANSI rendering under `bun`), not a
// version gate (bumping engines.node further doesn't fix it). This shebang is the actual
// enforcement — npm's bin symlink runs whatever interpreter this line names on Unix. Known gap:
// npm on Windows generates a .cmd wrapper that always calls `node` regardless of shebang, so this
// script does not run as a global bin on Windows yet.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { runRepl } from "./repl.tsx";
import { PACKAGE_ROOT } from "./package-root.ts";

const HELP = `Wangs Code — standalone interactive chat CLI for Wangs Foundation projects

Requires Bun (https://bun.sh) — the terminal UI's native binding only runs under Bun's runtime.

Usage:
  wangscode [--project=<path>]
  wangscode --resume <session-id>
  wangscode --update | -u
  wangscode --version | -v
  wangscode --help | -h

Starts an interactive chat session in the terminal. Behaves like a general
coding assistant; type /create-feature to run the deterministic, gated
feature-build pipeline instead of freeform judgment.

Run from the root of (or pass --project= pointing at) a project that follows
the Wangs Foundation convention: packages/core, packages/infrastructure,
packages/features/*, two layers only.`;

function parseProjectFlag(argv: string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith("--project="));
  return hit ? hit.slice("--project=".length) : undefined;
}

// Two forms accepted (`--resume <id>` and `--resume=<id>`) — the exit banner (see
// exit-banner.tsx) prints the space-separated form since that's what most people type by hand,
// but `=` is accepted too for consistency with --project=.
function parseResumeFlag(argv: string[]): string | undefined {
  const eqForm = argv.find((a) => a.startsWith("--resume="));
  if (eqForm) return eqForm.slice("--resume=".length);

  const idx = argv.indexOf("--resume");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

// Reads from PACKAGE_ROOT at runtime rather than a static `import ... from "../package.json"` —
// PACKAGE_ROOT already resolves correctly in both dev (`bun src/cli.ts`) and the tsdown-bundled
// prod build (see package-root.ts's own comment on why naive relative-depth resolution breaks
// between the two), so this stays correct for free instead of relying on the bundler to inline a
// JSON import consistently across bun/tsdown/tsc. Also backs --update below, which re-reads this
// same file after `npm install -g` overwrites it in place, to report what it actually landed on.
function readPackageJson(): { name: string; version: string; publishRegistry?: string } {
  const raw = readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
  return JSON.parse(raw) as { name: string; version: string; publishRegistry?: string };
}

// Resolves the target registry for self-update, in priority order:
// 1. Explicit --registry argument passed to the CLI
// 2. WANGS_CODE_REGISTRY environment variable
// 3. .npmrc registry= line (checked in PACKAGE_ROOT, then cwd)
// 4. "publishRegistry" field embedded in package.json (set at publish time — always correct)
// 5. Bare npm default (falls through to npmjs.org if none of the above match)
function getTargetRegistry(argv: string[]): string | undefined {
  const regIdx = argv.indexOf("--registry");
  if (regIdx !== -1 && argv[regIdx + 1]) {
    return argv[regIdx + 1]!;
  }
  if (process.env.WANGS_CODE_REGISTRY) {
    return process.env.WANGS_CODE_REGISTRY;
  }
  const candidatePaths = [path.join(PACKAGE_ROOT, ".npmrc"), path.join(process.cwd(), ".npmrc")];
  for (const p of candidatePaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, "utf8");
        const match = content.match(/^registry\s*=\s*(.+)$/m);
        if (match?.[1]) return match[1].trim();
      }
    } catch {
      // Ignore read errors
    }
  }
  // Fall back to the registry URL baked into the package at publish time.
  // This is the most robust option for users who installed via `npm install -g --registry <url>`
  // without persisting that URL to .npmrc — the correct registry travels with the package.
  return readPackageJson().publishRegistry;
}

function selfUpdate(argv: string[]): void {
  const pkg = readPackageJson();
  const registry = getTargetRegistry(argv);
  console.log(`Updating ${pkg.name} (currently ${pkg.version}) from ${registry ?? "npm default registry"}...\n`);

  const npmArgs = ["install", "-g", `${pkg.name}@latest`];
  if (registry) npmArgs.push("--registry", registry);

  try {
    execFileSync("npm", npmArgs, { stdio: "inherit" });
  } catch (err) {
    console.error(`\nUpdate failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const updated = readPackageJson();
  console.log(
    updated.version === pkg.version ? `\nAlready on the latest version (${updated.version}).` : `\nUpdated to ${updated.name}@${updated.version}.`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--update") || argv.includes("-u")) {
    selfUpdate(argv);
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(readPackageJson().version);
    return;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  // Catches the two real ways this ends up running under node instead of bun despite the
  // shebang: an explicit `node dist/cli.mjs`, or npm's Windows .cmd wrapper (which always calls
  // node, ignoring the shebang). Fails with a clear message instead of the terminal UI's own
  // cryptic native-FFI stack trace.
  if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
    console.error("wangscode requires Bun (https://bun.sh) — run it with `bun wangscode` or `bunx wangscode`, not `node`.");
    process.exit(1);
  }

  const projectFlag = parseProjectFlag(argv);
  const cwd = projectFlag ? path.resolve(projectFlag) : process.cwd();
  const resumeSessionId = parseResumeFlag(argv);

  await runRepl({ cwd, resumeSessionId });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
