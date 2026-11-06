# @kaperkunde/ui

One token contract for Kaperkunde's Tailwind v4 apps, and the primitives
written against it. The components draw only with semantic names
(`bg-primary`, `h-control-md`, `rounded-card`, `shadow-dialog`); each site's
theme file says what those names are, so a site adopting the package keeps
its own colours, type and proportions. No CSS-in-JS: every class is a
Tailwind class your own build generates.

## Set up

```css
/* app/globals.css */
@import "tailwindcss";
@import "@kaperkunde/ui/base.css";
@import "@kaperkunde/ui/themes/plekje.css"; /* or your own: see Tokens */

/* Your app's own utilities and components follow. */
```

`base.css` carries `@source "./"`, so Tailwind scans the package's `dist/`
for its classes. If your setup does not follow it (a CSS bundler that inlines
imports before Tailwind sees them), say it yourself:

```css
@source "../node_modules/@kaperkunde/ui/dist";
```

Use the package's `cn` (`@kaperkunde/ui/cn`) in place of your own
`clsx` + `tailwind-merge`: it knows the token names, so `cn("h-control-md",
"h-12")` keeps `h-12` and `text-control-md` is not taken for a colour.

## Imports

One subpath per component, so a page loads only what it uses.
`"use client"` is on the interactive ones alone (marked ●); the rest are
server components.

| Import                               | What it gives                                                                                                                       | From                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@kaperkunde/ui/base.css`            | The token mapping, the shape defaults, `px-gutter`, `pb-safe`, `focus-ring`, `focus-ring-field`, the base layer and the phone rules | PCP, Lore Spawner                 |
| `@kaperkunde/ui/themes/<site>.css`   | `pcp`, `pcp-gg`, `plekje`, `studyguild`: each site's palette as its `globals.css` has it                                            | each site                         |
| `@kaperkunde/ui/cn`                  | `cn()`                                                                                                                              | every app                         |
| `@kaperkunde/ui/button`              | `Button` (Base UI), `ButtonLink` (next/link), `buttonVariants`                                                                      | PCP, plek.je, pcp.gg              |
| `@kaperkunde/ui/badge`               | `Badge`, `badgeVariants`, `CountBadge`, `StatusDot`                                                                                 | PCP, plek.je                      |
| `@kaperkunde/ui/card`                | `Card` (`size="sm"`, `clip`), `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`               | PCP, plek.je                      |
| `@kaperkunde/ui/input`               | `Input`, `Textarea`, `Select`, `Checkbox`, `fieldClassName`                                                                         | PCP                               |
| `@kaperkunde/ui/label`               | `Label` (`required` marks "(needed)"), `Field` (label, hint, error; `labelClassName`, `hintClassName`)                              | PCP, Study Guild                  |
| `@kaperkunde/ui/dialog` ●            | `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogFooter`                       | PCP                               |
| `@kaperkunde/ui/disclosure`          | `Disclosure` (native details)                                                                                                       | PCP                               |
| `@kaperkunde/ui/list`                | `List`, `ListSection`, `ListRow`, `RowValue`                                                                                        | PCP                               |
| `@kaperkunde/ui/menu` ●              | `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuLinkItem`, `MenuSeparator`, `MenuNote`                                       | PCP                               |
| `@kaperkunde/ui/switch`              | `Switch` (a checkbox with `role="switch"`), `SwitchRow`                                                                             | PCP                               |
| `@kaperkunde/ui/segmented-control` ● | `SegmentedControl`: native radios in a fieldset with a legend                                                                       | PCP                               |
| `@kaperkunde/ui/tabs` ●              | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (Base UI)                                                                          | plek.je                           |
| `@kaperkunde/ui/nav-tabs`            | `NavTabsList`, `NavTabsTrigger`: tabs that are links                                                                                | plek.je                           |
| `@kaperkunde/ui/table`               | `Table` and its parts                                                                                                               | plek.je                           |
| `@kaperkunde/ui/radio-group` ●       | `RadioGroup`, `RadioGroupItem` (Base UI)                                                                                            | plek.je                           |
| `@kaperkunde/ui/submit-button` ●     | `SubmitButton`: `pendingText` while the action runs, disabled then and only then                                                    | PCP, Lore Spawner                 |
| `@kaperkunde/ui/form-status`         | `FormError` (role=alert, optional support link), `FormNote` (role=status), `FormStatus`                                             | PCP, plek.je, pcp.gg, Study Guild |
| `@kaperkunde/ui/required-fields` ●   | `RequiredFieldsForm`, `useRequiredFields`, `stillNeeded`                                                                            | Lore Spawner                      |
| `@kaperkunde/ui/copy-button` ●       | `CopyButton`, `CopyableValue`                                                                                                       | pcp.gg, plek.je, PCP              |
| `@kaperkunde/ui/footer`              | `OperatorCredit` (`template`), `FooterLinks`, `SiteFooter`                                                                          | every site footer                 |
| `@kaperkunde/ui/page`                | `PageShell`, `PageColumn`, `PageHeader` (back link, icon, kicker, title, description, action; `actionsAlign`, a class for each)     | PCP, pcp.gg, Study Guild          |

`next` is an optional peer: only `button` (ButtonLink), `list`, `menu`,
`nav-tabs`, `footer` and `page` import `next/link`.

## Options a site opts into

Each draws exactly as before unless a site asks for it.

- **Button** `size="xl"` (and `"icon-xl"`): the large call to action, on the
  `--*-control-xl` tokens. An outlined variant loses its line with
  `className="border-transparent"`; `cn` lets that win over `border-border`
  and `border-primary`.
- **Card** `clip`: `overflow-hidden`, for an image or a table running edge to
  edge under the rounded corners. Off by default, because it also cuts a
  focus ring or a menu reaching past the edge and lets the card grow
  narrower than its content in a flex row.
- **CardTitle** `as="h3"` or `as="div"`: a heading tracks as the theme's
  h1–h4 (or as `--card-title-tracking`); a `div` is no heading and keeps the
  text's own spacing.
- **Field** `labelClassName`, `hintClassName`; **PageHeader**
  `kickerClassName`, `titleClassName`, `descriptionClassName`: added to the
  part's own classes, a class of the same kind replacing the default.
- **PageHeader** `actionsAlign="end"`: the actions sit level with the foot of
  the title block from 640px (`"center"`, the middle, is the default).
- **OperatorCredit** `template`: the line in a site's own words and order,
  as a string or a function of the parts.

  ```tsx
  <OperatorCredit
    operator={OPERATOR}
    template="Run by {operator} in {country} · KVK {kvk}"
  />
  <OperatorCredit
    operator={OPERATOR}
    template={({ operator, country, kvk }) => (
      <>
        Run by {operator} in {country} · KVK {kvk} ·{" "}
        <Link href="/subprocessors">Subprocessors</Link>
      </>
    )}
  />
  ```

- **`<summary data-marker>`** keeps the browser's own triangle, which
  `base.css` otherwise hides (the Disclosure draws its own chevron).
- **`data-compact`** on an input, select or text area keeps the size it was
  given on a phone, where every other field is 16px.

## Forms say what they still need

A button is never greyed out for a field nobody has filled in yet: a disabled
button says no and never says why. Mark what is required, let the press
answer, and keep `disabled` for a write in flight.

```tsx
<RequiredFieldsForm action={formAction}>
  <Field label="Name" htmlFor="name" required>
    <Input id="name" name="name" required />
  </Field>
  <SubmitButton pendingText="Saving…">Save</SubmitButton>
  <FormError error={state.error} support={{ href: supportMailto }} />
