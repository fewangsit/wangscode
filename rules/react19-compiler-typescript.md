# React 19 + TypeScript with the React Compiler

Applies whenever writing, generating, reviewing, or refactoring React components, hooks,
or props in TypeScript/TSX — including code that manually wraps things in
`useMemo`/`useCallback`/`React.memo`, uses `forwardRef`, mutates props/state, or needs
typing for Actions, `useOptimistic`, `use()`, or refs. Applies even if the request didn't
say "React 19" or "compiler" explicitly.

## Why this matters

React Compiler (stable since React Compiler 1.0, October 2025) rewrites your components
and hooks at build time, inserting memoization equivalent to `useMemo`/`useCallback`/
`React.memo` automatically and more granularly than a human would by hand. It ships as
`babel-plugin-react-compiler`, and its lint rules live inside `eslint-plugin-react-hooks`
(recommended preset) so linting and compilation share one source of truth.

The practical consequence: **manual memoization is no longer the default** — it's
either redundant, or actively harmful if it doesn't match what the compiler would have
inferred (the compiler bails out silently rather than risk breaking your app). Writing
"optimized" React in 2026 means writing _plain, rule-following_ React and trusting the
build step, not sprinkling `useMemo` everywhere out of habit.

This assumes and builds on the base `typescript-strict-typing` rules for general typing
discipline (no `any`, `interface` for entities, discriminated unions for variant state,
etc.) — apply both together.

## Core principle

> Write plain, obviously-pure React. Let the compiler memoize. The Rules of React are no
> longer just style guidance — the compiler's correctness depends on you following them.

---

## 1. Stop hand-rolling memoization

> ⚠️ **Everything in this section assumes the compiler is confirmed active** (wired per
> §7, verified via the "Memo ✨" badge in §8). If you drop manual memoization _without_
> that confirmation, you don't get automatic memoization to replace it — you get
> **neither**. That's not a correctness bug (React still renders the right output), but
> every child re-renders on every parent render regardless of whether its props
> actually changed, and every inline computation reruns every render with nothing
> caching it. It's the pre-memoization default behavior of React — often invisible in
> small trees, but a real source of jank in large lists, heavy computations, or deep
> trees under a frequently-re-rendering parent. If you're not certain the compiler is
> active yet, keep existing manual memoization until you've verified it, then remove it.

Don't reach for `useMemo`, `useCallback`, or `React.memo` by default — the compiler adds
this automatically wherever it determines it helps.

```tsx
// ❌ Old habit — noisy, and a mismatched dependency array is a whole class of bugs
const filteredUsers = useMemo(() => users.filter((u) => u.isActive), [users]);
const handleClick = useCallback(() => onSelect(user.id), [onSelect, user.id]);

// ✅ New default — just write the logic; the compiler memoizes what's worth memoizing
const filteredUsers = users.filter((u) => u.isActive);
const handleClick = () => onSelect(user.id);
```

Manual memoization is still justified, narrowly, when:

- You've **confirmed a compiler bail-out** (see §6) on a genuine hot path via profiling,
  and fixing the underlying Rules-of-React violation isn't possible right now.
