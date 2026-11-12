import { defineConfig } from "tsdown"

// One file per source file (unbundle), so the screens keep their own "use client" and the
// server entries never pull React in.
export default defineConfig({
  entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/test/**"],
  format: "esm",
  dts: true,
  clean: true,
  unbundle: true,
  checks: { moduleLevelDirective: false },
  external: [/^@kaperkunde\//, "react", "react/jsx-runtime", "stripe"],
})
