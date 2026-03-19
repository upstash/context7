# Tailwind CSS v4: Configuration Changes and Fixing Custom Theme Colors

## What Changed in v4

Tailwind CSS v4 introduced a fundamentally different configuration model. The biggest change is that **`tailwind.config.ts` (and `tailwind.config.js`) is no longer the primary configuration mechanism**. Instead, Tailwind v4 uses a **CSS-first configuration** approach where all customization happens directly in your CSS file.

If you upgraded to Tailwind CSS v4 but still have your theme colors defined in `tailwind.config.ts`, those values are being ignored by default because v4 does not automatically read that file.

## Key Differences Between v3 and v4

| Aspect | v3 | v4 |
|--------|----|----|
| Configuration file | `tailwind.config.ts` / `.js` | Your main CSS file |
| Theme customization | `theme.extend` in config | `@theme` directive in CSS |
| Plugin registration | `plugins` array in config | `@plugin` directive in CSS |
| Content paths | `content` array in config | Automatic content detection |
| CSS import | `@tailwind base/components/utilities` | `@import "tailwindcss"` |

## How to Fix It

### Option 1: Migrate to CSS-first configuration (Recommended)

Replace your `tailwind.config.ts` theme values with the `@theme` directive in your main CSS file.

**Before (v3 -- `tailwind.config.ts`):**

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
      },
    },
  },
} satisfies Config;
```

**After (v4 -- your main CSS file, e.g., `app.css`):**

```css
@import "tailwindcss";

@theme {
  --color-brand-50: #eff6ff;
  --color-brand-100: #dbeafe;
  --color-brand-200: #bfdbfe;
  --color-brand-300: #93c5fd;
  --color-brand-400: #60a5fa;
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
  --color-brand-700: #1d4ed8;
  --color-brand-800: #1e40af;
  --color-brand-900: #1e3a8a;
  --color-brand-950: #172554;
}
```

With this in place, classes like `bg-brand-500`, `text-brand-200`, `border-brand-700`, etc., will all work as expected.

The naming convention inside `@theme` follows a pattern: `--color-{name}-{shade}` maps to utility classes like `bg-{name}-{shade}`, `text-{name}-{shade}`, and so on.

### Option 2: Keep your existing config file using `@config`

If you have a large `tailwind.config.ts` and are not ready to migrate everything, you can explicitly tell Tailwind v4 to load it by using the `@config` directive in your CSS file:

```css
@import "tailwindcss";
@config "../tailwind.config.ts";
```

This makes v4 read your legacy config file. The path is relative to the CSS file. This is a good transitional approach, but the CSS-first approach is the intended long-term direction.

### Option 3: Use `@theme inline` for values that should not become CSS variables

If you have theme values that you want Tailwind to use for class generation but do not want exposed as CSS custom properties on `:root`, use `@theme inline`:

```css
@import "tailwindcss";

@theme inline {
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
}
```

This generates the utility classes but does not emit the `--color-brand-*` custom properties in the output CSS.

## Other Configuration Changes to Be Aware Of

1. **Content detection is automatic.** You no longer need the `content` array. Tailwind v4 automatically detects your template files. If you need to add additional paths (for example, files inside `node_modules`), use the `@source` directive:

   ```css
   @import "tailwindcss";
   @source "../node_modules/some-ui-library/src/**/*.js";
   ```

2. **The `@tailwind` directives are gone.** Replace `@tailwind base; @tailwind components; @tailwind utilities;` with a single `@import "tailwindcss";`.

3. **Default border color changed.** In v4, the default border color is `currentColor` instead of `gray-200`. If your UI looks different after upgrading, this could be why.

4. **Preflight changes.** Some base/reset styles have been adjusted in v4.

5. **Plugins use `@plugin`.** Instead of the `plugins` array in the config file, you import plugins in CSS:

   ```css
   @import "tailwindcss";
   @plugin "@tailwindcss/typography";
   ```

## Quick Checklist

- [ ] Replace `@tailwind` directives with `@import "tailwindcss";`
- [ ] Move custom colors from `tailwind.config.ts` to `@theme` in CSS, OR add `@config` to point to your existing config
- [ ] Remove the `content` array (v4 auto-detects) or use `@source` if needed
- [ ] Move plugin registrations to `@plugin` directives
- [ ] Test that your custom classes like `bg-brand-500` are generating correctly
