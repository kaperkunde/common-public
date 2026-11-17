import { defineConfig } from "tsdown"

// One file per source file (unbundled), so the React entry keeps its
// "use client" directive and the server entry never drags React in.
export default defineConfig({
  entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/test/**"],
  format: "esm",
  dts: true,
  clean: true,
  unbundle: true,
  checks: { moduleLevelDirective: false },
  copy: [{ from: "src/styles.css", to: "dist" }],
})
