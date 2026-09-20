# Navigation — Wangs Foundation

Navigation is `@wangs-ui/react-navigation` (real, published npm package — same org as
`@wangs-ui/react-core`/`@wangs-ui/mcp`/`@wangs-ui/skills`, not the illustrative
`@wangs-foundation/*` scope used elsewhere in these rules). It is a real dependency of the
project, not something to hand-roll per project. Never implement a custom router, a custom
`FeatureGraphBuilder`, or a custom `navigate()` helper — that package already exists and is the
one dependency every feature's navigation code goes through.

---

## Routes Are Typed Values, Not Path Strings

`packages/core/routes/` defines routes with `staticRoute`/`paramRoute` from
`@wangs-ui/react-navigation` — mirroring Jetpack Compose's `data object`/`data class` route
pattern: a `staticRoute` is a value used directly (no params), a `paramRoute` is a constructor
called with concrete, typed params.

```typescript
// packages/core/routes/catalog.ts
import { staticRoute, paramRoute } from "@wangs-ui/react-navigation";

export const CatalogList = staticRoute("catalog");
export const CatalogDetail = paramRoute<{ id: string }>("catalog/:id");
```

Route definitions carry **no screen/component reference** — that pairing happens where the route
is registered (see below), not where it's declared. This is what lets any feature import a route
to navigate to it (`navigator.push(CatalogList)`) without importing the feature that implements
the screen, its ViewModel, or any of its dependencies. `packages/core` may depend on nothing else
(see `rules/architecture-overview.md`'s dependency table) — `@wangs-ui/react-navigation`'s own
route-definition exports (`staticRoute`, `paramRoute`) are the one external exception, since they
carry no React/platform-specific code themselves.

```typescript
// ❌ Wrong — bare string, no type checking on params
void navigate("catalog/:id", { id: "123" });

// ✅ Correct — typed route value, TS error if params are wrong/missing
import { CatalogDetail } from "@wangs-foundation/core/routes/catalog";
navigator.push(CatalogDetail({ id: "123" }));
```

## Registering Routes: `composable` / `navigation` / `buildGraph`

Each feature's `index.ts` (or a dedicated `graph.ts` it re-exports — see `rules/feature-pattern.md`)
registers its screens against its own routes:

```typescript
// packages/features/catalog/graph.ts
import { composable, navigation, buildGraph, type Graph } from "@wangs-ui/react-navigation";
import { CatalogList, CatalogDetail } from "@wangs-foundation/core/routes/catalog";

import { CatalogListScreen } from "./ui/screens/CatalogList/CatalogList";
import { CatalogDetailScreen } from "./ui/screens/CatalogDetail/CatalogDetail";

export function featureCatalogGraph(graph: Graph): Graph {
  return buildGraph(
    graph,
    navigation(CatalogList, CatalogListScreen, (g) => buildGraph(g, composable(CatalogDetail, CatalogDetailScreen))),
  );
}
```

The app entry point (`apps/*`) is the only place that calls `emptyGraph()` and threads every
feature's graph function together, then hands the result to the platform bridge:

```typescript
// apps/web/App.tsx
import { emptyGraph, buildGraph, Router, ReactRouterNavigationContent } from "@wangs-ui/react-navigation/web";
import { featureCatalogGraph } from "@wangs-foundation/feature-catalog";
import { featureOrdersGraph } from "@wangs-foundation/feature-orders";

const routes = buildGraph(emptyGraph(), featureCatalogGraph, featureOrdersGraph);

export function App() {
  return (
    <Router>
      <ReactRouterNavigationContent routes={routes} />
    </Router>
  );
}
```

- `composable(route, Component)` — a leaf screen.
- `navigation(route, LayoutComponent, buildChildren, { startDestination? })` — a nested group.
  Give `startDestination` when the group has no meaningful screen of its own (e.g. an `auth` group
  whose own path should never be shown — only `auth/login`/`auth/register` are real screens);
  omit it when the group's own component is a real, directly reachable screen.
- `buildGraph(graph, ...steps)` threads a `Graph` through registration steps left to right —
  never mutates its input, so a feature's own `buildGraph` call composes safely with every other
  feature's.

## Navigating: `useNavigation()`

Only ever called from a ViewModel (`use[ScreenName]ViewModel.ts`) — never from a View. This is the
same rule `rules/feature-pattern.md` and `rules/conventions.md` already state for navigation in
general; it now has one concrete API to point at:

```typescript
import { useNavigation } from "@wangs-ui/react-navigation/web"; // or /native — same call, same import path convention as every other cross-platform subpath import
import { CatalogDetail } from "@wangs-foundation/core/routes/catalog";

export function useCatalogListViewModel() {
  const { navigator } = useNavigation();

  const onItemPress = (id: string) => {
    navigator.push(CatalogDetail({ id }));
  };

  return { onItemPress };
}
```

`navigator.push`/`navigator.replace` take a route **value** (a `staticRoute` used directly, or a
`paramRoute` called with params) — never a bare path string, never a loose params object. `pop()`
takes nothing. See `@wangs-ui/react-navigation`'s own `docs/API.md` for the full surface
(`Navigator`, `RouteConfig`, `flattenRoutes`, `matchRoute`, `buildPath`) if a case isn't covered
here.

## Cross-Feature Navigation

Features communicate through navigation only — confirmed in `rules/architecture-overview.md`'s
dependency table. Never import another feature's screen directly:

```typescript
// ✅ Correct
navigator.push(CatalogList);

// ❌ Wrong
import { CatalogListScreen } from "@wangs-foundation/feature-catalog/ui/screens/CatalogList/CatalogList";
```

## Checklist Additions

**ViewModel** (extends `rules/conventions.md`'s ViewModel checklist):

- [ ] `navigator.push`/`replace`/`pop` called here, not in the View — a bare path string never
      appears; every call site uses a `staticRoute` value or a `paramRoute(...)` call.

**View** (extends `rules/conventions.md`'s View checklist):

- [ ] No `useNavigation()` call, no `navigator.push`/`replace`/`pop` call.
