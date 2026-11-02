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
| `@kaperkunde/ui/card`                | `Card` (`size="sm"`), `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`                       | PCP, plek.je                      |
| `@kaperkunde/ui/input`               | `Input`, `Textarea`, `Select`, `Checkbox`, `fieldClassName`                                                                         | PCP                               |
| `@kaperkunde/ui/label`               | `Label` (`required` marks "(needed)"), `Field` (label, hint, error)                                                                 | PCP, Study Guild                  |
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
| `@kaperkunde/ui/footer`              | `OperatorCredit`, `FooterLinks`, `SiteFooter`                                                                                       | every site footer                 |
| `@kaperkunde/ui/page`                | `PageShell`, `PageColumn`, `PageHeader` (back link, icon, kicker, title, description, action)                                       | PCP, pcp.gg, Study Guild          |

`next` is an optional peer: only `button` (ButtonLink), `list`, `menu`,
`nav-tabs`, `footer` and `page` import `next/link`.

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

The shape is a theme's too: PCP's proportions are the defaults, and a theme
overrides any of them as plain variables on `:root` (`themes/plekje.css`
does, for shadcn's tighter base-nova sizes):

| Variables                                                                   | What                                        |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| `--spacing-control-{xs,sm,md,lg}`, `--spacing-control-{xs,sm,md,lg}-x`      | a button's height and side padding per size |
| `--text-control-{xs,sm,md,lg}`, `--radius-control-{xs,sm,md,lg}`            | its type size and corner                    |
| `--spacing-field`, `--spacing-field-x`                                      | an input's height and side padding          |
| `--spacing-card`, `--spacing-card-sm`, `--text-card-title`, `--radius-card` | a card                                      |
| `--radius-badge`, `--radius-menu`, `--radius-dialog`                        | badges (a pill on plek.je), menus, dialogs  |

## On a phone

`base.css` writes Lore Spawner's phone rules once:

- **The gutter is a token, and the notch is paid for in it.** `px-gutter` pads
  with `max(var(--gutter), env(safe-area-inset-*))`, `pb-safe` with the home
  indicator's inset; ask for `viewport-fit=cover` in the viewport tag.
- **A field under 16px zooms iOS in on itself**, so every input, select and
  text area is 16px under 560px, whatever size it was given.
- **`overflow-wrap: break-word`, never `anywhere`**, which inside a flex row
  makes every name one letter wide; `body` has it.
- Safari's text inflation is off (`text-size-adjust: 100%`).

## Moving an app over

The variants are the union of what the apps draw, so a few names move:

- **PCP**: `Button` and `Badge` `variant="outline"` become `"secondary"`
  (PCP's outline was its alias); the theme names every colour components/ui
  wrote in place, so nothing else changes.
- **pcp.gg, plek.je**: `Button` with no variant becomes
  `variant="primary-outline"`, `"solid"` becomes the default, `"destructive"`
  becomes `"destructive-soft"`; `Badge` with no variant becomes `"solid"`,
  `"secondary"` becomes `"solid-secondary"`. `SegmentedControl` takes
  `legend` and `onValueChange` (was `label`, `onChange`). Tabs lose the
  unused `line` variant.
- **Study Guild**: its theme keeps `paper`, `ink`, `guild`, `gold` and the
  brutal shadows as they are, and maps the semantic tokens onto them. Its
  ink-outlined buttons, panels and fields stay its own; the shared
  `RequiredFieldsForm`, `SubmitButton`, `FormError`, footer pieces and
  `PageHeader` work on its theme. Its `text-muted` is a text colour where the
  token set's `muted` is a background: until it is renamed
  `text-muted-foreground`, a shared `bg-muted` draws in that grey.
