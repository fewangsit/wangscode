# TypeScript Strict Typing

Applies by default whenever writing, generating, reviewing, or refactoring TypeScript/TSX
code — including code that contains `any`, loose/implicit types, untyped catch blocks,
unchecked type assertions, boolean-flag state instead of variants, or inconsistent
naming — even if not explicitly asked for a "strict" pass. Governs `any` vs `unknown`,
narrowing, discriminated unions, `interface` vs `type` usage, naming conventions, and
tsconfig strictness baseline.

## Why this matters

TypeScript's type system is only as strong as its weakest escape hatch. A single `any`,
an un-narrowed `unknown`, or a lazy `as` assertion silently turns off the compiler for
everything downstream of it — the bug doesn't disappear, it just moves to runtime where
it's more expensive to find. The goal is not "add types for the sake of it," it's
**make illegal states unrepresentable** and **make the compiler prove correctness
wherever possible**, so bugs surface at build time instead of in production.

Apply these rules by default whenever writing or editing TypeScript, without waiting for
an explicit "strict mode" request. If a rule would need to be broken (e.g. a third-party
type is genuinely untyped), say so explicitly and isolate the escape hatch rather than
letting it leak.

## Core principle

> Narrow, don't cast. Model states, don't flag them. Let the compiler do the checking.

---

## 1. Never use `any`

`any` is not "unknown type," it's "type checking off." It's contagious — once a value is
`any`, everything it touches becomes unchecked too.

- Never write `any` for parameters, return types, variables, or generics.
- Use `unknown` for genuinely unknown external data (API responses, `JSON.parse`, catch
  clauses, third-party callbacks) and narrow it before use.
- Use generics (`<T>`) when a function needs to work across types but preserve the
  relationship between input and output.
- If a library ships untyped, write a minimal local type/interface for the surface area
  you actually use instead of reaching for `any`.

```ts
// ❌ Bad
function parseConfig(json: any) {
  return json.settings.theme; // no safety, no autocomplete, silent runtime crash
}

// ✅ Good
function parseConfig(json: unknown): string {
  if (typeof json === "object" && json !== null && "settings" in json && typeof (json as { settings: unknown }).settings === "object") {
    // still narrow further or validate with a schema library (zod, valibot, etc.)
  }
  throw new Error("Invalid config shape");
}
```

The only acceptable `any` is a well-justified, isolated, and commented one (e.g.
interfacing with a genuinely untyped legacy module) — never a default.

## 2. `unknown` + narrowing, not casting

Prefer proving a type through control flow over asserting it with `as`.

**Narrowing techniques, in order of preference:**

1. **`typeof`** — primitives (`string`, `number`, `boolean`, `undefined`, `function`)
2. **`instanceof`** — class instances, `Error`, `Date`, custom classes
3. **`in`** — checking a property exists before accessing it on a union/unknown
4. **User-defined type guards** — `function isUser(x: unknown): x is User`
5. **Discriminated union tag checks** — `switch (value.kind) { ... }` (see §3)
6. **Exhaustiveness checks** — a `never`-typed default branch so adding a new variant is
   a compile error until every switch/if-chain handles it

```ts
// ✅ Type guard
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "id" in value && "email" in value;
}

// ✅ Exhaustiveness check
function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.side ** 2;
    default:
      return assertNever(shape); // compile error if a variant is missed
  }
}
```

Type assertions (`as X`) and the non-null assertion (`!`) bypass this entirely — treat
them as a last resort (see §7), not a shortcut.

## 3. Discriminated unions for variant state

Whenever a value can be one of several distinct "shapes" (loading/success/error states,
event types, API response variants), model it as a **discriminated union** with a
literal tag field — never as a loose object with optional fields or boolean flags.

```ts
// ❌ Bad — booleans can contradict each other; unclear which fields are valid together
interface FetchState {
  isLoading: boolean;
  isError: boolean;
  data?: User;
  error?: string;
}

// ✅ Good — only one shape is possible at a time, and the compiler enforces it
type FetchState = { status: "idle" } | { status: "loading" } | { status: "success"; data: User } | { status: "error"; error: string };

function render(state: FetchState) {
  switch (state.status) {
    case "success":
      return state.data.name; // `data` is guaranteed to exist here
    case "error":
      return state.error; // `error` is guaranteed to exist here
    default:
      return null;
  }
}
```

Use a consistent tag field name across a codebase (`kind`, `type`, or `status` — pick
one and stick with it) so narrowing patterns stay predictable.

## 4. `interface` vs `type` — pick by intent, not habit

Both can describe object shapes, but they signal different intent. Default rule:

