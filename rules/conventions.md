# Conventions — Wangs Foundation

Naming, file structure, import order, and lint rules. Consistent conventions reduce cognitive load — the code reads the same regardless of who wrote it.

---

## Naming

### Files

| What              | Convention                  | Example                          |
| ----------------- | --------------------------- | -------------------------------- |
| React component   | `PascalCase.tsx`            | `LoginPassword.tsx`              |
| React hook        | `camelCase.ts`              | `useLoginPasswordViewModel.ts`   |
| Data source       | `PascalCase.ts`             | `AuthRemoteDataSource.ts`        |
| DTO types         | `index.ts` in `dto/` folder | `data/dto/index.ts`              |
| Strings resource  | `Strings.ts`                | `resources/Strings.ts`           |
| Utility functions | `camelCase.ts`              | `formatDate.ts`                  |
| tsdown config     | `tsdown.config.ts`          | `packages/core/tsdown.config.ts` |

### Variables and Functions

| What                                      | Convention                               | Example                                                    |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| React components                          | `PascalCase`                             | `function LoginPassword()`                                 |
| Hooks                                     | `camelCase`, prefix `use`                | `useLoginPasswordViewModel`                                |
| String constants                          | `UPPER_SNAKE_CASE`                       | `TITLE_LOGIN`                                              |
| Route values (`staticRoute`/`paramRoute`) | `PascalCase`                             | `CatalogList`, `CatalogDetail` — see `rules/navigation.md` |
| TypeScript types                          | `PascalCase`, suffix `Dto` for API types | `LoginPasswordBodyDto`                                     |
| Boolean state                             | `is`, `has`, `can` prefix                | `isLoading`, `hasError`, `canSubmit`                       |
| Event handlers                            | `on` prefix                              | `onSubmit`, `onCancel`, `onDismiss`                        |

---

## Import Order

oxfmt enforces this automatically. Imports are sorted in this order:

1. External packages (`react`, `axios`, `motion`)
2. Workspace packages (`@wangs-foundation/core`, `@wangs-foundation/infrastructure`, `@wangs-ui/*` — the actual scope is detected per project, `@wangs-foundation` here is illustrative)
3. Relative imports (`./ViewModel`, `../data`)

Blank line between each group. Single quotes only.

```typescript
import { useFormControl } from "@wangs-ui/form/react";
import { useNavigation } from "@wangs-ui/react-navigation/web";
import { CatalogList } from "@wangs-foundation/core/routes/catalog";

import Strings from "../../../resources/Strings";
import { loginWithPassword } from "../../../data";
```

---

## Strict Typing & React Compiler Rules

Not duplicated here — see `rules/typescript-strict-typing.md` for `any` vs `unknown`, discriminated unions, narrowing, and type assertions; `rules/react19-compiler-typescript.md` for `useEffect` dependencies, manual memoization (don't use it), and prop mutation.

---

## Text Elements

Every text element **must** use `<Text>` from `@wangs-ui/foundation/theme`. The component already handles font family, size, weight, and color tokens — no manual styling needed.

Only reach for a different element when `<Text>` genuinely cannot cover the requirement (e.g. `<Code>`, `<Kbd>`, `<Link>`, `<Mark>`, `<Blockquote>`, `<List>` from the same package for semantically distinct content).

```tsx
// BLOCKER — raw HTML text elements
<h1>Welcome back</h1>
<p>Please sign in to continue.</p>

// Correct — Wangs UI Text primitive
import { Text } from '@wangs-ui/foundation/theme';

<Text variant="titleMedium" className="text-on-surface font-bold">
  {vm.labels.title}
</Text>
<Text variant="bodySmall" className="text-on-surface font-normal">
  {vm.labels.subtitle}
</Text>
```

See the `design-system` skill (§1) for the token-to-context mapping (page titles, form labels, table cells, modal headers, etc.).

---

## ViewModel Checklist

Before committing a ViewModel, verify:

- [ ] No JSX returned
- [ ] No `window`, `document`, or native-only APIs imported
- [ ] All strings resolved from `Strings.*` (View never calls `t()`)
- [ ] All dates and numbers formatted before returning
- [ ] `navigator.push`/`replace`/`pop` called here, not in the View — see `rules/navigation.md`
- [ ] All `useEffect` dependency arrays complete
- [ ] `void` prefix on all unhandled promises

## View Checklist

Before committing a View, verify:

- [ ] No `useState` for business state (loading, error, data)
- [ ] No `t()`, `Strings.*`, or `formatDate()` calls
- [ ] No `useNavigation()`/`navigator.push`/`replace`/`pop` calls
- [ ] No API calls (`fetch`, `axios`, `useMutation`)
- [ ] Only UI-only state is allowed: hover, focus, scroll position, animation toggle

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add asset detail screen
fix: correct OTP expiry handling in login flow
refactor: extract error message helper to @wangs-foundation/core/utility
chore: update tsdown to 0.23.0
docs: add cross-platform guide
```
