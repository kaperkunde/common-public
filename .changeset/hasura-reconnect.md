---
"@kaperkunde/hasura": minor
---

Reconnect by itself before giving up. A dropped socket parks its subscriptions (Apollo keeps their data) and is tried again: nothing while the page is hidden, then a few tries with backoff over about fifteen seconds once it shows, fetching a fresh token first after a refusal (`TokenSource.refresh`). Only a failed round, an offline device or a token that cannot be had fires `onConnectionLost`. A return to the page reconnects an open socket that has been silent for 45 seconds. `WithHasura` takes `renderReconnecting`, keeps one cache across rebuilt clients, and presses the lost screen's button once by itself when the reader comes back. New: `createResilientSocket`, `browserPage`, and the pure rules (`nextLossStep`, `onReturnStep`, `isAuthClose`).