| Use `interface` for...                                                     | Use `type` for...                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Object / entity shapes (a `User`, a `Product`, a component's `Props`)      | Unions (`"a" \| "b"`) and discriminated unions                             |
| Public API contracts meant to be `implements`-ed by classes                | Intersections (`A & B`)                                                    |
| Shapes that consumers may want to **extend/augment** (declaration merging) | Tuples (`[string, number]`)                                                |
|                                                                            | Function types / callback signatures                                       |
|                                                                            | Mapped, conditional, or utility-derived types (`Partial<T>`, `Pick<T, K>`) |
|                                                                            | Aliasing a primitive or another type for readability                       |

```ts
// ✅ interface — an entity with identity, extendable
interface User {
  id: string;
  email: string;
  role: UserRole;
}

interface AdminUser extends User {
  permissions: Permission[];
}

// ✅ type — union, alias, derived shape
type UserRole = "admin" | "editor" | "viewer";
type UserId = User["id"];
type PartialUser = Partial<User>;
type Callback<T> = (value: T) => void;
```

Don't mix conventions arbitrarily within one file — if a shape is a plain data object
that will never need a union/intersection, `interface` is the default; the moment it
needs to express "one of several shapes," reach for `type`.

## 5. Naming conventions

| Kind                                                       | Convention                                  | Example                             |
| ---------------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| Types, interfaces, classes, enums                          | `PascalCase`                                | `UserProfile`, `OrderStatus`        |
| Interfaces                                                 | `PascalCase`, **no `I` prefix**             | `User`, not `IUser`                 |
| Type aliases                                               | `PascalCase`                                | `type ApiResponse<T> = ...`         |
| Variables, functions, methods, properties                  | `camelCase`                                 | `getUserById`, `isValid`            |
| Booleans                                                   | `camelCase` with `is/has/should/can` prefix | `isLoading`, `hasPermission`        |
| True constants (module-level, never reassigned, primitive) | `UPPER_SNAKE_CASE`                          | `MAX_RETRIES`, `DEFAULT_TIMEOUT_MS` |
| Enum members                                               | `PascalCase`                                | `enum Status { Active, Archived }`  |
| Generic type parameters (simple, single-purpose)           | Single uppercase letter                     | `T`, `K`, `V`, `E` for errors       |
| Generic type parameters (multiple / non-obvious)           | Descriptive, prefixed with `T`              | `TInput`, `TOutput`, `TContext`     |
| Discriminated union tag field                              | Consistent across the codebase              | `kind`, `type`, or `status`         |
| Files with a single exported entity                        | Match the entity name                       | `UserProfile.ts`, `useAuth.ts`      |

Naming should describe **intent**, not implementation — `fetchUser` not
`getUserFromApiEndpoint`; `retryCount` not `numRetries2`.

## 6. Baseline `tsconfig.json` strictness

Treat these as the non-negotiable floor for any project these rules touch:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`strict: true` alone enables the core group (`noImplicitAny`, `strictNullChecks`, etc.),
but `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are commonly missed and
close real gaps (array/object index access returning `T` instead of `T | undefined`;
optional properties silently accepting `undefined` as an explicit value).

## 7. Type assertions and non-null assertions are a last resort

- `as X` and `x!` tell the compiler "trust me" — they produce zero runtime safety and
  actively hide bugs if wrong.
- Acceptable only when the compiler genuinely cannot know something you do (e.g. a DOM
  query you've already null-checked, or narrowing a third-party type at a well-tested
  boundary) — and even then, prefer a type guard or a runtime check over a bare
  assertion.
- Never use `as any` or `as unknown as X` to force an incompatible cast — that's `any`
  wearing a disguise.
- `x!` should almost always be replaceable by an actual null check or optional chaining
  (`x?.y`) plus a real fallback.

## 8. Readonly by default

Prefer immutable shapes unless mutation is intentional and localized.

```ts
interface Point {
  readonly x: number;
  readonly y: number;
}

function config(values: readonly string[]) {
  /* ... */
}

const ROLES = ["admin", "editor", "viewer"] as const;
type UserRole = (typeof ROLES)[number];
```

## 9. Explicit return types on exported/public functions

Inference is fine for local, private helpers, but exported functions, class methods, and
anything forming a public API should declare an explicit return type. This prevents an
internal implementation change from silently widening/narrowing the public contract.

```ts
// ❌ Return type is inferred and can silently drift
export function getActiveUsers(users: User[]) {
  return users.filter((u) => u.active);
}

// ✅ Explicit, intentional contract
export function getActiveUsers(users: User[]): User[] {
  return users.filter((u) => u.active);
}
```

## 10. Prefer literal unions over numeric enums

String literal unions are simpler, tree-shake better, and produce clearer error
messages than TypeScript `enum`. Reserve `enum` (or `as const` object maps) for cases
that need reverse lookup or genuinely benefit from a namespaced runtime value.

```ts
// ✅ Preferred
type OrderStatus = "pending" | "shipped" | "delivered" | "cancelled";

// Acceptable when a namespaced runtime object is actually needed
const OrderStatus = {
  Pending: "pending",
  Shipped: "shipped",
} as const;
type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
```

---

## Review checklist

Before considering TypeScript code "done," verify:

- [ ] No `any` anywhere (including implicit `any` from missing annotations)
- [ ] External/uncertain data enters as `unknown` and is narrowed before use
- [ ] Variant state is a discriminated union, not optional fields + booleans
- [ ] `interface` used for object/entity shapes; `type` used for unions/aliases/intersections
- [ ] No stray `I` prefixes on interfaces
- [ ] Naming follows the casing table in §5 consistently
- [ ] `as` / `!` are rare, justified, and can't be replaced by a guard or null check
- [ ] Exported functions/methods have explicit return types
- [ ] Switch statements over unions have an exhaustiveness (`never`) check
- [ ] `tsconfig.json` includes the strictness baseline in §6

## Quick reference

| Situation                                      | Use                                                           |
| ---------------------------------------------- | ------------------------------------------------------------- |
| External/uncertain data                        | `unknown` + narrowing                                         |
| "This value is definitely one of these shapes" | Discriminated union (`type`)                                  |
| Object with identity, may be extended          | `interface`                                                   |
| Union, intersection, tuple, mapped type        | `type`                                                        |
| Need to prove a type through logic             | Type guard / narrowing                                        |
| Tempted to write `any`                         | Stop — use `unknown`, a generic, or a local interface instead |
