---
"@kaperkunde/security": minor
---

`clientIpFromHeaders` takes the connecting address (`peer`, or `peerHeader`, a header the app's own server stamped). With it known, X-Forwarded-For and X-Real-IP count only from loopback or a peer inside `trustedProxies`; from any other peer the peer itself is the address. New `resolveClientIp` returns `{ ip, source, untrustedForwarded }` so an app can warn once that it sits behind a proxy it was not told about, and `stampPeer(req, headerName)` strips an incoming copy of that header and sets it from the socket in the app's server entry. Without the new options nothing changes.
