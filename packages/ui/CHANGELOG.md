# @kaperkunde/ui

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 394f475: First release: one Tailwind v4 token contract (`base.css`: semantic colours, control shapes, the gutter and the phone rules, one focus ring), the four sites' themes, and the primitives on it: Button, Badge, Card, the fields, Label and Field, Dialog, Disclosure, List, Menu, Switch, SegmentedControl, Tabs and NavTabs, Table, RadioGroup, SubmitButton, FormError/FormNote, RequiredFieldsForm, CopyButton, the footer pieces, PageShell/PageColumn/PageHeader and `cn`.
