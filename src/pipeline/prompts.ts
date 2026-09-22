import { DOCS_KNOWLEDGE_USAGE_NOTE } from "../docs-knowledge.ts";
import { readSkill, readSkillSection } from "./skill-content.ts";
import type { PageObjectContract, PhaseName, RequirementBundle } from "./types.ts";

/**
 * Identical across every model-calling phase for one feature (requirements
 * never change mid-build). Handed to agent-runner.ts as `cacheablePrefix` —
 * placed in `systemPrompt` before SYSTEM_PROMPT_DYNAMIC_BOUNDARY — instead of
 * being pasted into each phase's own `prompt` string as before, so it's sent
 * as a cacheable prefix once instead of billed fresh on every phase call.
 * Exported (not phase-prompt-local) so run-build-feature.ts and
 * requirements-phase.ts can build it once per call site.
 */
export function buildCacheableContext(bundle: RequirementBundle): string {
  return [
    "## RequirementBundle (authoritative — do not re-read the source docs, this IS their content)",
    "",
    // The PRD is a single-file document per prd-single-file-convention.md —
    // embedded whole, never split into sub-sections. Its own "Aturan Logika
    // Modul" (SSOT) section is referenced by ID from most of the other
    // sections without restating the rule text, so a partial extract would
    // silently drop context those sections depend on.
    `### PRD (single-file — Overview, Aturan Logika Modul, Personas, User Flow, UI Design, Functional Requirements, etc. all included)\n${bundle.prd}`,
    `### Test Cases\n${bundle.testCases}`,
    `### API Specs / LLD Docs (${bundle.openApiPaths.join(", ")})\n${bundle.openApiContent}`,
    bundle.clarifications.length > 0
      ? `### Clarifications (resolved ambiguities — treat as ground truth)\n${bundle.clarifications
          .map((c) => `- Q: ${c.question}\n  A: ${c.answer}`)
          .join("\n")}`
      : "",
    DOCS_KNOWLEDGE_USAGE_NOTE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildDataLayerPrompt(featureSlug: string, bundle: RequirementBundle, scope: string): string {
  return `${readSkillSection("feature-workflow", "Step 1 — Data Layer")}

${readSkillSection("feature-workflow", "Cross-Layer Contracts (Mandatory)")}

---

Feature: "${featureSlug}" at packages/features/${featureSlug}/
API spec(s): ${bundle.openApiPaths.join(", ")}

The RequirementBundle (the single-file PRD, Test Cases, OpenAPI spec, Clarifications) is already in your system prompt, above the cache boundary — do not ask for it again, it's the same content that was pasted inline here before.

Generate:
- data/dto/index.ts — types matching the OpenAPI spec exactly, one \`// Source: <method> <path> — openapi.yaml\` comment per type. The DTO IS the entity type — do not create a separate model/entity file (see the architecture-overview rule already in context).
- data/datasource/*RemoteDataSource.ts — pure async functions using \`http\` from \`${scope}/infrastructure/http\`. Never swallow an error.

Stop when the files are written. Do not run the type-checker yourself — the orchestrator runs it after you finish. Test fixtures belong to the next phase (test-contract), not this one — do not write anything under e2e/ here.`;
}

export function buildTestContractPrompt(featureSlug: string): string {
  return `${readSkillSection("feature-workflow", "Step 2 — Test Contract")}

${readSkillSection("feature-workflow", "Cross-Layer Contracts (Mandatory)")}

---

${readSkill("component-spliting")}

---

Feature: "${featureSlug}" — its E2E project lives at packages/features/${featureSlug}/e2e/ (a project
of its own, separate from the feature library package).

The RequirementBundle (the single-file PRD, Test Cases, OpenAPI spec, Clarifications) is already in your system prompt, above the cache boundary.

Write, following TestSpectra's real Nx-monorepo convention exactly:

- packages/features/${featureSlug}/e2e/project.json — register the Nx project:
  \`\`\`json
  {
    "name": "feature-${featureSlug}-e2e",
    "$schema": "../../../../node_modules/nx/schemas/project-schema.json",
    "projectType": "application",
    "sourceRoot": "packages/features/${featureSlug}/e2e",
    "targets": {
      "e2e": {
        "executor": "nx:run-commands",
        "options": { "command": "spectra run", "cwd": "packages/features/${featureSlug}/e2e" },
        "configurations": {
          "android": { "command": "spectra run --target android" },
          "ios": { "command": "spectra run --target ios" },
          "headless": { "command": "spectra run --headless" }
        }
      }
    },
    "tags": ["testspectra:e2e", "testspectra:scope:feature-${featureSlug}"]
  }
  \`\`\`
- packages/features/${featureSlug}/e2e/page-objects/<ScreenName>Page/web.ts — one Page Object class per
  screen, a default-exported singleton instance. Selectors via \`Spectra.get('~name')\` (aria-label,
  aria-labelledby, or title on web; accessibilityLabel on native) by default — see the feature-pattern
  rule already in context. Only fall back to \`Spectra.get('#name')\` (native id) for an element with no
  accessible name.
- packages/features/${featureSlug}/e2e/specs/<Suite>/suite.md + <Suite>/<TC-ID>/{spec.md,web.test.ts} — one
  E2E test case per Test Case scenario in the bundle above. Do not invent scenarios not present in Test
  Cases. Each web.test.ts is 100% zero-import: no \`import\` statements, no \`describe\` wrapper, exactly one
  \`it()\`, using only the ambient \`Spectra.*\`/\`Fixture.*\`/Page-Object globals.
  - Network mocking: \`const mock = await Spectra.intercept(url, method, fixturePayload, { statusCode });\` —
    the fixture argument is the RAW response payload (not \`{status, body}\`). Assert with
    \`await mock.waitForCall({ timeout: 5000 });\` — that call itself IS the assertion (it throws/times out
    if the mock never fired). There is NO \`expect()\` global in E2E specs — that only exists in component
    tests (see below). Never assert on \`mock.callCount\` with \`expect\`.
- packages/features/${featureSlug}/e2e/fixtures/*.json — one fixture per endpoint (success + error + edge
  case), consumed as \`Fixture.<camelCaseFileName>\` (e.g. \`fixtures/catalogList.json\` → \`Fixture.catalogList\`).

Only if the feature has a reusable presentational component worth verifying in isolation (per the
\`component-spliting\` skill's criteria), ALSO write a component test — a separate suite from the E2E specs
above, run via \`spectra test\` instead of \`spectra run\`:
- packages/features/${featureSlug}/e2e/test-utils.tsx — a \`withProviders(children)\` helper wrapping ONLY
  what the component actually needs (e.g. just \`ThemeProvider\` from \`@wangs-ui/foundation/theme\` if it
  renders \`Text\` — not the full app provider stack from apps/*/main.tsx).
- packages/features/${featureSlug}/e2e/specs/<ComponentSuite>/<TC-ID>/{spec.md,web.test.tsx} — real static
  imports of the component under test ARE allowed here (unlike \`.test.ts\` E2E specs): \`await
  Spectra.mount(withProviders(<TheComponent .../>));\` then assert with the same ambient DSL
  (\`.shouldBeVisible()\`, \`.shouldContainText()\`, etc.) via a Page Object under the same \`page-objects/\`
  directory. Use explicit \`.js\` extensions on relative imports (\`moduleResolution: NodeNext\`).

None of this will pass yet — there is no UI. That is expected; you are authoring the contract the UI must
satisfy. The orchestrator runs \`spectra sync-types\` + the type-checker after you finish to confirm what you
wrote is at least structurally valid (compiles) — it does not run the specs yet.

After writing the files, respond with ONLY the JSON object described by the output schema — the full
selector contract for the primary screen you just authored. No prose, no markdown fences.`;
}

export function buildUiSlicePrompt(featureSlug: string, contract: PageObjectContract): string {
  return `${readSkillSection("feature-workflow", "Step 3 — UI Slice")}

${readSkillSection("feature-workflow", "Cross-Layer Contracts (Mandatory)")}

---

${readSkill("design-system")}

---

${readSkill("component-spliting")}

---

Feature: "${featureSlug}" at packages/features/${featureSlug}/

The RequirementBundle (the single-file PRD, Test Cases, OpenAPI spec, Clarifications) is already in your system prompt, above the cache boundary.

## Page Object contract this UI MUST satisfy (from the test-contract phase)
${JSON.stringify(contract, null, 2)}

Before writing any @wangs-ui component, delegate to the \`wangs-ui-querier\` subagent via the Agent tool to confirm every prop you use — including whether the component has an accessible-name prop. Never call a wangs-ui MCP tool directly yourself.

Write:
- ui/screens/${contract.screenName}/use${contract.screenName}ViewModel.ts — skeleton is fine here (real data wiring happens in the next phase), but the return shape must be final.
- ui/screens/${contract.screenName}/${contract.screenName}.tsx — every selector in the contract above must exist as \`aria-label\`/\`accessibilityLabel\` (or \`id\`/\`testID\` for the rare native-id case) on the matching element.
- ui/components/ — extract per the \`component-spliting\` skill's four-question gate.
- resources/Strings.ts — every user-facing string.

Stop when the files are written. Do not grep for the selectors yourself — the orchestrator verifies the contract after you finish.`;
}

export function buildConnectPrompt(featureSlug: string): string {
  return `${readSkillSection("feature-workflow", "Step 4 — Connect")}

${readSkillSection("feature-workflow", "Cross-Layer Contracts (Mandatory)")}

---

Feature: "${featureSlug}" at packages/features/${featureSlug}/

The RequirementBundle (the single-file PRD, Test Cases, OpenAPI spec, Clarifications) is already in your system prompt, above the cache boundary.

Wire the ViewModel(s) under ui/screens/*/ to the real DataSource functions from data/: real fetch call, \`isLoading\` via useState, errors mapped to \`errorMessage: string | null\`. DataSource is imported only from the ViewModel, never the View. No platform-specific import (\`@wangs-ui/react-core\`, \`react-native\`, etc.) may appear in a ViewModel file.

Stop when the files are updated. Do not run the type-checker or the dependency-rule check yourself — the orchestrator runs both after you finish.`;
}

export function buildReviewPrompt(featureSlug: string): string {
  return `${readSkill("slicing-review")}

---

Run the review above against packages/features/${featureSlug}/ in full — all 10 sections (folder tree, ViewModel checklist, View checklist, DataSource/DTO, error flow, a11y selector contract, dependency rules, naming, cross-platform, index.ts).

Report ONLY — do not fix anything. Respond with ONLY the JSON object described by the output schema, one entry per finding (BLOCKER/WARNING/INFO), \`rule\` naming which slicing-review section/violation it is (e.g. "V6 — Raw HTML Controls"). No prose, no markdown fences. Empty \`findings\` array if there is nothing to report.`;
}

export function buildGapCheckPrompt(bundle: RequirementBundle): string {
  return `You are auditing a feature's requirement documents for internal consistency BEFORE any code is written. You do not have file tools — the RequirementBundle (the single-file PRD, Test Cases, OpenAPI spec, Clarifications) is already in your system prompt, above the cache boundary; everything you need is there.

Cross-reference the PRD's own sections (Overview, UI Design §4, Functional Requirements §9, etc.) against Test Cases and the OpenAPI spec. Flag:
- A field/scenario in Test Cases that has no corresponding element in the PRD's UI Design section
- An edge case in the PRD's Functional Requirements with no explanation in its UI Design section
- A field in an API spec/LLD doc (${bundle.openApiPaths.join(", ")}) not mentioned anywhere in the PRD, or vice versa
- Any direct contradiction between the PRD, Test Cases, or the OpenAPI spec

Respond with ONLY the JSON object described by the output schema. Empty \`gaps\` array if the documents are consistent — do not invent a gap to have something to report.`;
}

export function buildPhasePrompt(
  phase: PhaseName,
  featureSlug: string,
  bundle: RequirementBundle,
  scope: string,
  contract?: PageObjectContract,
): string {
  switch (phase) {
    case "data-layer":
      return buildDataLayerPrompt(featureSlug, bundle, scope);
    case "test-contract":
      return buildTestContractPrompt(featureSlug);
    case "ui-slice":
      if (!contract) throw new Error("ui-slice prompt requires the test-contract phase's PageObjectContract");
      return buildUiSlicePrompt(featureSlug, contract);
    case "connect":
      return buildConnectPrompt(featureSlug);
    case "review":
      return buildReviewPrompt(featureSlug);
    default:
      throw new Error(`No prompt builder for gate-only phase "${phase}"`);
  }
}