</RequiredFieldsForm>
```

On a press with something missing the form names it ("Still needed: Name."),
moves the focus to the first, and sets `data-asked`, which turns the empty
fields' borders red; filling one in takes it off the list. The action runs
only once nothing is missing. `useRequiredFields()` gives the same as
`formProps` and `message` for a form laid out otherwise.

## Tokens

A theme sets, on `:root`, the base colours: `background`, `foreground`,
`card`, `card-foreground`, `popover`, `popover-foreground`, `primary`,
`primary-foreground`, `secondary`, `secondary-foreground`, `muted`,
`muted-foreground`, `accent`, `accent-foreground`, `destructive`, `warning`,
`border`, `input`, `ring`, and `--radius`. Everything else falls back to
those when a theme leaves it out:

| Token                                                                                   | Falls back to                          | Drawn by                  |
| --------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------- |
| `success`, `warning-foreground`                                                         | `primary`, `background`                | badges, status dots       |
| `field`, `separator`, `row-hover`                                                       | transparent, `border`, `muted`         | inputs, lists             |
| `secondary-hover`, `secondary-hover-foreground`                                         | `secondary` 5% toward `foreground`     | the secondary button      |
| `highlight`                                                                             | `row-hover`                            | a menu's highlighted item |
| `dialog`, `overlay`                                                                     | `popover`, black at 60%                | dialogs                   |
| `switch`, `switch-thumb`                                                                | `secondary`, `foreground`              | the switch                |
| `segment-foreground`, `segment-active(-foreground)`, `segment-allow…`, `segment-block…` | `muted-foreground`, `secondary`, tints | the segmented control     |
| `control-shadow`, `card-shadow`, `popover-shadow`, `dialog-shadow`                      | none                                   | buttons, cards, menus     |
| `heading-weight`, `heading-tracking`, `heading-color`                                   | 600, -0.015em, `foreground`            | h1–h4                     |
| `gutter`                                                                                | 16px, 24px from 640px                  | `px-gutter`               |
| `badge-destructive-tint`                                                                | 15%                                    | the destructive badge     |
| `segment-border-width`, `segment-pad`, `segment-height`, `segment-text`                 | 0, 2px, 30px, 13px                     | the segmented control     |
| `segment-active-shadow`                                                                 | none                                   | its chosen option         |
| `card-slots`                                                                            | 0                                      | who pads a card's sides   |
| `card-gap`, `card-gap-sm`                                                               | 16px, 12px                             | between a card's parts    |
| `card-title-tracking`                                                                   | `heading-tracking`                     | a heading CardTitle       |
| `placeholder`                                                                           | `muted-foreground` at 70%              | a field's placeholder     |
| `control-border-width`                                                                  | 1px                                    | a button's border         |

The shape is a theme's too: PCP's proportions are the defaults, and a theme
overrides any of them as plain variables on `:root` (`themes/plekje.css`
does, for shadcn's tighter base-nova sizes):

| Variables                                                                    | What                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| `--spacing-control-{xs,sm,md,lg,xl}`, `--spacing-control-{xs,sm,md,lg,xl}-x` | a button's height and side padding per size |
| `--text-control-{xs,sm,md,lg,xl}`, `--radius-control-{xs,sm,md,lg,xl}`       | its type size and corner                    |
| `--text-control-{xs,…}--line-height`                                         | the line it sits on, in a theme's `@theme`  |
| `--spacing-field`, `--spacing-field-x`                                       | an input's height and side padding          |
| `--spacing-card`, `--spacing-card-sm`, `--text-card-title`, `--radius-card`  | a card                                      |
| `--text-card-description`                                                    | a card's description (13px)                 |
| `--font-weight-control`, `--font-weight-control-primary`                     | a button's weight, and the filled primary's |
| `--radius-badge`, `--spacing-badge-x`, `--text-badge`, `--font-weight-badge` | a badge (a medium 12px pill on plek.je)     |
| `--radius-menu`, `--radius-dialog`, `--font-weight-segment`                  | menus, dialogs, a segment's label           |

Tailwind gives a `text-control-*` class a line height only when its key is
in an `@theme` block, so a line height a theme adds goes there, not on
`:root`. The extra-small control sits on `text-xs`'s line
(`calc(1 / 0.75)`) and the extra-large on 1.5 everywhere; the others take
the line around them, except on pcp.gg and plek.je, whose themes put md and
lg on `text-sm`'s (`calc(1.25 / 0.875)`) and plek.je's badges on `text-xs`'s.

`--card-slots` picks who pads a card's sides: `0` (PCP's), the card pads
whatever it holds and a CardFooter bleeds to its edges; `1` (shadcn's, as on
pcp.gg and plek.je), the card pads only top and bottom and CardHeader,
CardContent and CardFooter pad their own sides.

## On a phone

`base.css` writes Lore Spawner's phone rules once:

- **The gutter is a token, and the notch is paid for in it.** `px-gutter` pads
  with `max(var(--gutter), env(safe-area-inset-*))`, `pb-safe` with the home
  indicator's inset; ask for `viewport-fit=cover` in the viewport tag.
- **A field under 16px zooms iOS in on itself**, so every input, select and
  text area is 16px under 560px, whatever size it was given, unless it is
  marked `data-compact` (drawn small on purpose).
- **`overflow-wrap: break-word`, never `anywhere`**, which inside a flex row
  makes every name one letter wide; `body` has it.
- Safari's text inflation is off (`text-size-adjust: 100%`).

## Moving an app over

The variants are the union of what the apps draw, so a few names move:

- **PCP**: `Button` and `Badge` `variant="outline"` become `"secondary"`
  (PCP's outline was its alias); the theme names every colour components/ui
  wrote in place. `SubmitButton` has no `disabled`: share-review's push
  button (`disabled={waiting > 0}`, held until the personal-data check is
  settled) becomes a plain `Button type="submit"`. Two small changes come
  with the package: `PageHeader` is a `<header>` (inside `<main>` it is no
  landmark) where PCP's was a `<div>`, and a dialog's height is capped by
  `100dvh` rather than `100vh`, so it fits under a phone's browser bars.
- **pcp.gg, plek.je**: their themes set the base-nova shapes (control sizes,
  medium filled buttons, medium 12px pill badges with a 10% destructive tint,
  ringed cards padded per slot, and on plek.je the ringed segmented control),
  so only names move. `Button` with no variant becomes
  `variant="primary-outline"`, `"solid"` becomes the default, `"destructive"`
  becomes `"destructive-soft"`; `Badge` with no variant becomes `"solid"`,
  `"secondary"` becomes `"solid-secondary"`. `SegmentedControl` takes
  `legend` and `onValueChange` (was `label`, `onChange`). Tabs lose the
  unused `line` variant.
- **Study Guild**: its theme keeps `paper`, `ink`, `guild`, `gold` and the
  brutal shadows as they are, and maps the semantic tokens onto them. Its
  ink-outlined buttons, panels and fields stay its own; the shared
  `RequiredFieldsForm`, `SubmitButton`, `FormError`, footer pieces and
  `PageHeader` work on its theme. Its grey text is `text-muted-foreground`;
  `muted` is the paper background, as the token set has it.
