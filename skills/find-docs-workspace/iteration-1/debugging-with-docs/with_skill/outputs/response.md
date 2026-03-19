# Why Your `tailwind.config.ts` Isn't Working in Tailwind CSS v4

## The Core Change

Tailwind CSS v4 moved from a JavaScript-based configuration (`tailwind.config.ts` / `tailwind.config.js`) to a **CSS-first configuration** model. All theme customization now happens directly in your CSS file using the `@theme` directive. Your `tailwind.config.ts` file is no longer automatically picked up by v4, which is why your `bg-brand-500` classes are not generating.

## How to Define Custom Colors in v4

Instead of this (v3 approach):

```ts
// tailwind.config.ts -- NO LONGER USED BY DEFAULT IN V4
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          500: '#3b82f6',
        },
      },
    },
  },
}
```

You now define custom colors directly in your CSS file using the `@theme` directive:

```css
/* app.css (or your main CSS entry point) */
@import "tailwindcss";

@theme {
  --color-brand-100: #eff6ff;
  --color-brand-200: #dbeafe;
  --color-brand-300: #93c5fd;
  --color-brand-400: #60a5fa;
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
  --color-brand-700: #1d4ed8;
  --color-brand-800: #1e40af;
  --color-brand-900: #1e3a8a;
}
```

Each `--color-*` CSS variable defined inside `@theme` automatically generates the corresponding utility classes. So `--color-brand-500` gives you `bg-brand-500`, `text-brand-500`, `border-brand-500`, and so on.

## Other Key v4 Changes

1. **`@tailwind` directives are removed.** Replace `@tailwind base; @tailwind components; @tailwind utilities;` with a single `@import "tailwindcss";`.

2. **`@theme` replaces `theme.extend`.** Anything you previously put in `theme.extend.colors` in your JS config now goes into a `@theme` block in CSS using CSS custom property syntax (`--color-<name>: <value>`).

3. **Clearing defaults.** If you want to remove all default colors and use only your own, set `--color-*: initial;` inside `@theme` before defining your custom values:

   ```css
   @theme {
     --color-*: initial;
     --color-brand-500: #3b82f6;
     --color-white: #fff;
     --color-black: #000;
   }
   ```

4. **CSS variables are directly accessible.** You can reference your theme values as standard CSS variables anywhere, e.g., `var(--color-brand-500)`.

## Migration Options

### Option A: Migrate to CSS-first config (recommended)

Move your theme customizations from `tailwind.config.ts` into your main CSS file using `@theme`. Run the official upgrade tool to automate most of this:

```bash
npx @tailwindcss/upgrade
```

This tool handles dependency updates, config migration to CSS, and template file changes. It requires Node.js 20+. Run it in a new branch and review the diff carefully.

### Option B: Keep your JS config temporarily

If you need a gradual migration, you can load your legacy config using the `@config` directive in your CSS:

```css
@import "tailwindcss";
@config "../../tailwind.config.js";
```

Note that some v3 config options are **not supported** in v4 even with `@config`, including `corePlugins`, `safelist`, and `separator`.

## Summary

Your `bg-brand-500` classes are not generating because Tailwind CSS v4 no longer reads `tailwind.config.ts` by default. Move your custom color definitions into the `@theme` directive in your main CSS file, and the utilities will generate as expected. Alternatively, use `@config` to temporarily load your legacy JS config during migration.
