---
"ctx7": patch
---

Detect the package manager that started ctx7 from the file name of `npm_execpath` instead of its whole path, so a folder such as `/home/ubuntu` or `pnpm/nodejs` no longer makes `npx ctx7` suggest `bun add -g` or `pnpm add -g`.
