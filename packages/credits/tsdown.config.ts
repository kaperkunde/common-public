import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/stripe.ts", "src/feeds.ts", "src/ui.tsx"],
  format: "esm",
  dts: true,
  clean: true,
  external: [/^@kaperkunde\//, "react", "react/jsx-runtime", "stripe"],
})
