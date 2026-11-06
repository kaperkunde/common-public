/**
 * The pre-commit lint-staged config every app uses: ESLint fixes and checks
 * the staged scripts, Prettier formats them and the rest. A warning left over
 * fails the commit; a staged file the ESLint config ignores (generated code,
 * say) is skipped quietly rather than warned about.
 *
 *   // lint-staged.config.mjs
 *   export { default } from "@kaperkunde/config/lint-staged"
 */
export default {
  "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": [
    "eslint --fix --max-warnings 0 --no-warn-ignored",
    "prettier --write",
  ],
  "*.{json,md,css,yml,yaml}": ["prettier --write"],
}
