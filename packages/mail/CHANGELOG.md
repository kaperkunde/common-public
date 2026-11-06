# @kaperkunde/mail

## 0.3.0

### Minor Changes

- 2564280: `createMailer` takes an optional `render(content, theme)`, for an app whose mail has a layout of its own that no theme can express. It defaults to `renderEmail`.

## 0.2.0

### Minor Changes

- 75a3c26: `EmailTheme` takes `maxWidth` (the card's width in px, 520 when unset) and `nameLetterSpacing` (CSS letter spacing for the name beside the logo), so an app's mail keeps its own proportions.

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 074143e: First release: the themed email template (HTML and text from the same content), SMTP under an app's own env prefix, and Mailpit helpers for end-to-end tests.
