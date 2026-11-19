---
"@kaperkunde/security": minor
---

`stampPeer` stamps `"unknown"` when the socket has no remote address instead of leaving the header absent, which made the resolver fall back to believing forwarded headers; `resolveClientIp` already hashes it into one untrusted key. New option `stampPeer(req, headerName, { forwardedHeader })` removes any client copy of that marker header and sets it to `"1"` only when the client really sent X-Forwarded-For or X-Real-IP (call it before the framework touches headers), and `ClientIpOptions.forwardedHeader` ignores forwarded headers while the marker is absent and a peer is known. This keeps frameworks that fill X-Forwarded-For with the raw socket address from making a direct client look like forwarded headers from an untrusted proxy. Without the new options nothing changes, apart from the "unknown" stamp.
