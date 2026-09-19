---
name: slicing-review
description: Systematic review protocol for newly created features in packages/features to verify alignment with architecture docs (feature pattern, data layer, error handling, naming conventions, a11y selector contract, and Wangs UI component rules).
---

# Skill: Feature Slicing Review

Use whenever a new screen/ViewModel/DataSource lands in `packages/features/`, or the user asks to review/audit a feature against the docs.

## 1. Read the Architecture Docs First

```
docs/01-overview.md         — dependency rules & the two-layer map (Data, UI)
docs/03-feature-pattern.md  — folder structure, ViewModel/View/DataSource rules, a11y selector contract
docs/10-conventions.md      — naming, import order, checklists
```

## 2. Map the Feature's File Tree

```
packages/features/[feature]/
├── index.ts                          ✓ Public API — route exports only
├── resources/Strings.ts              ✓ All user-facing strings
├── data/
│   ├── datasource/[Feature]RemoteDataSource.ts   ✓ API calls only
│   ├── dto/index.ts                  ✓ Request/response types (= entity types)
│   └── index.ts
└── ui/
    ├── components/
    └── screens/[Screen]/
        ├── use[Screen]ViewModel.ts
        └── [Screen].tsx
```

**Flag immediately as a BLOCKER if a `model/` folder exists anywhere in the feature.** This project has no Model layer (see `docs/01-overview.md`) — a `model/` folder is either leftover from a stale template or a misunderstanding of the pattern.

## 3. ViewModel Checklist

| Check | Rule |
|---|---|
| No JSX returned | ViewModel returns plain values only |
| No `window`/`document`/native-only APIs | Platform-agnostic |
| No platform-specific library imports | Not `@wangs-ui/react-core`, `@wangs-ui/react-icons`, `react-native` — use cross-platform subpaths only |
| Strings resolved from `Strings.*` via `t()` | View never calls `t()` |
| `navigate()` called here | Not in the View |
| Errors mapped to `errorMessage: string \| null` | See error flow below |
| `isLoading` via plain `useState` | No external query library |

## 4. View Checklist

| Check | Rule |
|---|---|
| No business state (`useState` for loading/error/data) | Belongs in ViewModel |
| No `t()`/`Strings.*`/`formatDate()` | Resolved in ViewModel |
| No API calls | Never imports a DataSource |
| Wangs UI primitives only | No raw HTML controls, no raw HTML text elements — use `<Text>` |
| **Every interactive/perceivable element has `aria-label` (web) or `accessibilityLabel` (native)** | This is the a11y selector contract — not optional, and not satisfied by `data-testid` alone |
| Top-level screen/tab components take no props | Shared state flows through React Context in `ui/context/` |

## 5. DataSource & DTO

| Check | Rule |
|---|---|
| Pure `async` functions, no React | Isolated data access |
| Returns typed value or throws | No silent `try/catch` swallowing |
| Imports types from `../dto` only | No cross-feature type imports |
| Uses shared `http` client | No raw `fetch`/`axios` |
| DTO types match the API shape exactly | No renaming, no transform layer — this IS the entity type |

## 6. Error Handling Flow

```
DataSource → throws (no silent catch)
  → ViewModel catch → errorMessage: string | null
    → View renders vm.errorMessage
```

BLOCKER if: DataSource swallows an error and returns `null`; ViewModel doesn't catch; View does `error instanceof AxiosError` itself; error message hardcoded in View JSX.

## 7. a11y Selector Contract (New — Mandatory)

For every interactive or otherwise perceivable element, verify:
- It has `aria-label` (web) / `accessibilityLabel` (native) set to a real, human-meaningful string — not a placeholder or the component's internal id.
- If the element genuinely cannot carry an accessible name (rare), it falls back to `id`/`testID` and this is called out explicitly in the review, not silently accepted.
- The attribute value matches exactly what the feature's Page Object (`e2e/page-objects/`) expects.

BLOCKER if a `data-testid`-only attribute is used for a test hook instead of `aria-label`/`accessibilityLabel`.

## 8. Dependency Rules

| Layer | May import from | Must NOT import from |
|---|---|---|
| `features/*` | `infrastructure`, `core`, `assets`, `@wangs-ui/*` | Other features' UI or `data/` |
| ViewModel | `infrastructure/navigation`, `core/routes`, `data/*`, cross-platform `@wangs-ui/*` subpaths | Other features, browser APIs, platform-specific `@wangs-ui/*`/`react-native` |
| View | its own ViewModel (relative import), `@wangs-ui/*` primitives | DataSource, `infrastructure`, other features |
| DataSource | `infrastructure/http`, `core/data` (shared types) | React, hooks, navigation |

Features communicate by route only:

```typescript
// BLOCKER
import { AssetDetailScreen } from '@wangs-foundation/feature-asset/ui/screens/AssetDetail';
// Correct
void navigate(Routes.Asset.Detail, { id: assetId });
```

## 9. Naming Conventions

| File type | Convention | Example |
|---|---|---|
| React component | `PascalCase.tsx` | `CatalogList.tsx` |
| ViewModel hook | `camelCase.ts` | `useCatalogListViewModel.ts` |
| DataSource | `PascalCase.ts` | `CatalogRemoteDataSource.ts` |
| Hook name | `use` + `PascalCase` + `ViewModel` | `useCatalogListViewModel` |
| Boolean state | `is`/`has`/`can` prefix | `isLoading` |
| Event handlers | `on` prefix | `onSubmit` |

## 10. `index.ts` Public API

Exposes only route registrations — never a ViewModel, a DataSource function, or an internal component.

---

## Severity Classification

| Severity | Definition |
|---|---|
| BLOCKER | Violates a core architectural contract (raw HTML, `model/` folder, swallowed error, `data-testid`-only selector, cross-feature import) |
| WARNING | Convention deviation (missing `void`, business state for a non-critical flag) |
| INFO | Style/naming note |

## Report Format

```markdown
## Slicing Review: `packages/features/[feature]`

### Summary
- Files reviewed: N — Blockers: X — Warnings: Y — Info: Z

### BLOCKER Issues
1. `[path]:[line]` — [description] (Reference: [doc/skill section])

### WARNING Issues
...

### Passing
...

### Recommended Fixes
(incorrect code → correct replacement, for every BLOCKER/WARNING)
```
