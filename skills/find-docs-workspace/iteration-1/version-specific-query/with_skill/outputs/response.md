# useFormStatus in React 19 -- Migration Guide from React 18

## Key Changes in React 19

In React 19, `useFormStatus` is a stable hook imported from `react-dom`. It reads the submission status of a parent `<form>` element. The hook itself has not changed its API between React 18 (canary) and React 19, but the ecosystem around form handling has shifted significantly:

1. **`useFormState` has been replaced by `useActionState`** -- If you were using `useFormState` from `react-dom`, you should now use `useActionState` from `react` instead. This is the most common migration issue.
2. **`useFormStatus` remains in `react-dom`** -- The import path stays the same: `import { useFormStatus } from 'react-dom'`.
3. **`useActionState` returns a `isPending` value** -- The new `useActionState` hook returns three values instead of two: `[state, formAction, isPending]`, giving you pending state directly without needing `useFormStatus` in some cases.

## Correct useFormStatus Usage in React 19

`useFormStatus` must be called from a component that is **rendered inside a `<form>`**. It cannot be called in the same component that renders the `<form>` -- it must be a child component.

```jsx
import { useFormStatus } from "react-dom";

// This component MUST be rendered inside a <form>
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting..." : "Submit"}
    </button>
  );
}
```

Then use it inside a form with an `action`:

```jsx
import { useActionState } from "react";

function ChangeName({ name, setName }) {
  const [error, submitAction, isPending] = useActionState(
    async (previousState, formData) => {
      const error = await updateName(formData.get("name"));
      if (error) {
        return error;
      }
      redirect("/path");
      return null;
    },
    null,
  );

  return (
    <form action={submitAction}>
      <input type="text" name="name" />
      <SubmitButton />
      {error && <p>{error}</p>}
    </form>
  );
}
```

## Common Migration Mistakes

### 1. Using useFormStatus in the same component as the form

This will not work -- `useFormStatus` reads from the nearest **parent** `<form>`, so it must be in a child component:

```jsx
// WRONG -- useFormStatus won't see the form
function MyForm() {
  const { pending } = useFormStatus(); // Always returns { pending: false }
  return (
    <form action={someAction}>
      <button disabled={pending}>Submit</button>
    </form>
  );
}

// CORRECT -- useFormStatus is in a child component
function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>Submit</button>;
}

function MyForm() {
  return (
    <form action={someAction}>
      <SubmitButton />
    </form>
  );
}
```

### 2. Still using useFormState instead of useActionState

```jsx
// WRONG (React 18 pattern, deprecated in React 19)
import { useFormState } from "react-dom";
const [state, formAction] = useFormState(myAction, initialState);

// CORRECT (React 19)
import { useActionState } from "react";
const [state, formAction, isPending] = useActionState(myAction, initialState);
```

Note that `useActionState` is imported from `"react"`, not `"react-dom"`.

### 3. Not using form actions

`useFormStatus` only works with forms that use the `action` prop (React 19's form actions). If you are using `onSubmit` with `e.preventDefault()`, `useFormStatus` will not track the submission state.

## Complete Working Example

```jsx
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting..." : "Submit"}
    </button>
  );
}

function Form({ action }) {
  async function increment(n) {
    return n + 1;
  }
  const [count, incrementFormAction] = useActionState(increment, 0);
  return (
    <form action={action}>
      <button formAction={incrementFormAction}>Count: {count}</button>
      <SubmitButton />
    </form>
  );
}
```

## Summary

| Aspect | React 18 (Canary) | React 19 |
|--------|-------------------|----------|
| Form state hook | `useFormState` from `react-dom` | `useActionState` from `react` |
| Form status hook | `useFormStatus` from `react-dom` | `useFormStatus` from `react-dom` (unchanged) |
| Pending state | Only via `useFormStatus` | Via `useActionState` (3rd return value) or `useFormStatus` |
| Form submission | `action` prop on `<form>` | `action` prop on `<form>` (unchanged) |

Sources: React 19 official documentation (react.dev), React 19.1.1 changelog (github.com/facebook/react)
