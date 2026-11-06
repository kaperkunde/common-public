---
"@kaperkunde/ui": minor
---

Options the apps asked for while moving onto the package, each drawing exactly as before until a site opts in:

- `Button` and `buttonVariants` gain `size="xl"` and `"icon-xl"`, on new `--spacing-control-xl`, `--spacing-control-xl-x`, `--text-control-xl` and `--radius-control-xl` tokens (pcp.gg's and plek.je's themes set base-nova's 44px), and the border's width is `--control-border-width` (1px). `cn` knows the new names, and `border-transparent` still takes an outlined variant's line away.
- `Card` takes `clip` (`overflow-hidden`), and spaces its parts by `--card-gap` and `--card-gap-sm` (16px and 12px). `CardDescription` is sized by `--text-card-description` (13px). A heading `CardTitle` tracks as `--card-title-tracking` where a site sets it, else as the theme's headings; `as="div"` keeps the text's own spacing.
- A field's placeholder is the `placeholder` colour token, falling back to `muted-foreground` at 70%.
- `<summary data-marker>` keeps the browser's own marker, and a field marked `data-compact` keeps its own size on a phone instead of 16px. Both rules keep the specificity they had, so an app's own override still wins.
- `PageHeader` takes `kickerClassName`, `titleClassName`, `descriptionClassName` and `actionsAlign="end"` (the actions level with the foot of the title block from 640px).
- `Field` takes `labelClassName` and `hintClassName`.
- `OperatorCredit` takes `template`, a string with `{operator}`, `{name}`, `{country}` and `{kvk}` or a function of those parts, to word the line in a site's own order.
- `base.css` puts the extra-small control on `text-xs`'s line (`--text-control-xs--line-height`), as PCP, pcp.gg and plek.je already set it; pcp.gg's and plek.je's themes put md and lg on `text-sm`'s, and plek.je's badges on `text-xs`'s, as those apps already set them. A site that set these itself can drop its own lines.
- The Study Guild theme no longer overrides `--color-muted`: `bg-muted` is the paper, and the grey stays `text-muted-foreground`.
