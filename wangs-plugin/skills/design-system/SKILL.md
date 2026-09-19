---
name: design-system
description: Structural rules for using Wangs UI consistently across Web (and, once added, React Native) — typography tokens, layout/spacing hierarchy, component primitive standards, and the a11y selector contract. Generic foundation template — project-specific copy/business rules belong in the consuming project's own docs, not here.
---

# Skill: Design System Usage (Foundation Template)

Use this skill whenever you write, slice, refactor, or style a component/screen. This file is the **structural** source of truth — token usage, layout hierarchy, component primitive standards, cross-platform assumptions. It is deliberately generic: business-specific copy (empty-state wording, entity-specific column orders, brand strings) belongs in the _consuming project's_ own skill/doc, layered on top of this one, not baked in here.

---

## 0. Cross-Platform Assumption (Read First)

This project currently ships **Web only** (`.tsx`). A React Native target does not exist yet. When it is added:

- **Assume the `@wangs-ui/react-core` component API is identical** between Web and Native for any primitive that exists on both platforms (`Button`, `Input`, `Select`, `DataTable`, `Card`, `Dialog`, `Text`, etc.) — same prop names, same semantics, just a different rendered output. Do not invent platform-specific prop names without confirming via `wangs-ui-querier` first.
- **Mobile-only primitives are the exception, not the rule.** Components that only make sense on a touch/native surface — `BottomSheet`, native `ActionSheet`, gesture-driven components — have **no Web equivalent** and must not be simulated with a Web substitute (e.g. don't fake a `BottomSheet` with a `Dialog` on Web). When a screen needs one, the View file diverges (`Screen.tsx` uses a Web-appropriate pattern like `Dialog`/`Popover`; `Screen.native.tsx` uses the real `BottomSheet`) while the ViewModel stays the same, exactly per `docs/03-feature-pattern.md`'s Superset Pattern.
- Before assuming any component exists on both platforms, query `wangs-ui-querier` — it is the only source of truth for what a given `@wangs-ui/*` version actually exports on each platform.

---

## 1. Typography

All text uses `<Text>` from `@wangs-ui/foundation/theme` with an explicit `variant`. Never mix arbitrary font sizes or raw HTML text elements (`<h1>`–`<h6>`, `<p>`, `<span>`) — those bypass the design system's font/color tokens entirely. Only reach for a sibling primitive (`<Code>`, `<Kbd>`, `<Link>`, `<Mark>`) when `<Text>` genuinely cannot express the content's semantics.

Define your own token-to-context mapping (page titles, form labels, table cells, modal headers, etc.) in a short table here once the consuming project's UI Design docs establish it — don't guess it project-by-project.

---

## 2. Layout & Spacing Hierarchy

Standardize page structure once and reuse it everywhere a list/detail/form screen appears:

```
Breadcrumb / sub-nav
        │  gap between breadcrumb and content card
        ▼
Content Card (background, shadow, rounded corners)
   │  internal padding
   ▼
  Tab menu (if the screen has tabs)
   │  gap
   ▼
  Page content (DataTable / Form / whatever the screen needs)
```

Pick concrete spacing values (padding, gaps) once per project and record them here — don't invent new values per screen.

---

## 3. Component Primitive Standards (Mandatory)

Always use real Wangs UI components, imported via their documented subpath — never raw unstyled HTML:

- Buttons/actions: `Button` from `@wangs-ui/react-core/primitive/button`
- Forms: `useFormControl` (`@wangs-ui/form/react`), `<Form>`/`<Field>`/`<Input>`/`<Select>` from `@wangs-ui/react-core/primitive/*`
- Data grids: `DataTable` (`@wangs-ui/react-core/primitive/datatable`) with `useDataTable`
- Overlays: `Dialog`/`Modal`/`DialogForm` from `@wangs-ui/react-core/primitive/*` on Web; the platform-native equivalent (e.g. `BottomSheet`) on Native per §0
- Internationalization: every user-facing string wrapped in `t('...')` from `useI18n()` (`@wangs-ui/react-i18n`)

Query `wangs-ui-querier` before using any prop you haven't verified — this applies equally to a component's accessible-name prop (§4).

---

## 4. Accessibility & the Selector Contract (Mandatory)

Every interactive or otherwise perceivable element must carry a real accessible name:

| Platform     | Attribute                                                                                     | Selector prefix (e2e) |
| ------------ | --------------------------------------------------------------------------------------------- | --------------------- |
| Web          | `aria-label` (default) — `aria-labelledby`/`title` also resolve, TestSpectra checks all three | `~name`               |
| React Native | `accessibilityLabel`                                                                          | `~name`               |

This is not a testing convenience layered on top of the design system — it **is** the design system's a11y baseline, and it happens to also be what the e2e Page Object contract (`docs/03-feature-pattern.md`) is built on. One attribute, two purposes. Never add a `data-testid`/`testID`-only attribute as a substitute — if a component has no accessible-name prop, confirm that via `wangs-ui-querier` first (don't assume), and only then fall back to `id`/`testID` (`#name` selector). Default to `aria-label` when writing new components — `aria-labelledby` (references another element's text) and `title` exist as fallbacks TestSpectra also resolves, not alternatives to reach for by default.

---

## 5. Project-Specific Extensions

Once this foundation is used for a real project, extend — don't rewrite — this file (or layer a project-specific skill on top of it) with:

- Exact spacing/token values for §2
- The project's canonical table column ordering, empty-state copy, dialog button conventions, etc.
- Any component usage patterns specific to that project's domain

Keep those additions in the consuming project's own docs, not in this template, so this file stays reusable for the _next_ project too.
