---
"@kaperkunde/mail": minor
---

`smtpSettings` reads `<PREFIX>_SECURE`: `true` or `false` says outright whether TLS is implicit, and anything else leaves it to the port (465 implicit, STARTTLS otherwise), as before.
