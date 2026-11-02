/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { CopyButton } from "./copy-button"
import { Dialog, DialogContent, DialogTitle } from "./dialog"
import { Input } from "./input"
import { Label } from "./label"
import { RequiredFieldsForm, stillNeeded } from "./required-fields"

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

async function mount(node: ReactNode) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  return host
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function Form({ onSubmit }: { onSubmit: () => void }) {
  return (
    <RequiredFieldsForm
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Label htmlFor="name" required>
        Name
      </Label>
      <Input id="name" name="name" required />
      <label>
        Email <Input name="email" type="email" required />
      </label>
      <Input name="nickname" aria-label="Nickname" />
      <fieldset>
        <legend>Plan</legend>
        <input type="radio" name="plan" value="a" required aria-label="A" />
        <input type="radio" name="plan" value="b" aria-label="B" />
      </fieldset>
      <button type="submit">Save</button>
    </RequiredFieldsForm>
  )
}

describe("RequiredFieldsForm", () => {
  it("names what is missing, marks the form and focuses the first", async () => {
    const onSubmit = vi.fn()
    const page = await mount(<Form onSubmit={onSubmit} />)
    const form = page.querySelector("form")!

    await submit(form)

    expect(onSubmit).not.toHaveBeenCalled()
    expect(form.hasAttribute("data-asked")).toBe(true)
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "Still needed: Name, Email, Plan.",
    )
    expect(document.activeElement).toBe(page.querySelector("#name"))
    expect(page.querySelector("button")?.hasAttribute("disabled")).toBe(false)
  })

  it("shrinks the list as fields are filled and then submits", async () => {
    const onSubmit = vi.fn()
    const page = await mount(<Form onSubmit={onSubmit} />)
    const form = page.querySelector("form")!

    await submit(form)
    await type(page.querySelector<HTMLInputElement>("#name")!, "Ada")
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "Still needed: Email, Plan.",
    )

    await type(
      page.querySelector<HTMLInputElement>('[name="email"]')!,
      "ada@example.com",
    )
    await act(async () => {
      page.querySelector<HTMLInputElement>('[value="a"]')!.click()
    })
    await submit(form)

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(page.querySelector('[role="alert"]')).toBeNull()
    expect(form.hasAttribute("data-asked")).toBe(false)
  })

  it("reads a label's words without the control it wraps", async () => {
    const page = await mount(
      <form>
        <label>
          Country
          <select name="country" required>
            <option value="">Pick one</option>
          </select>
        </label>
      </form>,
    )
    expect(stillNeeded(page.querySelector("form")!).names).toEqual(["Country"])
  })
})

describe("Dialog", () => {
  it("is a modal dialog named by its title", async () => {
    await mount(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Connect an assistant</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    const title = document.getElementById(
      dialog.getAttribute("aria-labelledby")!,
    )
    expect(title?.textContent).toBe("Connect an assistant")
    expect(dialog.className).toContain("bg-dialog")
    expect(dialog.className).toContain("shadow-dialog")
    expect(dialog.className).toContain("rounded-dialog")
    expect(
      document.querySelector('[data-slot="dialog-backdrop"]')?.className,
    ).toContain("bg-overlay")
  })
})

describe("CopyButton", () => {
  it("copies the value and says so", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const page = await mount(<CopyButton value="pcp_123" />)
    const button = page.querySelector("button")!
    expect(button.textContent).toBe("Copy")

    await act(async () => button.click())

    expect(writeText).toHaveBeenCalledWith("pcp_123")
    expect(button.textContent).toBe("Copied")
  })

  it("stays put when the clipboard is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("blocked")
        },
      },
      configurable: true,
    })
    const page = await mount(<CopyButton value="x" />)
    const button = page.querySelector("button")!
    await act(async () => button.click())
    expect(button.textContent).toBe("Copy")
  })
})
