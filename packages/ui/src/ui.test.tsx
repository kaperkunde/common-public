import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Badge, CountBadge, StatusDot } from "./badge"
import { Button, ButtonLink, buttonVariants } from "./button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card"
import { cn } from "./cn"
import { CopyableValue, CopyButton } from "./copy-button"
import { Dialog, DialogContent, DialogTitle } from "./dialog"
import { Disclosure } from "./disclosure"
import { FooterLinks, OperatorCredit, SiteFooter } from "./footer"
import { FormError, FormNote, FormStatus } from "./form-status"
import { Checkbox, Input, Select, Textarea } from "./input"
import { Field, Label } from "./label"
import { List, ListRow, ListSection, RowValue } from "./list"
import { NavTabsList, NavTabsTrigger } from "./nav-tabs"
import { PageColumn, PageHeader, PageShell } from "./page"
import { RadioGroup, RadioGroupItem } from "./radio-group"
import { RequiredFieldsForm } from "./required-fields"
import { SegmentedControl } from "./segmented-control"
import { SubmitButton } from "./submit-button"
import { Switch, SwitchRow } from "./switch"
import { Table, TableBody, TableCell, TableRow } from "./table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

const html = (node: React.ReactNode) => renderToStaticMarkup(node)

/** The first opening tag named `name` in `markup` that contains `having`. */
function tagOf(markup: string, name: string, having = ""): string {
  const tags = markup.match(new RegExp(`<${name}(?=[\\s/>])[^>]*>`, "g")) ?? []
  const tag = tags.find((candidate) => candidate.includes(having))
  if (!tag) throw new Error(`no <${name}> with ${having} in ${markup}`)
  return tag
}

const OPERATOR = {
  name: "Kaperkunde",
  url: "https://kaperkunde.com",
  country: "the Netherlands",
  kvk: "42061326",
}

describe("cn", () => {
  it("lets a later class replace a token class of the same kind", () => {
    expect(cn("h-control-md px-control-md-x", "h-12")).toBe(
      "px-control-md-x h-12",
    )
    expect(cn("text-control-md text-primary", "text-sm")).toBe(
      "text-primary text-sm",
    )
    expect(cn("rounded-card", "rounded-none")).toBe("rounded-none")
    expect(cn("shadow-card", "shadow-none")).toBe("shadow-none")
  })

  it("keeps a token font size beside a colour", () => {
    expect(cn("text-control-sm", "text-primary-foreground")).toBe(
      "text-control-sm text-primary-foreground",
    )
    expect(cn("text-control-xl", "text-primary-foreground")).toBe(
      "text-control-xl text-primary-foreground",
    )
    expect(cn("text-card-description", "text-muted-foreground")).toBe(
      "text-card-description text-muted-foreground",
    )
  })

  it("knows the extra-large control tokens", () => {
    expect(
      cn("h-control-xl px-control-xl-x text-control-xl rounded-control-xl", [
        "h-12 px-6 text-sm rounded-none",
      ]),
    ).toBe("h-12 px-6 text-sm rounded-none")
  })
})

