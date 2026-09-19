---
name: component-spliting
description: >
  Decision protocol for whether a component inside packages/features/*/ui/ or packages/core/ui/
  should be split into smaller sub-components. Grounded in React's "Thinking in React"
  single-responsibility principle and this project's View-only constraint (no state, no
  business logic in components).
---

# Skill: Component Splitting Decision Protocol

Use before writing or refactoring any TSX file inside `packages/features/[feature]/ui/` or a shared `packages/core/ui/` (if the project adds one).

> **Scope constraint**: only touch code inside the `ui/` folder of a feature. Never move UI pieces into `data/` — there is no `model/` folder to move them into either. This project has exactly two code layers, Data and UI (see the `feature-workflow` skill).

## 1. Activation Conditions

- A screen file grows beyond ~80 lines of JSX
- A component in `ui/components/` starts accepting more than ~5 props
- You're tempted to duplicate a visual block across two screens
- Unsure whether to extract a chunk of JSX into its own file

## 2. Core Principle

A component has one responsibility when it (1) renders one visual concept, (2) has no business state — all data flows in as props from the ViewModel, and (3) doesn't call `useFormControl`, `useNavigate`, `useI18n`, or any datasource.

## 3. The Four-Question Gate

If **any** answer is YES, extract the component:

| # | Question |
|---|---|
| Q1 | Does this JSX block do more than one visual thing? |
| Q2 | Is it longer than ~40 lines? |
| Q3 | Could it appear on a different screen unchanged? |
| Q4 | Does it contain a hook beyond `vm.*`? (Business logic leaking into the View — extract AND move the logic to the ViewModel) |

## 4. Placement

| Component type | Location |
|---|---|
| Used by one feature only | `packages/features/[feature]/ui/components/` |
| Used by two or more features | `packages/core/ui/components/` (purely presentational — no feature-specific types/strings) |
| Screen root (route entry) | `packages/features/[feature]/ui/screens/[Screen]/[Screen].tsx` |

## 5. Props Contract Before Writing

Define the prop `interface` before the JSX. Ready to extract when: 1–5 typed fields, every field comes from the ViewModel's return value (not computed locally), no prop is `any` or a raw API/DTO type passed straight through.

```tsx
// Ready
interface RowProps { name: string; email: string; onEdit: () => void; }

// NOT ready — raw DTO leaking, too many handlers
interface RowProps { item: ItemDto; onEdit: () => void; onDelete: () => void; onToggle: () => void; onView: () => void; }
```

## 6. Final Checklist

- File inside `ui/` only
- `PascalCase.tsx` filename
- Named function export
- Only `useState` for pure UI state allowed (`isOpen`, `isHovered` — never `isLoading`/`data`/`errorMessage`)
- No `t()`/`Strings.*`/`formatDate()` — text arrives as resolved `string` props
- No navigation, no datasource imports
- Re-exported from the feature's `ui/components/index.ts`

## 7. Anti-Patterns to Reject

| Anti-pattern | Fix |
|---|---|
| Component calls `useI18n()` | Resolve in ViewModel, pass string prop |
| Component calls `useNavigate()` | Move to ViewModel handler |
| Component imports a datasource | Remove; ViewModel fetches, passes resolved values |
| Component has `isLoading`/`errorMessage` state | Move to ViewModel |
| Two features share a component via direct import | Move to `packages/core/ui/components/` |
| Splitting a 5-line block "for cleanliness" | Over-engineering — keep it inline |
