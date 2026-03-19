# Migrating `useFormStatus` from React 18 to React 19

## Background

`useFormStatus` was originally introduced in the `react-dom` package as an experimental feature that shipped alongside React 18 (specifically in `react-dom` canary builds). In React 19, it remains part of `react-dom` but the surrounding ecosystem -- particularly how forms work -- has changed significantly.

## Key Changes in React 19

### 1. `useFormStatus` Import Path

In React 18 canary/experimental builds, you may have imported it from:

```js
import { useFormStatus } from "react-dom";
```

In React 19, the hook lives under `react-dom`:

```js
import { useFormStatus } from "react-dom";
```

The import path itself has not changed. However, the hook now works in conjunction with React 19's new `<form>` action pattern, which *has* changed substantially.

### 2. Form Actions Replace `onSubmit` Handlers

The biggest change affecting `useFormStatus` is that React 19 introduces **form actions**. Instead of using `onSubmit` with `event.preventDefault()`, you now pass an async function directly to the `action` prop on `<form>`.

**React 18 pattern (with onSubmit):**

```jsx
function MyForm() {
  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await submitToServer(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="email" type="email" />
      <SubmitButton />
    </form>
  );
}
```

**React 19 pattern (with action):**

```jsx
function MyForm() {
  async function handleSubmit(formData) {
    // formData is passed directly -- no event, no preventDefault
    await submitToServer(formData);
  }

  return (
    <form action={handleSubmit}>
      <input name="email" type="email" />
      <SubmitButton />
    </form>
  );
}
```

### 3. `useFormStatus` Only Works with the `action` Prop

This is the most common migration pitfall. In React 19, `useFormStatus` tracks the pending state of a `<form>` that uses the `action` prop. If you are still using `onSubmit`, the hook will **not** report a pending state.

### 4. The Hook Must Be Called from a Component Rendered Inside the `<form>`

This was true before and remains true in React 19. `useFormStatus` reads status from the nearest parent `<form>`. If you call it in the same component that renders the `<form>` tag, it will not work -- it must be in a child component.

**Wrong -- hook called in the same component as the form:**

```jsx
function MyForm() {
  const { pending } = useFormStatus(); // Will NOT work
  return (
    <form action={submitAction}>
      <button disabled={pending}>Submit</button>
    </form>
  );
}
```

**Correct -- hook called in a child component rendered inside the form:**

```jsx
function SubmitButton() {
  const { pending } = useFormStatus(); // Works correctly
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting..." : "Submit"}
    </button>
  );
}

function MyForm() {
  return (
    <form action={submitAction}>
      <input name="email" type="email" />
      <SubmitButton />
    </form>
  );
}
```

## Complete React 19 Example

Here is a full working example showing the correct React 19 usage:

```jsx
import { useFormStatus } from "react-dom";
import { useActionState } from "react";

// Child component that uses useFormStatus
function SubmitButton() {
  const { pending, data, method, action } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save"}
    </button>
  );
}

// Optional: a component that shows form status info
function FormStatusDisplay() {
  const { pending, data } = useFormStatus();

  if (!pending) return null;

  return <p>Submitting: {data?.get("name")}</p>;
}

// The form component
function ProfileForm() {
  // useActionState is a new React 19 hook that pairs well with form actions
  const [state, formAction, isPending] = useActionState(
    async (previousState, formData) => {
      const name = formData.get("name");
      const result = await updateProfile({ name });
      if (result.error) {
        return { error: result.error };
      }
      return { success: true };
    },
    null // initial state
  );

  return (
    <form action={formAction}>
      <label>
        Name:
        <input name="name" type="text" />
      </label>

      {state?.error && <p style={{ color: "red" }}>{state.error}</p>}
      {state?.success && <p style={{ color: "green" }}>Profile updated!</p>}

      <FormStatusDisplay />
      <SubmitButton />
    </form>
  );
}
```

## Return Value of `useFormStatus`

The hook returns an object with the following properties:

| Property  | Type          | Description                                                      |
|-----------|---------------|------------------------------------------------------------------|
| `pending` | `boolean`     | `true` while the form action is executing                        |
| `data`    | `FormData`    | The `FormData` object for the in-progress submission, or `null`  |
| `method`  | `string`      | The HTTP method (`"get"` or `"post"`), defaults to `"post"`      |
| `action`  | `function`    | A reference to the action function passed to the parent `<form>` |

## Migration Checklist

1. **Replace `onSubmit` with `action`** on your `<form>` elements. The action function receives `FormData` directly, not an event.
2. **Ensure `useFormStatus` is called in a child component**, not in the component that renders the `<form>`.
3. **Remove `event.preventDefault()`** -- form actions handle this automatically.
4. **Consider pairing with `useActionState`** (new in React 19) for managing the return value of your form action and tracking form state.
5. **Remove any manual `useState` for loading/pending state** -- `useFormStatus` and `useActionState` handle this for you.

## Common Pitfall: Server Actions vs Client Actions

In React 19, form actions can be either server actions (marked with `"use server"`) or client-side async functions. `useFormStatus` works with both. If you are using a framework like Next.js, you can pass a server action directly to `action`:

```jsx
// actions.js
"use server";

export async function updateProfile(formData) {
  const name = formData.get("name");
  // ... database update
}
```

```jsx
// ProfileForm.jsx
import { updateProfile } from "./actions";

function ProfileForm() {
  return (
    <form action={updateProfile}>
      <input name="name" />
      <SubmitButton />
    </form>
  );
}
```

`useFormStatus` inside `<SubmitButton>` will correctly reflect the pending state while the server action executes.
