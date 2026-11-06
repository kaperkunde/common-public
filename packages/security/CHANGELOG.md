# @kaperkunde/security

## 0.3.0

### Minor Changes

- 28cd704: A new `@kaperkunde/security/redirect` entry exports `safeCallbackUrl` alone, so a login form in the browser can use it: the root entry pulls in `node:net` and `node:crypto`.

## 0.2.1

### Patch Changes

- 2564280: `isPublicAddress` refuses all of `2001::/23`, the IETF protocol assignments block (Teredo, AS112, ORCHID and the rest), rather than Teredo's `2001::/32` alone.
- 3de4f46: `publicFetch`, following redirects (`maxRedirects` above 0), now does what a browser does: Authorization, Cookie and Proxy-Authorization are dropped on a redirect to another origin, and a 303 (or a 301/302 after a POST) is followed as a GET with no body. Before, the caller's credentials went to whatever origin a redirect named.

## 0.2.0

### Minor Changes

- 372d63e: `clientIpFromHeaders` without `trustedProxies` now reads X-Forwarded-For from the right: the entry `hops` places in (1 by default), the address the proxy in front of the app appended. It used to take the left-most entry, which a client can write itself, so anyone could pick their own rate-limit key. A new `hops` option counts more proxies. X-Real-IP is read only when there is no X-Forwarded-For.

  **Migration:** an app behind one proxy that appends needs nothing. An app behind two (a CDN in front of the load balancer, say) passes `hops: 2`, or lists its proxies in `trustedProxies`.

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 47bc746: First release: rate limiting, client IP behind trusted proxies, safe redirects, same-origin checks, constant-time secret compares, signed link tokens, the admin check, the secret box boot checks, and `/net`: fetches that only reach public addresses, checked as the socket connects.
