# Data and Server State — Wangs Foundation

All remote data is fetched via plain `async/await` functions. State is managed with `useState` and `useEffect` inside ViewModels, with form handling via `useFormControl` from `@wangs-ui/form`. Complements the `feature-pattern` rule's DataSource/ViewModel/View split with the state-management and mutation patterns.

---

## How Data Flows

```
API (Server)
  ↓
DataSource function  (features/[feature]/data/datasource/)
  ↓
ViewModel            (useState + useEffect, resolves + formats, returns to View)
  ↓
View                 (renders)
```

---

## Fetching Data in ViewModels

Use `useState` + `useEffect` for read operations.

```typescript
export function useCatalogListViewModel() {
  const [items, setItems] = useState<CatalogItemDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    getCatalogItems()
      .then(setItems)
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : Strings.ERROR_GENERIC);
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { items, isLoading, errorMessage };
}
```

---

## Mutations (Write) in ViewModels

For non-form mutations (e.g., delete, toggle), manage loading state manually with `useState`.

For form submissions, use `useFormControl` from `@wangs-ui/form/react` — see the `create-form` skill for detailed architecture, validation workflows, and the MCP discovery protocol for building forms.

### Non-Form Mutation (e.g., Delete)

```typescript
const [isDeleting, setIsDeleting] = useState(false);

const deleteCatalogItem = async (id: string) => {
  setIsDeleting(true);
  try {
    await deleteCatalogItemById(id);
    navigator.push(CatalogList);
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : Strings.ERROR_GENERIC);
  } finally {
    setIsDeleting(false);
  }
};
```

---

## Server State vs UI State

| What                                      | Where                                                     |
| ----------------------------------------- | --------------------------------------------------------- |
| API data (lists, details, user profile)   | `useState` in ViewModel, fetched via `useEffect`          |
| Loading / error status                    | `useState` in ViewModel (`isLoading`, `errorMessage`)     |
| Form values                               | `useFormControl` from `@wangs-ui/form` (inside ViewModel) |
| Selected tab, active page, open panel     | `useState` inside ViewModel                               |
| Hover state, focus ring, animation toggle | `useState` inside the View                                |

---

## Error Handling

Data source functions throw on failure. ViewModels catch and expose `errorMessage` as a string — see the `error-handling` rule for the full contract.

```typescript
// DataSource — throw, do not swallow
export const getCatalogItems = async (): Promise<CatalogItemDto[]> => {
  const res = await http.get<CatalogItemDto[]>("/v1/catalog");
  return res.data; // client throws on non-2xx — let it propagate
};
```

```typescript
// ViewModel — catch, extract message, expose as string
try {
  await getCatalogItems();
} catch (error) {
  setErrorMessage(error instanceof Error ? error.message : t(Strings.ERROR_GENERIC));
}
```

```tsx
// View — just display it
{
  vm.errorMessage && <Text variant="bodySmall">{vm.errorMessage}</Text>;
}
```

---

## Re-fetching After a Mutation

After a write succeeds, re-trigger the fetch by toggling a dependency or navigating away and back:

```typescript
const [refreshKey, setRefreshKey] = useState(0);

// After delete succeeds:
setRefreshKey((k) => k + 1);

// In the fetch effect:
useEffect(() => {
  void getCatalogItems().then(setItems);
}, [refreshKey]);
```
