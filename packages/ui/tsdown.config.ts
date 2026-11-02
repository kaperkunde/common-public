import { defineConfig } from "tsdown"

// One file per source file (unbundle), so each component is its own subpath
// and keeps its own "use client" (or none), and the CSS beside them.
export default defineConfig({
  entry: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}", "!src/test/**"],
  format: "esm",
  dts: true,
  clean: true,
  unbundle: true,
  // Unbundled, a file's directive stays at the top of its own output (the
  // tests check dist), so rolldown's warning that it might not is noise.
  checks: { moduleLevelDirective: false },
  copy: [
    { from: "src/base.css", to: "dist" },
    { from: "src/themes/*.css", to: "dist/themes" },
  ],
})
