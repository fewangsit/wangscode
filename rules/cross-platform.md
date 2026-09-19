# Cross-Platform — Wangs Foundation

The same feature package serves both web and native (once a mobile target exists). Platform-specific code is isolated by file extension conventions.

---

## File Extension Rules

| Extension                    | Loaded by                         | Use for                        |
| ---------------------------- | --------------------------------- | ------------------------------ |
| `.ts` / `.tsx`               | Both (fallback)                   | Shared code, web-primary       |
| `.native.ts` / `.native.tsx` | React Native bundler (Metro) only | Native-specific implementation |
| `.web.ts` / `.web.tsx`       | Web bundler (Vite) only           | Rare web-specific overrides    |

Metro (React Native) resolves `.native.*` first, then falls back to the plain extension.
Vite resolves `.web.*` first (if configured), then falls back.

**When you have only one platform variant**, use the plain extension — it works everywhere.

---

## Splitting a Component

If the UI diverges significantly between platforms, create two View files:

```
screens/Catalog/
├── useCatalogViewModel.ts       # Shared — one ViewModel for both
├── Catalog.tsx                  # Web view
└── Catalog.native.tsx           # Native view
```

The ViewModel is always shared. Only the View splits — see the `feature-pattern` rule's Superset Pattern.

---

## ViewModel: Always Shared

ViewModels must never import anything platform-specific. If platform behavior differs, pass it in as a parameter (dependency injection):

```typescript
// ✅ Platform-agnostic ViewModel
export function useAssetScannerViewModel(
  onScan?: () => Promise<string>, // Injected from the View
) {
  // ...
}

// apps/mobile/screens/AssetScannerScreen.native.tsx
import { useCamera } from "react-native-camera";
const vm = useAssetScannerViewModel(useCamera().scan);

// apps/web/screens/AssetScannerScreen.tsx
const vm = useAssetScannerViewModel(); // No camera — falls back to text input in VM
```

---

## `core` and `assets`: Truly Universal

Both packages must compile and run without modification on Node, browser, and React Native:

- No `window`, `document`, or `localStorage` access.
- No React Native APIs (`Platform`, `StyleSheet`).
- No JSX.

---

## Detecting Platform in Code

Avoid platform detection inside shared code. If you find yourself writing `if (Platform.OS === 'web')`, the code belongs in a View or a platform-specific file, not in a shared one.

```typescript
// ❌ Avoid this in shared ViewModel
import { Platform } from "react-native";
if (Platform.OS === "web") {
  /* ... */
}

// ✅ Instead, inject the behavior as a parameter or split the file
```

---

## Build Configuration

### Vite (Web)

```typescript
// apps/web/vite.config.ts
resolve: {
  conditions: ["source"], // Picks up live .ts source from packages during dev
}
```

### Metro (Native)

Metro resolves `.native.*` automatically. No extra config needed for the extension resolution.

### tsconfig Per Package

Each package's `tsconfig.json` excludes native-only files from the TypeScript compile until a mobile target actually exists:

```json
{
  "exclude": ["dist", "node_modules", "**/*.native.ts", "**/*.native.tsx"]
}
```

This prevents web `tsc` builds from trying to compile React Native dependencies.
