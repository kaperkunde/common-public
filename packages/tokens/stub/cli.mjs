#!/usr/bin/env node
// `tokens-stub`: run the stand-in Token Center. Configure with TOKENS_STUB_* (see the README).
import { startStub } from "./server.mjs"

const stub = await startStub()
console.log(`[stub] token center contract stub on ${stub.url}`)
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => stub.close().then(() => process.exit(0)))
