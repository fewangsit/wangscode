# Packages — Wangs Foundation

What every package in the monorepo is, what it exposes, and what it must never do. Complements the
`architecture-overview` rule's layer map with per-package detail.

---

## `core` (e.g. `@wangs-foundation/core` — actual scope detected per project)

**Role**: Pure TypeScript utilities. No React, no browser APIs, no network calls.

```
packages/core/
├── routes/      # Route values — staticRoute/paramRoute from @wangs-ui/react-navigation
├── config/      # Env-based config (API base URL, feature flags)
├── utility/     # Pure helper functions (date formatting, string utils)
├── data/        # Shared TypeScript types used across the monorepo
└── ui/          # (Reserved) design tokens consumed by styling tools
```

**Rules**:

- Every export must work in Node.js, a browser, and React Native without modification.
- No `import React` anywhere in this package.
- `routes/` defines route **values** via `staticRoute`/`paramRoute` — not navigation logic, and no
  screen/component references. See `rules/navigation.md`.
- `data/` holds **shared types** (DTOs, response shapes) used by two or more features. These are the only cross-feature type definitions. No duplication across layers.

**Exports**:

```typescript
import { CatalogList } from "@wangs-foundation/core/routes/catalog";
import { config } from "@wangs-foundation/core/config";
import { formatDate } from "@wangs-foundation/core/utility";
```

---

## `assets` (e.g. `@wangs-foundation/assets`)

**Role**: Static assets — images, SVGs, fonts.

```
packages/assets/
└── index.ts     # Re-exports all assets
```

**Rules**:

- No logic. Just `export const Logo = ...` and similar.
- SVG files are handled at the app level (Vite for web, Metro/bundler for native). This package just re-exports the raw imports.

---

## `infrastructure` (e.g. `@wangs-foundation/infrastructure`)

**Role**: Platform adapters for HTTP and storage. These are the only project-owned places that touch browser APIs or React Native APIs — navigation's own platform adapters live inside `@wangs-ui/react-navigation` itself, not here.

```
packages/infrastructure/
├── http/        # The shared http client — the only HTTP implementation
└── storage/     # Keyed value storage adapters
```

Navigation is not hand-rolled here — it's `@wangs-ui/react-navigation`, a real published
dependency of the project. See `rules/navigation.md`.

### `infrastructure/http`

```typescript
import { http } from "@wangs-foundation/infrastructure/http";
```

- `get<T>(url, config?)`, `post<T>(url, body?, config?)`, `put`, `patch`, `delete` — same shape a DataSource function calls directly (see the `feature-pattern` rule).
- Storage is used **only** for non-sensitive, non-auth client-side persistence (e.g., UI preferences, locale) — never for tokens or session data; how a given project's server authenticates the client (cookie, header, etc.) is a project-level decision, not prescribed here.

---

## `packages/features/*`

Each feature is a self-contained package. See the `feature-pattern` rule.

---

## `apps/*`

**Role**: Entry points only. They:

1. Bootstrap providers (theme, `Router`/`StackNavigationProvider` from `@wangs-ui/react-navigation`).
2. Compose every feature's graph function via `buildGraph` — see `rules/navigation.md`.
3. Inject runtime config.

They contain **zero business logic**.
