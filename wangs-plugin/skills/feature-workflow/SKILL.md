---
name: feature-workflow
description: End-to-end feature development workflow orchestrating the two layers — Data and UI — in strict sequence, with the e2e test contract authored between them. Use whenever a new feature is being built from scratch, or a complete slice lands in packages/features/. The UI layer always calls the design-system skill.
---

# Skill: End-to-End Feature Development Workflow

Use this skill whenever a new feature is built from scratch, or a complete slice (data → test-contract → ui) lands in `packages/features/`. This skill orchestrates the layer-specific rules and enforces the correct execution order.

**CRITICAL:** Before creating new files, restructuring an app, or implementing a new feature, read `docs/01-overview.md` and `docs/03-feature-pattern.md` in the target project first.

**This project has exactly two code layers: Data and UI.** There is no separate Model/Domain/Entity layer — the DTO type returned by the API (as defined by the OpenAPI spec) travels unchanged through DataSource → ViewModel → View. No mappers, no `XEntity → XDto → XViewModel` chains, no `model/` folder. If you find yourself creating a `model/` folder, stop; the type you need already exists as the DTO from the Data layer.

---

## Execution Order (Strict — Do Not Reorder)

```
1. Data layer  →  2. Test contract (Page Object + skeleton test)  →  3. UI slice  →  4. Connect
```

**Why Test comes before UI, not after:** the Page Object produced in step 2 is a *selector contract* the UI must fulfill — every accessible-name selector (`~name`, see below) declared there must exist on the rendered component. Writing UI first and testing after inverts that contract and is exactly the pattern that produces inconsistent selectors/structure across developers. Only the **authoring** of the test moves earlier — actually *running* it still happens last (step 5), since it needs the UI in place.

```
5. Run e2e (network-intercepted)  →  6. Lint & type-check  →  7. Review
```

---

## Step 1 — Data Layer

**Goal**: Generate DTOs, DataSource functions, and mock fixtures from an OpenAPI spec. The DTO **is** the entity type — nothing else is generated to represent it.

**Inputs required**: OpenAPI YAML spec. If not provided, stop and ask — never proceed from assumptions.

**Outputs**:
- `features/*/data/dto/index.ts` — request/response types, one source comment per type
- `features/*/data/datasource/[Feature]RemoteDataSource.ts` — pure async functions

Fixtures (`features/*/e2e/fixtures/*.json`) are authored in Step 2, not here — see below.

