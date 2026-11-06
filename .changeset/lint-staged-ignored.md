---
"@kaperkunde/config": patch
---

The lint-staged preset passes `--no-warn-ignored` to ESLint, so a staged file the ESLint config ignores (generated code, say) no longer fails `--max-warnings 0`.