describe("Button", () => {
  it("is a native button sized and coloured by tokens", () => {
    const button = tagOf(html(<Button>Save</Button>), "button")
    expect(button).toContain('type="button"')
    expect(button).toContain("bg-primary")
    expect(button).toContain("text-primary-foreground")
    expect(button).toContain("h-control-md")
    expect(button).toContain("text-control-md")
    expect(button).toContain("rounded-control-md")
    expect(button).toContain("focus-ring")
    expect(button).toContain("font-control-primary")
    expect(button).not.toContain("font-control ")
    expect(buttonVariants({ variant: "secondary" })).toContain("font-control")
  })

  it("has every variant and size the apps draw", () => {
    expect(buttonVariants({ variant: "primary-outline" })).toContain(
      "border-primary",
    )
    expect(buttonVariants({ variant: "outline" })).toContain("border-border")
    expect(buttonVariants({ variant: "destructive-soft" })).toContain(
      "bg-destructive/10",
    )
    expect(buttonVariants({ variant: "secondary" })).toContain(
      "hover:bg-secondary-hover",
    )
    expect(buttonVariants({ size: "icon-sm" })).toContain("size-control-sm")
    expect(buttonVariants({ size: "lg" })).toContain("h-control-lg")
  })

  it("has an extra-large size on its own tokens", () => {
    const xl = buttonVariants({ size: "xl" })
    for (const token of [
      "h-control-xl",
      "gap-2",
      "rounded-control-xl",
      "px-control-xl-x",
      "text-control-xl",
    ]) {
      expect(xl).toContain(token)
    }
    expect(buttonVariants({ size: "icon-xl" })).toContain("size-control-xl")
  })

  it("draws its border at the theme's width, 1px unless it says", () => {
    expect(buttonVariants()).toContain(
      "border-[length:var(--control-border-width,1px)]",
    )
    expect(cn(buttonVariants(), "border-2")).not.toContain(
      "--control-border-width",
    )
  })

  it("lets border-transparent take an outlined variant's line away", () => {
    for (const variant of ["outline", "primary-outline"] as const) {
      const classes = cn(
        buttonVariants({ variant, size: "xl" }),
        "border-transparent",
      ).split(" ")
      expect(classes).toContain("border-transparent")
      expect(classes).not.toContain("border-border")
      expect(classes).not.toContain("border-primary")
      expect(classes).toContain(
        "border-[length:var(--control-border-width,1px)]",
      )
    }
    for (const variant of ["link", "ghost", "plain"] as const) {
      const classes = buttonVariants({ variant }).split(" ")
      expect(classes).toContain("border-transparent")
      expect(classes.filter((name) => /^border-[a-z]+$/.test(name))).toEqual([
        "border-transparent",
      ])
    }
  })

  it("lets a class passed in win", () => {
    expect(
      tagOf(html(<Button className="h-12">Go</Button>), "button"),
    ).not.toContain("h-control-md")
  })

  it("renders a ButtonLink as a link, not a button", () => {
    const markup = html(
      <ButtonLink href="/new" variant="secondary">
        New
      </ButtonLink>,
    )
    expect(tagOf(markup, "a")).toContain('href="/new"')
    expect(markup).toContain("bg-secondary")
    expect(markup).not.toContain("<button")
  })
})

describe("SubmitButton", () => {
  it("is a submit button that is not disabled while idle", () => {
    const button = tagOf(
      html(
        <form>
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </form>,
      ),
      "button",
    )
    expect(button).toContain('type="submit"')
    expect(button).not.toMatch(/\sdisabled[\s=>]/)
    expect(button).not.toContain("aria-busy")
  })
})

describe("Badge", () => {
  it("draws its corner from the badge radius token", () => {
    const badge = tagOf(html(<Badge>Read-only</Badge>), "span")
    expect(badge).toContain("rounded-badge")
    expect(badge).toContain("px-badge-x")
    expect(badge).toContain("text-badge")
    expect(badge).toContain("font-badge")
    expect(badge).toContain("bg-accent")
    expect(html(<Badge variant="destructive">No</Badge>)).toContain(
      "var(--badge-destructive-tint,15%)",
    )
  })

  it("has the solid and outlined variants", () => {
    expect(html(<Badge variant="solid">On</Badge>)).toContain("bg-primary")
    expect(html(<Badge variant="solid-secondary">On</Badge>)).toContain(
      "bg-secondary",
    )
    expect(html(<Badge variant="outline">On</Badge>)).toContain("border-border")
  })

  it("counts to 99 and hides at nothing", () => {
    expect(html(<CountBadge count={0} />)).toBe("")
    expect(html(<CountBadge count={120} />)).toContain("99+")
  })

  it("hides the status dot from assistive technology", () => {
    expect(html(<StatusDot tone="warning" />)).toContain('aria-hidden="true"')
  })
})

