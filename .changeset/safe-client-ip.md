---
"@kaperkunde/security": minor
---

`clientIpFromHeaders` without `trustedProxies` now reads X-Forwarded-For from the right: the entry `hops` places in (1 by default), the address the proxy in front of the app appended. It used to take the left-most entry, which a client can write itself, so anyone could pick their own rate-limit key. A new `hops` option counts more proxies. X-Real-IP is read only when there is no X-Forwarded-For.

**Migration:** an app behind one proxy that appends needs nothing. An app behind two (a CDN in front of the load balancer, say) passes `hops: 2`, or lists its proxies in `trustedProxies`.
