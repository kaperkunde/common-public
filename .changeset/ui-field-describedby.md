---
"@kaperkunde/ui": patch
---

`Field` ties its hint to the control for screen readers: when a hint is rendered, the control (the child whose `id` is `htmlFor`, else the only element child) gets `aria-describedby` with the hint's id, merged with any `aria-describedby` it already has.
