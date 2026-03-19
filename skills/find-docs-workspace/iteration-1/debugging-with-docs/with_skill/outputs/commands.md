# ctx7 Commands Log

## Command 1: Resolve Tailwind CSS library ID

```bash
npx ctx7@latest library "tailwind css" "Tailwind CSS v4 config changes custom theme colors tailwind.config.ts migration what changed"
```

### Output

```
1. Title: Tailwind CSS
   Context7-compatible library ID: /tailwindlabs/tailwindcss.com
   Description: The Tailwind CSS documentation website.
   Code Snippets: 1956
   Source Reputation: High
   Benchmark Score: 80.69

2. Title: Tailwind CSS
   Context7-compatible library ID: /websites/tailwindcss
   Description: Tailwind CSS is a utility-first CSS framework that scans your HTML and JavaScript components for class names to generate corresponding styles, providing a fast, flexible, and reliable styling solution with zero-runtime.
   Code Snippets: 1983
   Source Reputation: High
   Benchmark Score: 80.81

3. Title: Tailwind CSS V3
   Context7-compatible library ID: /websites/v3_tailwindcss
   Description: Tailwind CSS is a utility-first CSS framework for rapidly building custom user interfaces. It generates minimal, optimized CSS by scanning your templates for pre-defined utility classes.
   Code Snippets: 1760
   Source Reputation: High
   Benchmark Score: 76.06

4. Title: Tailwind CSS
   Context7-compatible library ID: /websites/tailwindcss_installation_using-vite
   Description: Tailwind CSS is a utility-first CSS framework that rapidly builds custom user interfaces by scanning class names in files.
   Code Snippets: 10
   Source Reputation: High
   Benchmark Score: 43.54

5. Title: Tailwind CSS
   Context7-compatible library ID: /websites/v2_tailwindcss
   Description: Tailwind CSS is a utility-first CSS framework for rapidly building custom user interfaces. It provides a set of pre-designed CSS classes that can be composed directly in your HTML.
   Code Snippets: 1228
   Source Reputation: High
   Benchmark Score: 67.97
```

**Selected:** `/websites/tailwindcss` -- highest benchmark score (80.81), current version (v4), and most code snippets (1983).

---

## Command 2: Fetch docs about custom theme colors in v4

```bash
npx ctx7@latest docs /websites/tailwindcss "Tailwind CSS v4 configuration changes custom theme colors tailwind.config.ts migration what changed"
```

### Output

Returned 5 documentation snippets:

1. **Add custom colors to Tailwind CSS theme using @theme** (source: tailwindcss.com/docs/colors) -- Shows how to add custom colors like `--color-midnight` using the `@theme` directive, making them available as utility classes (e.g., `bg-midnight`).

2. **Override default Tailwind CSS colors with custom values** (source: tailwindcss.com/docs/colors) -- Demonstrates overriding Tailwind's default color values by defining new theme variables with the same names inside `@theme`, using `oklch` color values.

3. **Define a custom color palette in Tailwind CSS** (source: tailwindcss.com/docs/colors) -- Shows how to disable all default colors with `--color-*: initial` and define an entirely custom palette.

4. **Use Custom Theme Color Utility in Tailwind CSS** (source: tailwindcss.com/docs/background-color) -- Shows applying a custom theme color like `bg-regal-blue` after defining `--color-regal-blue` in the theme.

5. **Customize Tailwind CSS theme with @theme directive** (source: tailwindcss.com/docs/adding-custom-styles) -- Shows using `@theme` for fonts, breakpoints, colors, and easing functions.

---

## Command 3: Fetch docs about v3 to v4 migration

```bash
npx ctx7@latest docs /websites/tailwindcss "upgrading from v3 to v4 migration guide tailwind.config.js deprecated CSS-first configuration"
```

### Output

Returned 5 documentation snippets:

1. **Run Tailwind CSS v4 Upgrade Tool** (source: tailwindcss.com/docs/upgrade-guide) -- The `npx @tailwindcss/upgrade` command automates migration from v3 to v4, handling dependencies, configuration, and template file updates. Requires Node.js 20+.

2. **Replace @tailwind Directives with @import in CSS** (source: tailwindcss.com/docs/upgrade-guide) -- Replace v3's `@tailwind base; @tailwind components; @tailwind utilities;` with `@import "tailwindcss";`.

3. **Load Legacy Tailwind Config with @config Directive** (source: tailwindcss.com/docs/functions-and-directives) -- Use `@config "../../tailwind.config.js";` to load a legacy JS config for gradual migration. Notes that `corePlugins`, `safelist`, and `separator` are not supported in v4.

4. **Upgrade tool details** (source: tailwindcss.com/docs/upgrade-guide) -- For most projects, the upgrade tool automates the entire migration process including updating dependencies, migrating configuration to CSS, and handling template file changes.

5. **Removed @tailwind directives** (source: tailwindcss.com/docs/upgrade-guide) -- In v4, Tailwind is imported via standard CSS `@import` statement, not `@tailwind` directives.