describe("Card", () => {
  it("takes its padding, corner and edge from tokens", () => {
    const markup = html(
      <Card size="sm">
        <CardHeader>
          <CardTitle>Backups</CardTitle>
          <CardDescription>Nightly</CardDescription>
          <CardAction>Edit</CardAction>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    )
    const card = tagOf(markup, "div")
    expect(card).toContain('data-size="sm"')
    expect(card).toContain("rounded-card")
    expect(card).toContain("shadow-card")
    expect(card).toContain("[--card-pad:var(--spacing-card)]")
    expect(markup).toContain("<h2")
    expect(markup).toContain("text-card-title")
    expect(card).toContain("px-(--card-px)")
    expect(card).toContain("var(--card-slots,0)")
    expect(tagOf(markup, "div", "card-header")).toContain("px-(--card-slot-px)")
    expect(tagOf(markup, "div", "card-content")).toContain(
      "px-(--card-slot-px)",
    )
    expect(tagOf(markup, "div", "card-footer")).toContain("-mx-(--card-px)")
  })

  it("lets the title be another element", () => {
    expect(html(<CardTitle as="div">Plain</CardTitle>)).toMatch(/^<div/)
    expect(html(<CardTitle as="h3">Sub</CardTitle>)).toMatch(
      /^<h3 data-slot="card-title"/,
    )
  })

  it("spaces its parts by --card-gap, 16px (12px small) unless set", () => {
    const card = tagOf(html(<Card>Body</Card>), "div")
    expect(card).toContain("gap-[var(--card-gap,calc(var(--spacing)*4))]")
    expect(card).toContain(
      "data-[size=sm]:gap-[var(--card-gap-sm,calc(var(--spacing)*3))]",
    )
    expect(card).not.toContain(" gap-4")
    expect(
      tagOf(html(<Card className="gap-6">Body</Card>), "div"),
    ).not.toContain("--card-gap,")
  })

  it("clips what pokes out only when asked", () => {
    expect(tagOf(html(<Card>Body</Card>), "div")).not.toContain(
      "overflow-hidden",
    )
    expect(tagOf(html(<Card clip>Body</Card>), "div")).toContain(
      "overflow-hidden",
    )
  })

  it("sizes the description by a token", () => {
    const description = tagOf(
      html(<CardDescription>Nightly</CardDescription>),
      "div",
    )
    expect(description).toContain("text-card-description")
    expect(description).toContain("text-muted-foreground")
    expect(
      tagOf(
        html(<CardDescription className="text-sm">Nightly</CardDescription>),
        "div",
      ),
    ).not.toContain("text-card-description")
  })
})

describe("fields", () => {
  it("share one field class on the field colour", () => {
    for (const markup of [
      html(<Input name="a" />),
      html(<Textarea name="a" />),
      html(<Select name="a" />),
    ]) {
      expect(markup).toContain("border-input")
      expect(markup).toContain("focus-ring-field")
      expect(markup).toContain("in-data-asked:invalid:border-destructive")
    }
    expect(html(<Input />)).toContain("h-field")
    expect(html(<Input />)).toContain("bg-field")
    expect(html(<Textarea />)).toContain("h-auto")
    expect(html(<Select />)).toContain("bg-secondary")
    expect(html(<Input />)).toContain("placeholder:text-placeholder")
    expect(tagOf(html(<Select data-compact="" />), "select")).toContain(
      'data-compact=""',
    )
    expect(tagOf(html(<Checkbox />), "input")).toContain('type="checkbox"')
  })

  it("marks a required label with CSS, not with words", () => {
    const label = tagOf(
      html(
        <Label htmlFor="name" required>
          Name
        </Label>,
      ),
      "label",
    )
    expect(label).toContain('data-required-mark="(needed)"')
    expect(label).toContain("after:content-[attr(data-required-mark)]")
    expect(html(<Label required>Name</Label>)).toContain(">Name</label>")
  })

  it("wires a Field's hint and error to the control's id", () => {
    const withHint = html(
      <Field label="Email" htmlFor="email" hint="We never share it">
        <Input id="email" />
      </Field>,
    )
    expect(withHint).toContain('for="email"')
    expect(withHint).toContain('id="email-hint"')

    const withError = html(
      <Field label="Email" htmlFor="email" hint="Hint" error="Not an address">
        <Input id="email" />
      </Field>,
    )
    expect(withError).toContain('id="email-error"')
    expect(withError).toContain('role="alert"')
    expect(withError).not.toContain("email-hint")
  })

  it("ties a Field's hint to its control with aria-describedby", () => {
    const tied = html(
      <Field label="Email" htmlFor="email" hint="Hint">
        <Input id="email" />
      </Field>,
    )
    expect(tied).toContain('aria-describedby="email-hint"')

    const merged = html(
      <Field label="Email" htmlFor="email" hint="Hint">
        <Input id="email" aria-describedby="other" />
      </Field>,
    )
    expect(merged).toContain('aria-describedby="other email-hint"')

    const noHint = html(
      <Field label="Email" htmlFor="email">
        <Input id="email" aria-describedby="other" />
      </Field>,
    )
    expect(noHint).toContain('aria-describedby="other"')
    expect(noHint).not.toContain("email-hint")

    const withError = html(
      <Field label="Email" htmlFor="email" hint="Hint" error="Bad">
        <Input id="email" />
      </Field>,
    )
    expect(withError).not.toContain("aria-describedby")
  })

  it("adds a class of its own to a Field's label and hint", () => {
    const plain = html(
      <Field label="Email" htmlFor="email" hint="Hint">
        <Input id="email" />
      </Field>,
    )
    const styled = html(
      <Field
        label="Email"
        htmlFor="email"
        hint="Hint"
        labelClassName="font-black uppercase"
        hintClassName="text-sm"
      >
        <Input id="email" />
      </Field>,
    )
    expect(tagOf(styled, "label")).toContain("font-black uppercase")
    expect(tagOf(styled, "label")).not.toContain("font-medium")
    expect(tagOf(styled, "div", "email-hint")).toContain(
      "text-muted-foreground text-sm",
    )
    expect(tagOf(styled, "div", "email-hint")).not.toContain("text-xs")
    expect(tagOf(plain, "div", "email-hint")).toContain(
      'class="text-xs text-muted-foreground"',
    )
  })
})

