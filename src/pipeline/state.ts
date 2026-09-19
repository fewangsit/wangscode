import fs from "node:fs";
import path from "node:path";

import type { Mode, PipelineState } from "./types.ts";

function stateDir(repoRoot: string, slug: string): string {
  return path.join(repoRoot, ".feature-build", slug);
}

function statePath(repoRoot: string, slug: string): string {
  return path.join(stateDir(repoRoot, slug), "state.json");
}

export function loadState(repoRoot: string, slug: string): PipelineState | null {
  const p = statePath(repoRoot, slug);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as PipelineState;
}

export function saveState(repoRoot: string, slug: string, state: PipelineState): void {
  fs.mkdirSync(stateDir(repoRoot, slug), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statePath(repoRoot, slug), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function initState(slug: string, mode: Mode): PipelineState {
  const now = new Date().toISOString();
  return {
    featureSlug: slug,
    mode,
    status: "running",
    completedPhases: [],
    artifacts: {},
    retryCounts: {},
    acceptedGapIds: [],
    clarifications: [],
    createdAt: now,
    updatedAt: now,
  };
}