- A value must have **stable referential identity across a boundary the compiler can't
  see** — e.g. passed into a non-React library, a WebSocket subscription, or a
  third-party hook incompatible with the compiler (`react-hook-form`'s `useForm`,
  `@tanstack/react-table`'s `useReactTable` are known cases).
- Keep any manual memoization it produces isolated and commented with _why_, so it
  doesn't silently rot into a bail-out later when the code around it changes.

## 2. The Rules of React are now load-bearing

The compiler assumes your components and hooks are pure. Violating these rules doesn't
just risk a subtle bug anymore — it causes the compiler to silently skip optimizing that
component:

- **Idempotent renders** — given the same props/state/context, a component must return
  the same output. No random values, no `Date.now()`, no side effects during render.
- **Immutability** — never mutate props, state, or context directly. Always create new
  objects/arrays for changes.
- **Side effects only in effects or event handlers** — never during render.
- **Hooks called unconditionally, top-level, same order every render** — no hooks inside
  conditionals, loops, or nested functions.

```tsx
// ❌ Mutates a prop — breaks purity and the compiler can't safely memoize this
function TodoList({ todos }: { todos: Todo[] }) {
  todos.sort((a, b) => a.priority - b.priority); // mutates caller's array
  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  );
}

// ✅ Creates a new array — pure, compiler-safe
function TodoList({ todos }: { todos: Todo[] }) {
  const sorted = [...todos].sort((a, b) => a.priority - b.priority);
  return (
    <ul>
      {sorted.map((t) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  );
}
```

## 3. Naming conventions the compiler relies on

The compiler identifies what to optimize by naming heuristics, same as the Rules of
Hooks linter:

| Kind                                                                     | Convention                      | Notes                                                                         |
| ------------------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| Components                                                               | `PascalCase`, returns JSX       | Compiler treats it as a component to optimize                                 |
| Custom hooks                                                             | `camelCase`, prefixed `use`     | Required for both Rules-of-Hooks lint and compiler analysis                   |
| Plain helper functions that return JSX-like values but aren't components | Avoid `PascalCase`/`use` naming | Prevents the compiler (and other devs) from mistaking it for a component/hook |

## 4. Typing React 19 primitives

**`ref` as a normal prop** — `forwardRef` is no longer required for most cases; function
components can accept `ref` directly.

```tsx
type InputProps = {
  ref?: React.Ref<HTMLInputElement>;
  placeholder?: string;
};

function TextInput({ ref, placeholder }: InputProps) {
  return <input ref={ref} placeholder={placeholder} />;
}
```

**Actions with `useActionState`** — type the state and payload as generics; model the
result as a discriminated union (per the base typing rules) rather than optional fields.

```tsx
type FormState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

const [state, formAction, isPending] = useActionState<FormState, FormData>(
  async (_previous, formData) => {
    const email = formData.get("email");
    if (typeof email !== "string" || !email.includes("@")) {
      return { status: "error", message: "Invalid email" };
    }
    await submit(email);
    return { status: "success" };
  },
  { status: "idle" },
);
```

**Optimistic updates with `useOptimistic`** — type both the state and the update shape.

```tsx
const [optimisticTodos, addOptimisticTodo] = useOptimistic<Todo[], Todo>(todos, (state, newTodo) => [...state, newTodo]);
```

**Reading a promise or context with `use()`** — type the resolved value, not the
promise wrapper; `use()` is not a hook and may be called conditionally.

```tsx
function Comments({ commentsPromise }: { commentsPromise: Promise<Comment[]> }) {
  const comments = use(commentsPromise); // suspends until resolved
  return (
    <ul>
      {comments.map((c) => (
        <li key={c.id}>{c.text}</li>
      ))}
    </ul>
  );
}
```

**Stable event callbacks with `useEffectEvent`** (React 19.2+) — separates "event"
logic from "reactive" effect logic so the callback always sees the latest props/state
without being listed as an effect dependency. Needs `eslint-plugin-react-hooks@6+` to
lint correctly.

```tsx
const onVisit = useEffectEvent((url: string) => {
  logVisit(url, theme); // always fresh `theme`, never re-triggers the effect
});

useEffect(() => {
  onVisit(url);
}, [url]); // `theme` intentionally omitted — onVisit is stable
```

## 5. Compiler-friendly render patterns

- Creating new object/array/function literals inline in render (`style={{ color }}`,
  `onClick={() => ...}`) is fine — stop manually hoisting or `useMemo`-wrapping these
  preemptively; the compiler memoizes them if it determines it's worthwhile.
- Avoid module-level mutable variables read or written during render — that state is
  invisible to the compiler and breaks idempotence.
- Don't use `useRef` to store a value that should trigger a re-render when it changes —
  refs are an imperative escape hatch, not state, and the compiler treats them as such.
- Keep components small and composable. The compiler optimizes per component/hook
  boundary, so a single 300-line component gives it far less to work with than several
  focused ones.

## 6. Typing props (builds on the typescript-strict-typing rules)

- `interface` for a component's `Props` — it's an entity shape, often extended.
- A discriminated union when a component has mutually exclusive prop combinations,
  instead of a pile of optional props that can contradict each other.

```tsx
// ❌ Bad — nothing stops passing both `href` and `onClick` incoherently
interface ButtonProps {
  label: string;
  href?: string;
  onClick?: () => void;
}

// ✅ Good — the two variants can't be mixed
type ButtonProps = { variant: "link"; label: string; href: string } | { variant: "action"; label: string; onClick: () => void };
```

## 7. Tooling setup

**The compiler is opt-in — no default setup enables it automatically.** Plain
`@vitejs/plugin-react` (`react()`), plain Next.js, plain Babel/webpack config, etc. do
**not** run the compiler on their own. Verify it's actually wired up before assuming any
of the memoization guidance above applies to your build.

```bash
# Compiler (build-time transform)
npm install --save-dev --save-exact babel-plugin-react-compiler@latest
```

**Lint rules — oxlint.** Oxlint ships a **native, Rust-based** `react/react-compiler`
rule that runs the same compiler analysis in lint-only mode — same diagnostics as the
Babel-based ESLint version, no Babel needed for linting. It's experimental and **off by
default**, so it has to be enabled explicitly:

```json
// .oxlintrc.json
{
  "plugins": ["react"],
  "rules": {
    "react/react-compiler": "error"
  }
}
```

This single rule reports two distinct things — both worth fixing, but for different
reasons:

- **Rules-of-React violations** (conditional hooks, reading a ref during render, mutating
  props) — these are real bugs, independent of the compiler.
- **Compiler bail-outs** — places the compiler declined to optimize (e.g. unsupported
  syntax) without a rule violation. Not incorrect code, just a missed optimization —
  lower priority than a violation, but worth knowing about on a hot path.

If you'd rather use an existing ESLint plugin's rules through oxlint instead of the
native one (e.g. to match a team convention), oxlint's `jsPlugins` can load
`eslint-plugin-react-hooks` directly — slower than the native rule since it still runs
through Babel, but useful if you need a rule the native port doesn't cover yet:

```json
{
  "jsPlugins": [{ "name": "react-hooks-js", "specifier": "eslint-plugin-react-hooks" }],
  "rules": { "react-hooks-js/set-state-in-render": "error" }
}
```

**Lint rules — ESLint** (if not on oxlint): the same rules ship inside
`eslint-plugin-react-hooks`.

```bash
npm install --save-dev eslint-plugin-react-hooks@latest
```

```js
// eslint.config.js
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";

export default defineConfig([reactHooks.configs.flat.recommended]);
```

**Wiring it into Vite 8.** `@vitejs/plugin-react` v6+ (the version that ships with Vite 8) switched its default transform from Babel to oxc for speed, so the compiler is
**never** on by default and the old `react({ babel: {...} })` option **does not work**
on this setup — it's silently ignored, not an error, which is an easy way to think the
compiler is running when it isn't. Wire it in explicitly, as a separate Babel pass that
runs before `react()`:

```js
// vite.config.js
import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  plugins: [
    babel({ presets: [reactCompilerPreset()] }), // must run before react()
    react(),
  ],
});
```

```bash
npm install --save-dev @rolldown/plugin-babel @babel/core babel-plugin-react-compiler
npm install --save-dev @types/babel__core   # if using TypeScript
```

`reactCompilerPreset()` is a helper exported from `@vitejs/plugin-react` itself — it
bundles `babel-plugin-react-compiler` with sane default include/exclude filters so you
don't have to hand-roll a Babel preset. It optionally accepts:

- `compilationMode: 'annotation'` — only compile components explicitly marked with a
  `"use memo"` directive, instead of the whole codebase (useful for a gradual rollout).
- `target: '17' | '18'` — if any part of the app still runs on an older React major and
  needs the `react-compiler-runtime` package instead of `react/compiler-runtime`.

After adding this, confirm it's actually active via the React DevTools "Memo ✨" badge
(§8) before trusting the "don't hand-roll memoization" guidance in §1 — a silently
misconfigured Babel order (`react()` before `babel()`) is a common way for this to look
wired up but do nothing.

- Treat compiler-related lint errors (Rules-of-React violations, mismatched manual
  memoization) as must-fix, not optional — an unfixed violation means that component
  silently gets **zero** compiler optimization.
- For a large existing codebase, adopt incrementally by scoping the babel plugin to a
  directory (e.g. a UI component library) before enabling it globally.
- If a specific function is genuinely incompatible with the compiler (e.g. it calls
  `useForm` from `react-hook-form`), opt it out with the `"use no memo"` directive as
  the **first line of the function body** — it's a temporary escape hatch, not a
  permanent fix, so leave a comment explaining why.

```tsx
function LegacyForm() {
  "use no memo";
  const form = useForm(); // incompatible with the compiler today
  // ...
}
```

## 8. Checking whether the compiler is actually optimizing

- **React DevTools** — an optimized component shows a "Memo ✨" badge next to its name
  in the component tree.
- **ESLint** — the compiler's recommended rules flag Rules-of-React violations at lint
  time, before they ever become a silent runtime bail-out.
- A bail-out is not a crash — it just means that specific component/hook is running
  unoptimized. Treat a missing "Memo ✨" badge on a component you expect to be optimized
  as a signal to check for a Rules-of-React violation, not a compiler bug.

---

## Review checklist

- [ ] Compiler confirmed active ("Memo ✨" badge) before removing any _existing_ manual
      memoization — don't strip it on faith
- [ ] No new `useMemo`/`useCallback`/`React.memo` added without a documented reason
      (confirmed bail-out, or a boundary the compiler can't see through)
- [ ] No prop/state/context mutation anywhere in render
- [ ] All hooks called unconditionally at the top level, same order every render
- [ ] Side effects live in `useEffect`/event handlers, never during render
- [ ] Components are `PascalCase`; hooks are `camelCase` and prefixed `use`
- [ ] `ref` accepted as a normal prop instead of `forwardRef`, unless targeting a version
      that requires it
- [ ] Action/optimistic-update state modeled as a discriminated union, not optional
      fields
- [ ] Mutually exclusive prop combinations modeled as a discriminated union `Props` type
- [ ] `eslint-plugin-react-hooks` recommended config enabled and passing
- [ ] Any `"use no memo"` usage has a comment explaining why

## Quick reference

| Situation                                                      | Do                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| Tempted to write `useMemo`/`useCallback`                       | Don't — write the plain expression, let the compiler decide   |
| Need a ref on a function component                             | Accept `ref` as a prop, skip `forwardRef`                     |
| Form/async state with distinct outcomes                        | Discriminated union via `useActionState`, not optional fields |
| Callback needs latest props/state without re-running an effect | `useEffectEvent`                                              |
| A hook/library is known-incompatible with the compiler         | `"use no memo"` at the top of that function, with a comment   |
| Checking if optimization is happening                          | React DevTools "Memo ✨" badge + compiler ESLint rules        |
