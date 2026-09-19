import type { PageObjectContract, PhaseName, RequirementBundle } from "./types.ts";

function bundleBlock(bundle: RequirementBundle): string {
  return [
    "## RequirementBundle (authoritative — do not re-read the source docs, this IS their content)",
    "",
    `### Overview\n${bundle.overview}`,
    `### UI Design\n${bundle.uiDesign}`,
    `### Functional\n${bundle.functional}`,
    `### Test Cases\n${bundle.testCases}`,
    `### OpenAPI Spec (${bundle.openApiPath})\n${bundle.openApiContent}`,
    bundle.clarifications.length > 0
      ? `### Clarifications (resolved ambiguities — treat as ground truth)\n${bundle.clarifications
          .map((c) => `- Q: ${c.question}\n  A: ${c.answer}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildDataLayerPrompt(featureSlug: string, bundle: RequirementBundle, scope: string): string {
  return `Follow the \`feature-workflow\` skill's Step 1 (Data Layer) and the \`data-sources\` rule exactly.

Feature: "${featureSlug}" at packages/features/${featureSlug}/
OpenAPI spec: ${bundle.openApiPath}

${bundleBlock(bundle)}

Generate:
- data/dto/index.ts — types matching the OpenAPI spec exactly, one \`// Source: <method> <path> — openapi.yaml\` comment per type. The DTO IS the entity type — do not create a separate model/entity file (see docs/01-overview.md).
- data/datasource/*RemoteDataSource.ts — pure async functions using \`http\` from \`${scope}/infrastructure/http\`. Never swallow an error.

Stop when the files are written. Do not run the type-checker yourself — the orchestrator runs it after you finish. Test fixtures belong to the next phase (test-contract), not this one — do not write anything under e2e/ here.`;
}

export function buildTestContractPrompt(featureSlug: string, bundle: RequirementBundle): string {
  return `Follow the \`feature-workflow\` skill's Step 2 (Test Contract) exactly. This project uses TestSpectra
(\`@testspectra/cli\`) — real, zero-import ambient-global E2E/component testing, not a generic framework.

Feature: "${featureSlug}" — its E2E project lives at packages/features/${featureSlug}/e2e/ (a project
of its own, separate from the feature library package).

${bundleBlock(bundle)}

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
  screen, a default-exported singleton instance. Selectors via \`Spectra.get('~name')\` (aria-label /
  accessibilityLabel) by default — see docs/03-feature-pattern.md. Only fall back to \`Spectra.get('#name')\`
  (native id) for an element with no accessible name.
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

export function buildUiSlicePrompt(featureSlug: string, bundle: RequirementBundle, contract: PageObjectContract): string {
  return `Follow the \`feature-workflow\` skill's Step 3 (UI Slice), the \`design-system\` skill, and the \`component-spliting\` skill exactly.

Feature: "${featureSlug}" at packages/features/${featureSlug}/

${bundleBlock(bundle)}

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

export function buildConnectPrompt(featureSlug: string, bundle: RequirementBundle): string {
  return `Follow the \`feature-workflow\` skill's Step 4 (Connect) exactly.

Feature: "${featureSlug}" at packages/features/${featureSlug}/

${bundleBlock(bundle)}

Wire the ViewModel(s) under ui/screens/*/ to the real DataSource functions from data/: real fetch call, \`isLoading\` via useState, errors mapped to \`errorMessage: string | null\`. DataSource is imported only from the ViewModel, never the View. No platform-specific import (\`@wangs-ui/react-core\`, \`react-native\`, etc.) may appear in a ViewModel file.

Stop when the files are updated. Do not run the type-checker or the dependency-rule check yourself — the orchestrator runs both after you finish.`;
}

export function buildReviewPrompt(featureSlug: string): string {
  return `Run the \`slicing-review\` skill against packages/features/${featureSlug}/ in full — all 10 sections (folder tree, ViewModel checklist, View checklist, DataSource/DTO, error flow, a11y selector contract, dependency rules, naming, cross-platform, index.ts).

Report ONLY — do not fix anything. Respond with ONLY the JSON object described by the output schema, one entry per finding (BLOCKER/WARNING/INFO), \`rule\` naming which slicing-review section/violation it is (e.g. "V6 — Raw HTML Controls"). No prose, no markdown fences. Empty \`findings\` array if there is nothing to report.`;
}

export function buildGapCheckPrompt(bundle: RequirementBundle): string {
  return `You are auditing a feature's requirement documents for internal consistency BEFORE any code is written. You do not have file tools — everything you need is below.

${bundleBlock(bundle)}

Cross-reference the four sections above against each other. Flag:
- A field/scenario in Test Cases that has no corresponding element in UI Design
- An edge case in Functional with no explanation in UI Design
- A field in the OpenAPI spec path (${bundle.openApiPath}) not mentioned in any other section, or vice versa
- Any direct contradiction between two sections

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
      return buildTestContractPrompt(featureSlug, bundle);
    case "ui-slice":
      if (!contract) throw new Error("ui-slice prompt requires the test-contract phase's PageObjectContract");
      return buildUiSlicePrompt(featureSlug, bundle, contract);
    case "connect":
      return buildConnectPrompt(featureSlug, bundle);
    case "review":
      return buildReviewPrompt(featureSlug);
    default:
      throw new Error(`No prompt builder for gate-only phase "${phase}"`);
  }
}
