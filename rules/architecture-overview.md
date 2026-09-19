# Architecture Overview — Wangs Foundation

## Guiding Principles

1. **Pragmatic over pure.** If added complexity doesn't solve a real problem today, skip it.
2. **No mappers, no model duplication.** One type — the DTO — travels across every layer. No `XEntity → XDto → XViewModel` chains. There is no Model/Domain layer.
3. **UI is dumb.** The View receives ready-to-display values and calls handlers. It does not format, derive, or validate.
4. **Server is the source of truth.** Client-side state is minimal and transient.
5. **Dependency points inward.** Outer layers depend on inner layers, never the reverse.
6. **Every perceivable element has a real accessible name.** On web, TestSpectra resolves `~name` against `aria-labelledby`, `aria-label`, or `title` (in that priority order) — default to `aria-label` when writing new code. On React Native, `accessibilityLabel`. Never a `data-testid`-only attribute. One attribute, two audiences: assistive tech and the e2e test.

## Layer Map

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web  │  apps/mobile (once it exists)      (Entry Points)  │
├─────────────────────────────────────────────────────────────────┤
│  packages/features/*         (ViewModel + View + DataSource)    │
├─────────────────────────────────────────────────────────────────┤
│  packages/infrastructure     (HTTP, Navigation, Storage)        │
├─────────────────────────────────────────────────────────────────┤
│  packages/core               (Routes, Config, Utilities)        │
│  packages/assets             (Images, Fonts)                    │
└─────────────────────────────────────────────────────────────────┘
```

Data access code (DataSource, DTO) lives **inside the feature that owns it**. When two features need the same data, extract to `packages/core/data/` at that point — not upfront.

### Dependency Rules

| Layer            | May import from                                  | Must NOT import from          |
| ---------------- | ------------------------------------------------ | ----------------------------- |
| `apps/*`         | `features/*`, `infrastructure`, `core`, `assets` | Other `apps/*`                |
| `features/*`     | `infrastructure`, `core`, `assets`               | Other features' UI or `data/` |
| `infrastructure` | `core`                                           | `features/*`, `apps/*`        |
| `core`           | Nothing                                          | Everything else               |

Features communicate through navigation only — never by importing each other's screens.

## What We Deliberately Don't Have

| Pattern                                       | Why skipped                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `model/` folder, or any Domain/Entity layer | One shared DTO type across all layers — no mapper, no duplication. This is not a placeholder omission; it's the architecture. A validator shared across screens within one feature has its own home — see the `feature-workflow` skill's validator placement table — that is not a reason to bring this folder back. |
| Repository interfaces per feature             | Overkill for a single-bundle app; data access is a plain async function.                                                                                                                                                                                                                                             |
| A state management library                    | `useState` + `useEffect` handles state; `useFormControl` handles forms.                                                                                                                                                                                                                                              |
| `data-testid` as the e2e selector             | `aria-label`/`title`/`accessibilityLabel` serves both the test and the screen reader — see `rules/feature-pattern.md`.                                                                                                                                                                                               |

## Cross-Platform Status

Most Wangs Foundation projects ship **Web only** at first. When a React Native target is added, the `@wangs-ui/react-core` component API is assumed identical across platforms for anything that exists on both — confirm via the `wangs-ui-querier` subagent, never assume. Mobile-only primitives (`BottomSheet`, native gesture components) are the explicit exception — see the `design-system` skill (§0).
