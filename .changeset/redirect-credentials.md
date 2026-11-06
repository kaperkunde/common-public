---
"@kaperkunde/security": patch
---

`publicFetch`, following redirects (`maxRedirects` above 0), now does what a browser does: Authorization, Cookie and Proxy-Authorization are dropped on a redirect to another origin, and a 303 (or a 301/302 after a POST) is followed as a GET with no body. Before, the caller's credentials went to whatever origin a redirect named.