describe("SegmentedControl", () => {
  it("renders native radios in a fieldset with a legend", () => {
    const markup = html(
      <SegmentedControl
        name="level"
        legend="Level"
        defaultValue="ask"
        options={[
          { value: "allow", label: "Allow", tone: "allow" },
          { value: "ask", label: "Ask" },
          { value: "block", label: "Block", tone: "block" },
        ]}
      />,
    )
    expect(markup).toMatch(/^<fieldset/)
    expect(markup).toContain('<legend class="sr-only">Level</legend>')
    expect(markup.match(/type="radio"/g)).toHaveLength(3)
    expect(markup.match(/name="level"/g)).toHaveLength(3)
    expect(tagOf(markup, "input", 'value="ask"')).toContain("checked")
    expect(markup).toContain("peer-checked:bg-segment-allow")
    expect(markup).toContain("peer-checked:bg-segment-block")
    expect(markup).toContain("peer-checked:bg-segment-active")
    expect(tagOf(markup, "fieldset")).toContain(
      "border-[length:var(--segment-border-width,0px)]",
    )
    expect(markup).toContain("font-segment")
  })

  it("groups its radios under a generated name when it has none", () => {
    const markup = html(
      <SegmentedControl
        legend="Where"
        value="eu"
        onValueChange={() => {}}
        options={[
          { value: "eu", label: "Europe" },
          { value: "us", label: "America" },
        ]}
      />,
    )
    const names = [...markup.matchAll(/name="([^"]+)"/g)].map((m) => m[1])
    expect(names).toHaveLength(2)
    expect(names[0]).toBe(names[1])
  })
})

describe("Switch", () => {
  it("is a checkbox with the switch role, named by its row's label", () => {
    const markup = html(
      <SwitchRow id="pause" label="Pause" description="Stops it" />,
    )
    const input = tagOf(markup, "input")
    expect(input).toContain('type="checkbox"')
    expect(input).toContain('role="switch"')
    expect(input).toContain("bg-switch")
    expect(markup).toContain('for="pause"')
    expect(html(<Switch defaultChecked />)).toContain("checked")
  })
})