**Data Sources protocol** (`features/*/data/`):
- **OpenAPI spec required.** Never write a DTO or DataSource function from assumptions — every type must trace back to a request/response shape in the provided OpenAPI YAML. If no spec is provided, stop and ask.
- **DTO = entity type.** There is no separate model/entity file. The type defined in `data/dto/index.ts` is the exact, only type used by the DataSource, the ViewModel, and the View. Do not rename fields, do not add a mapping layer "for clarity" — one type travels across every layer.
- Each DTO file/type includes a source comment: `// Source: POST /api/v1/resource — openapi.yaml`.
- DataSource functions (`data/datasource/*.ts`) are pure `async` functions: no React, no hooks, no try/catch that swallows an error. Let it throw — the ViewModel maps the error to `errorMessage: string | null`.
- Uses the shared `http` client from `@wangs-foundation/infrastructure/http` — never raw `fetch`/`axios` inline.
- Fixtures: for every endpoint used by a feature, create one JSON fixture under `packages/features/<feature>/e2e/fixtures/` covering success, error, and edge-case response bodies — these are what `Spectra.intercept()` serves during e2e tests. Authored in the Test Contract step (this skill's Step 2), not here — fixtures are test-owned, not data-owned.

---

## Step 2 — Test Contract

**Goal**: Author the E2E project and skeleton test scripts from the Test Case document — before any UI exists.
This project uses TestSpectra (`@testspectra/cli`) — real, zero-import ambient-global E2E/component
testing, following its Nx-monorepo convention exactly.

**Inputs required**: Test Case `.md`, read via the `test-case-reader` subagent (never inline).

**Outputs**, under `features/*/e2e/` (a project of its own, separate from the feature library package):
- `e2e/project.json` — registers the Nx project (`projectType: application`, `tags:
  ["testspectra:e2e", "testspectra:scope:feature-<slug>"]`, `targets.e2e` running `spectra run` via
  `nx:run-commands`, with `android`/`ios`/`headless` configurations)
- `e2e/page-objects/[Screen]Page/web.ts` — one Page Object class per screen (default-exported
  singleton), one getter per element via `Spectra.get('~name')`
- `e2e/specs/[Suite]/suite.md` + `[Suite]/[TC-ID]/{spec.md,web.test.ts}` — one E2E test case per Test
  Case scenario, 100% zero-import (no `import`, no `describe`, exactly one `it()` per file)
- `e2e/fixtures/*.json` — one fixture per endpoint (success/error/edge), consumed as
  `Fixture.<camelCaseFileName>`

**Selector rule (mandatory — see `docs/03-feature-pattern.md`):**

| Selector | Meaning | Web attribute | React Native attribute | When to use |
|---|---|---|---|---|
| `~name` | accessibility id | `aria-label` | `accessibilityLabel` | **Default.** Anything a user can perceive. |
| `#name` | native id | `id` / `data-testid` is NOT used here — use `id` | `testID` | Only when the element genuinely has no accessible name (rare — confirm via `wangs-ui-querier`, never assume). |

Never author a selector against `data-testid`. It only serves the test; `aria-label`/`accessibilityLabel` serves the test **and** the screen reader, which is the entire point of this rule.

**Network mocking**: `const mock = await Spectra.intercept(url, method, fixturePayload, { statusCode });` —
the fixture argument is the raw response payload (not `{status, body}`). `await
mock.waitForCall({ timeout: 5000 });` IS the assertion — there is no `expect()` global in E2E specs (that
only exists in component tests, see below); never assert on `mock.callCount` with `expect`.

**Component tests (optional)**: only for a reusable presentational component worth verifying in isolation
(per the `component-spliting` skill's criteria) — a separate suite, run via `spectra test` instead of
`spectra run`, sharing the same `specs/` tree: `e2e/specs/[ComponentSuite]/[TC-ID]/{spec.md,web.test.tsx}`,
plus `e2e/test-utils.tsx` (a `withProviders()` helper wrapping only what the component needs). Real static
imports of the component under test ARE allowed here (unlike `.test.ts` E2E specs), with explicit `.js`
extensions (`moduleResolution: NodeNext`): `await Spectra.mount(withProviders(<TheComponent .../>));` then
assert with the same ambient DSL via a Page Object under the same `page-objects/` directory.

The test scripts will not pass yet at this point (no UI exists) — that is expected. They exist to be a target, not to run.

---

## Step 3 — UI Slice

**Goal**: Slice the screen into a ViewModel + View that fulfills the Step 2 Page Object contract.

**Inputs required**: `UI Design.md` (via `ui-design-reader`), `Functionality.md` (via `functional-reader`), Overview (via generic `research` subagent) — all three in parallel — plus the DTO from Step 1 and the Page Object from Step 2.

**Outputs**:
- `features/*/ui/screens/[Screen]/use[Screen]ViewModel.ts`
- `features/*/ui/screens/[Screen]/[Screen].tsx` (and `.native.tsx` only if a mobile target actually exists for this project — do not create speculative native files)
- Sub-components under `features/*/ui/components/` per the `component-spliting` skill
- `features/*/resources/Strings.ts`
- Form validators, if any, co-located with the screen that uses them (there is no separate `model/validators/` folder)

**Mandatory**: every sliced section must comply with the `design-system` skill. Query `wangs-ui-querier` before writing any `@wangs-ui` component — never assume a prop, especially the accessible-name prop needed for Step 2's contract.

**ViewModel rules**: no JSX, no platform-specific imports (`@wangs-ui/react-core`, `react-native`, etc. — those stay in the View), strings resolved here not in the View, `navigate()` called here, errors mapped to `errorMessage: string | null`, `isLoading` via plain `useState`.

**View rules**: no business state, no `t()`/`Strings.*` calls, no API calls, Wangs UI primitives only (no raw HTML controls, no raw HTML text elements — use `<Text>`), and every interactive/perceivable element carries its `aria-label`/`accessibilityLabel` per the Step 2 contract.

**Selector-fulfillment gate (mandatory before calling this step done):** for every selector declared in the Step 2 Page Object, confirm the matching `aria-label`/`accessibilityLabel` (or `id`/`testID` for the rare native-id case) is actually present on the rendered element. This is a mechanical check — grep for it — not a matter of judgment.

After each section, run the `slicing-review` skill (report only — do not auto-fix without explicit instruction).

---

## Step 4 — Connect

**Goal**: Wire the ViewModel's `useState`/`useEffect` to the real DataSource calls from Step 1 (fetch, loading, error mapping) — DTO fields flow straight into the ViewModel, no mapper.

Verify: DataSource is imported only from the ViewModel (never the View), no `try/catch` swallows an error silently, no platform-specific library is imported into the ViewModel.

---

## Cross-Layer Contracts (Mandatory)

| Contract | From → To | Rule |
|---|---|---|
| DTO = entity type | Data → everywhere | No separate model type is ever created. |
| Selector fulfillment | Test Contract → UI | Every `~name`/`#name` in the Page Object exists as `aria-label`/`accessibilityLabel`/`id`/`testID` on the rendered component. |
| Fixture ↔ DataSource shape | Data → Test | Fixtures match exactly what the DataSource function returns. |

---

## Subagent Dispatch Reference

| Task | Subagent |
|---|---|
| Read `UI Design.md` | `ui-design-reader` |
| Read `Functionality.md` | `functional-reader` |
| Read `Overview.md` | generic `research` |
| Read Test Case `.md` | `test-case-reader` |
| Query wangs-ui MCP (any component) | `wangs-ui-querier` |

Each PRD/spec document is read inside its own dedicated subagent — never inline in the main turn, never two documents in one subagent call. All four documentation subagents may run in parallel (they are independent) — spawn them in the same turn, not sequentially, unless one genuinely depends on another's output. `wangs-ui-querier` gets its own isolated invocation per query session — never combined with a documentation read.

The subagent's returned report is the **authoritative source** for everything downstream — never supplement with inferred structure. If the report reveals an ambiguity or contradiction with another document, that becomes a clarification item, not something to silently resolve by guessing.
