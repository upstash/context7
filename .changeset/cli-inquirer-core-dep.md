---
"ctx7": patch
---

Declare `@inquirer/core` as a direct dependency of the CLI. It was previously imported in `selectOrInput.ts` but only resolvable as a transitive of `@inquirer/prompts`, which caused `ctx7` to fail at startup with `ERR_MODULE_NOT_FOUND` under pnpm's isolated node linker.