describe("Dialog", () => {
  it("draws on the dialog tokens and is named by its title", () => {
    const markup = html(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Connect an assistant</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    // Base UI renders the popup in a portal, so on the server there is
    // nothing; the title and the tokens are asked of it in the DOM test.
    expect(markup).not.toContain("#")
  })
})

describe("Disclosure", () => {
  it("is native details and summary", () => {
    const markup = html(
      <Disclosure title="Advanced" description="Expiry, sites" defaultOpen>
        <p>Inside</p>
      </Disclosure>,
    )
    expect(tagOf(markup, "details")).toContain("open")
    expect(markup).toContain("<summary")
    expect(markup).toContain("Expiry, sites")
    expect(markup).toContain('aria-hidden="true"')
  })
})

describe("List", () => {
  it("names a section by its heading and links a row", () => {
    const markup = html(
      <ListSection title="Servers">
        <List as="ul">
          <ListRow as="li" title="Mail" description="IMAP" href="/mail" />
          <ListRow as="li" title="Count" trailing={<RowValue>2</RowValue>} />
        </List>
      </ListSection>,
    )
    const section = tagOf(markup, "section")
    const id = section.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(markup).toContain(`<h2 id="${id}"`)
    expect(markup.match(/<li/g)).toHaveLength(2)
    expect(markup).toContain('href="/mail"')
    expect(markup).toContain("divide-separator")
  })
})

describe("Tabs", () => {
  it("renders a tablist with the active tab marked", () => {
    const markup = html(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">One</TabsTrigger>
          <TabsTrigger value="b">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="a">First</TabsContent>
      </Tabs>,
    )
    expect(markup).toContain('role="tablist"')
    expect(markup.match(/role="tab"/g)).toHaveLength(2)
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain("data-active:bg-background")
  })

  it("gives link tabs the same semantics", () => {
    const markup = html(
      <NavTabsList label="Admin">
        <NavTabsTrigger href="/a" active>
          One
        </NavTabsTrigger>
        <NavTabsTrigger href="/b" active={false}>
          Two
        </NavTabsTrigger>
      </NavTabsList>,
    )
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-label="Admin"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('aria-selected="false"')
  })
})

describe("RadioGroup", () => {
  it("renders Base UI radios with the radio role", () => {
    const markup = html(
      <RadioGroup defaultValue="a" aria-label="Plan">
        <RadioGroupItem value="a" aria-label="Monthly" />
        <RadioGroupItem value="b" aria-label="Yearly" />
      </RadioGroup>,
    )
    expect(markup).toContain('role="radiogroup"')
    expect(markup.match(/role="radio"/g)).toHaveLength(2)
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain("data-checked:bg-primary")
  })
})

describe("Table", () => {
  it("scrolls inside a relative box", () => {
    const markup = html(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(tagOf(markup, "div")).toContain("relative w-full overflow-x-auto")
    expect(markup).toContain("<table")
  })
})

describe("FormError and FormNote", () => {
  it("say nothing when there is nothing to say", () => {
    expect(html(<FormError error={null} />)).toBe("")
    expect(html(<FormNote message="" />)).toBe("")
    expect(html(<FormStatus />)).toBe("")
  })

  it("read an error out as an alert and a note as a status", () => {
    expect(tagOf(html(<FormError error="No." />), "p")).toContain(
      'role="alert"',
    )
    expect(tagOf(html(<FormNote message="Saved." />), "p")).toContain(
      'role="status"',
    )
    expect(html(<FormStatus error="No." message="Saved." />)).toContain(
      'role="alert"',
    )
    expect(html(<FormError error="No." variant="banner" />)).toContain(
      "bg-destructive/10",
    )
  })

  it("offers support only for the errors it is told to", () => {
    const support = { href: "mailto:support@example.com?subject=Help" }
    const unexpected = "Something went wrong."
    const offer = (error: React.ReactNode) => error === unexpected

    const offered = html(
      <FormError error={unexpected} support={support} offerSupport={offer} />,
    )
    expect(offered).toContain('href="mailto:support@example.com?subject=Help"')
    expect(offered).toContain("email support")

    expect(
      html(
        <FormError
          error="That name is taken."
          support={support}
          offerSupport={offer}
        />,
      ),
    ).not.toContain("mailto:")
  })
})

describe("RequiredFieldsForm", () => {
  it("turns the browser's own validation off and asks nothing yet", () => {
    const markup = html(
      <RequiredFieldsForm>
        <Input required name="name" />
      </RequiredFieldsForm>,
    )
    expect(tagOf(markup, "form").toLowerCase()).toContain("novalidate")
    expect(tagOf(markup, "form")).not.toContain("data-asked")
    expect(markup).not.toContain("Still needed")
  })
})

describe("CopyButton", () => {
  it("is a plain button that says what it copies", () => {
    const markup = html(<CopyButton value="abc" label="Copy address" />)
    expect(tagOf(markup, "button")).toContain('type="button"')
    expect(markup).toContain("Copy address")
    expect(html(<CopyableValue value="abc" testId="token" />)).toContain(
      'data-testid="token"',
    )
  })
})

describe("footer", () => {
  it("credits the operator, with the KVK number when asked", () => {
    const markup = html(<OperatorCredit operator={OPERATOR} kvk />)
    expect(markup).toContain("Made with care in the Netherlands by")
    expect(markup).toContain('href="https://kaperkunde.com"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain(" · KVK 42061326")
    expect(
      html(<OperatorCredit operator={OPERATOR} words="Made with love" />),
    ).not.toContain("KVK")
  })

  it("words the operator line by a template", () => {
    const markup = html(
      <OperatorCredit
        operator={OPERATOR}
        template="Run by {operator} in {country} · KVK {kvk}"
        linkClassName="text-card"
      />,
    )
    expect(markup).toMatch(
      /^<p data-slot="operator-credit">Run by <a href="https:\/\/kaperkunde.com" target="_blank" rel="noopener noreferrer" class="text-card">Kaperkunde<\/a> in (<!-- -->)?the Netherlands(<!-- -->)? · KVK (<!-- -->)?42061326<\/p>$/,
    )
    expect(markup).not.toContain("Made with care")

    const withLink = html(
      <OperatorCredit
        operator={OPERATOR}
        template={({ operator, country, kvk }) => (
          <>
            Run by {operator} in {country} · KVK {kvk} ·{" "}
            <a href="/subprocessors">Subprocessors</a>
          </>
        )}
      />,
    )
    expect(withLink).toContain("Run by <a")
    expect(withLink).toContain('href="/subprocessors"')
    expect(withLink).toContain("42061326")
  })

  it("opens outside addresses in a new tab and keeps the rest here", () => {
    const markup = html(
      <FooterLinks
        links={[
          { href: "/about", label: "About" },
          { href: "https://github.com/x", label: "Source" },
          { href: "mailto:hi@example.com", label: "Support" },
        ]}
      />,
    )
    expect(tagOf(markup, "nav")).toContain('aria-label="Footer"')
    expect(tagOf(markup, "a", 'href="/about"')).not.toContain("target")
    expect(tagOf(markup, "a", 'href="https://github.com/x"')).toContain(
      'target="_blank"',
    )
    expect(tagOf(markup, "a", 'href="mailto:hi@example.com"')).not.toContain(
      "target",
    )
  })

  it("lays the footer out inside the gutter", () => {
    const markup = html(
      <SiteFooter
        links={[{ href: "/terms", label: "Terms" }]}
        credit={<OperatorCredit operator={OPERATOR} />}
      />,
    )
    expect(tagOf(markup, "footer")).toContain("px-gutter")
    expect(markup).toContain("Kaperkunde")
  })
})

describe("page", () => {
  it("frames a page with the gutter and a title", () => {
    const markup = html(
      <PageShell header={<div>Top</div>} footer={<div>Foot</div>}>
        <PageColumn width="narrow">
          <PageHeader
            title="Servers"
            kicker="Settings"
            description="What PCP reaches"
            back={{ href: "/", label: "Home" }}
            action={<Button>Add</Button>}
          />
        </PageColumn>
      </PageShell>,
    )
    expect(tagOf(markup, "main")).toContain("px-gutter")
    expect(markup).toContain("max-w-[820px]")
    expect(markup).toContain("<h1")
    expect(markup).toContain(">Servers</h1>")
    expect(markup).toContain('href="/"')
    expect(markup).toContain("Settings")
  })

  it("centres the actions unless told to sit at the foot", () => {
    const centred = html(<PageHeader title="Guilds" action={<a>Add</a>} />)
    expect(centred).not.toContain("self-end")
    const atFoot = html(
      <PageHeader title="Guilds" action={<a>Add</a>} actionsAlign="end" />,
    )
    expect(tagOf(atFoot, "div", "gap-2")).toContain("sm:self-end")
  })

  it("adds a class of its own to the kicker, title and description", () => {
    const markup = html(
      <PageHeader
        title="Guilds"
        kicker="Hall"
        description="Every guild"
        kickerClassName="text-guild font-black"
        titleClassName="font-display text-3xl"
        descriptionClassName="text-[15px]"
      />,
    )
    const title = tagOf(markup, "h1")
    expect(title).toContain("font-display text-3xl")
    expect(title).not.toContain("text-[28px]")
    expect(title).toContain("sm:text-[30px]")
    expect(tagOf(markup, "div", "uppercase")).toContain("text-guild font-black")
    expect(tagOf(markup, "div", "uppercase")).not.toContain("font-semibold")
    expect(tagOf(markup, "div", "max-w-2xl")).toContain("text-[15px]")
    expect(tagOf(markup, "div", "max-w-2xl")).not.toContain("text-sm")
  })
})
