#!/usr/bin/env node
import path from "node:path";

import { runRepl } from "./repl.ts";

const HELP = `wangs-agent — standalone interactive chat CLI for Wangs Foundation projects

Usage:
  wangs-agent [--project=<path>]

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const projectFlag = parseProjectFlag(argv);
  const cwd = projectFlag ? path.resolve(projectFlag) : process.cwd();

  await runRepl({ cwd });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
