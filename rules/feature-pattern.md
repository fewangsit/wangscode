# Feature Pattern — Wangs Foundation

A feature is a vertical slice of business capability. Every feature follows the same two-layer structure.

## Folder Structure

```
packages/features/[feature]/
├── index.ts                          # Public API — route registrations only
├── resources/Strings.ts              # All user-facing strings
├── data/
│   ├── datasource/[Feature]RemoteDataSource.ts
│   ├── dto/index.ts                  # Request/response types — these ARE the entity types
│   └── index.ts
├── ui/
│   ├── components/
│   ├── validators/                   # Only if shared across multiple screens in this feature
│   └── screens/[ScreenName]/
│       ├── use[ScreenName]ViewModel.ts
│       └── [ScreenName].tsx          # (+ .native.tsx once mobile exists)
└── e2e/                               # TestSpectra Nx e2e-project — its own project.json
    ├── project.json
    ├── page-objects/[Screen]Page/web.ts
    ├── specs/[Suite]/suite.md + [Suite]/[TC-ID]/{spec.md,web.test.ts}
    │                                  # (+ web.test.tsx component tests, run via `spectra test`,
    │                                  #  only for a component worth verifying in isolation)
    └── fixtures/*.json
```

There is no `model/` folder. If you're about to create one, stop — see `rules/architecture-overview.md`.

## The Three Pieces

### 1. DataSource (`data/datasource/`)

```typescript
import { http } from "@wangs-foundation/infrastructure/http";
import type { CatalogItemDto } from "../dto";

export const getCatalogItems = async (): Promise<CatalogItemDto[]> => {
  const res = await http.get<CatalogItemDto[]>("/v1/catalog");
  return res.data;
};
```

Rules: returns a typed value or throws (no silent `try/catch`); types come from `data/dto/` only; never imported by a View directly, always through a ViewModel.

### 2. ViewModel (`use[ScreenName]ViewModel.ts`)

- No JSX returned.
- No direct API calls — DataSource functions only.
- Strings resolved here via `t(Strings.KEY)`, passed to the View as plain values.
- Navigation (`useNavigate`) lives here.
- Platform-agnostic imports only — no `@wangs-ui/react-core`, `@wangs-ui/react-icons`, `react-native`. Use cross-platform subpaths (`@wangs-ui/form/react`, `@wangs-ui/react-i18n`) or move the dependency into the View.
- Errors caught and mapped to `errorMessage: string | null`.

### 3. View (`[ScreenName].tsx`)

- No `useState`/`useEffect` except pure UI state (hover, focus, animation toggle).
- No `t()`, `Strings.*`, `formatDate()` — the ViewModel already resolved these.
- No API calls, no `navigate()`.
- Wangs UI primitives only — no raw HTML controls, no raw HTML text elements (`<h1>`–`<h6>`, `<p>`, `<span>` for copy — use `<Text>` from `@wangs-ui/foundation/theme`).
- **Every interactive/perceivable element carries a real accessible name with a real, human-meaningful value.** This is not optional and is not satisfied by a `data-testid`-only attribute.

## The a11y Selector Contract

The e2e Page Object is authored against accessibility attributes, matching TestSpectra's own `~name`/`#name` selector contract (`docs/v2/cli/selectors.md` in the TestSpectra source):

| Selector                   | Web attribute                                                       | Native attribute     | When                                                                                        |
| -------------------------- | ------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `~name` (accessibility id) | `aria-labelledby`, `aria-label`, or `title` (checked in that order) | `accessibilityLabel` | **Default** — any element a user can perceive. Prefer `aria-label` when writing new code.   |
| `#name` (native id)        | `id`                                                                | `testID`             | Only when the element has no accessible name (confirm via `wangs-ui-querier`, never assume) |

```tsx
// Correct
<Button aria-label="submit-catalog-item" label={vm.labels.submit} onClick={vm.onSubmit} />
// → Spectra.get('~submit-catalog-item') in the Page Object

// Wrong — data-testid only serves the test, not a screen reader
<Button data-testid="submit-catalog-item" label={vm.labels.submit} onClick={vm.onSubmit} />
```

## Cross-Feature Navigation

```typescript
// Correct
void navigate(Routes.Catalog.List);
// Wrong
import { CatalogListScreen } from "@wangs-foundation/feature-catalog/ui/screens/CatalogList";
```

## `index.ts` Public API

```typescript
// packages/features/catalog/index.ts
export { featureCatalogGraph } from "./graph"; // route registration only
```
