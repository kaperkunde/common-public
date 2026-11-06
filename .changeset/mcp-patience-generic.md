---
"@kaperkunde/mcp": minor
---

`awaitPatiently`, `PatienceOptions` and `LongSpec` take the outcome type as a parameter (`Out`, `Outcome` by default), so an app whose tools answer in a shape of its own uses them without a cast.
