// §4.4 bug-routing table, mechanized: map a lint/type-check failure's file
// path to the phase that owns that directory. This is what makes
// "continue loop" precise instead of a full restart.
import type { CodePhaseName } from "./types.ts";

export function classifyLintFailure(failureReport: string, featureSlug: string): CodePhaseName | undefined {
  const dataPath = `packages/features/${featureSlug}/data/`;
  const uiPath = `packages/features/${featureSlug}/ui/`;

  if (failureReport.includes(dataPath)) return "data-layer";
  if (failureReport.includes(uiPath)) {
    // A ViewModel-only failure is a wiring bug (connect); anything else in
    // ui/ (View, components) is a slicing bug.
    return /use\w+ViewModel\.ts/.test(failureReport) ? "connect" : "ui-slice";
  }
  return undefined;
}

export function classifyReviewFinding(rule: string): CodePhaseName {
  if (/raw html|design-system|component-spliting/i.test(rule)) return "ui-slice";
  if (/viewmodel returning jsx|platform-specific api/i.test(rule)) return "ui-slice";
  if (/datasource swallowing errors/i.test(rule)) return "data-layer";
  if (/cross-feature import/i.test(rule)) return "ui-slice";
  return "connect";
}
