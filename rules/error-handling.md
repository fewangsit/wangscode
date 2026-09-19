# Error Handling — Wangs Foundation

Errors flow from the server → data source → ViewModel → View. Each layer has one job.

---

## The Flow

```
API returns 4xx/5xx
  ↓
http client throws (data source lets it propagate)
  ↓
ViewModel catches it in a try/catch block
  ↓
ViewModel maps error to a display string
  ↓
View renders the string — no logic
```

---

## Data Source: Let It Throw

Data source functions do not catch errors. The shared http client throws on non-2xx responses.

```typescript
// ✅ Correct — throw propagates to the ViewModel
export const getCatalogItems = async (): Promise<CatalogItemDto[]> => {
  const res = await http.get<CatalogItemDto[]>("/v1/catalog");
  return res.data;
};
```

Only catch when you need to handle a specific status code (e.g., return `null` on 404 instead of throwing):

```typescript
// ✅ Only when semantically needed
export const fetchCatalogItemOrNull = async (id: string): Promise<CatalogItemDto | null> => {
  try {
    const res = await http.get<CatalogItemDto>(`/v1/catalog/${id}`);
    return res.data;
  } catch (error) {
    if (http.isHttpError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};
```

---

## API Error Response Shape

A common server error format:

```json
{
  "message": "Item not found.",
  "code": "NOT_FOUND",
  "statusCode": 404
}
```

Extract the user-facing message in the ViewModel:

```typescript
function getErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (http.isHttpError(error)) {
    return (error.response?.data as { message?: string })?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

// In ViewModel catch block:
} catch (error) {
  setErrorMessage(getErrorMessage(error));
}
```

This helper can live in a shared `core/utility` file and be reused across ViewModels — see the `packages` rule.

---

## View: Display Only

The View receives `errorMessage: string | null` and renders it — nothing more.

```tsx
{
  vm.errorMessage && <Text variant="bodySmall">{vm.errorMessage}</Text>;
}
```

No `try/catch`, no `error instanceof`, no conditional rendering based on error type.

---

## Global Errors

### Auth-Related Errors (401 or Equivalent)

A response interceptor in the shared http client is the right place to react to an unauthenticated response and trigger whatever recovery a given project uses (redirect to login, refresh a session, etc.) — the exact mechanism depends on that project's own authentication strategy, not prescribed here.

### Network Errors (No Connection)

A failed request due to no connection falls through to the ViewModel's `catch` block and is handled like any other error. Retries, if needed, should be implemented manually or via the http client's own plugin/interceptor mechanism.

### Unhandled Errors

React's error boundary catches rendering errors. Add an `ErrorBoundary` at the app root:

```tsx
// apps/web/App.tsx
<ErrorBoundary fallback={<ErrorScreen />}>
  <NavigationProvider>...</NavigationProvider>
</ErrorBoundary>
```

---

## Error Message Strings

Error messages shown to the user follow the same pattern as other strings — resolved in the ViewModel and stored in `Strings.ts` for known error codes:

```typescript
// resources/Strings.ts
const Strings = {
  ERROR_NOT_FOUND: "Item not found.",
  ERROR_GENERIC: "Something went wrong. Please try again.",
};
```

```typescript
// ViewModel
const knownErrors: Record<string, string> = {
  NOT_FOUND: Strings.ERROR_NOT_FOUND,
};

const errorCode = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
const message = errorCode && knownErrors[errorCode] ? knownErrors[errorCode] : error instanceof Error ? error.message : null;
setErrorMessage(message);
```
