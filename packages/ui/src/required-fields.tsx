"use client"

import {
  useCallback,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react"

import { FormError } from "./form-status"

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function isControl(element: Element): element is Control {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  )
}

/** A label's own words, leaving out the control it wraps (a select's options). */
function labelText(label: Element, control: Element): string {
  let text = ""
  for (const node of Array.from(label.childNodes)) {
    if (node === control || node.contains(control)) continue
    text += node.textContent ?? ""
  }
  return text.replace(/\s+/g, " ").trim()
}

/**
 * What to call a control in a message: the words of its label (a radio or a
 * checkbox in a fieldset goes by the fieldset's legend), else its
 * aria-labelledby, its aria-label or its name. A "(needed)" mark on the label
 * is drawn by CSS and is not part of it.
 */
export function nameOf(control: Control): string {
  if (
    control instanceof HTMLInputElement &&
    (control.type === "radio" || control.type === "checkbox")
  ) {
    const legend = control.closest("fieldset")?.querySelector("legend")
    const words = legend?.textContent?.replace(/\s+/g, " ").trim()
    if (words) return words
  }

  const labelledBy = control.getAttribute("aria-labelledby")
  if (labelledBy) {
    const words = labelledBy
      .split(/\s+/)
      .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (words) return words
  }

  const label = control.labels?.[0]
  if (label) {
    const words = labelText(label, control)
    if (words) return words
  }

  return control.getAttribute("aria-label")?.trim() || control.name
}

/**
 * What is still empty that the form cannot do without, each named once (a
 * group of radios is one thing to fill in). Asked of the browser: `required`
 * on a control is what its validity answers (the same as `:invalid`).
 */
export function stillNeeded(form: HTMLFormElement): {
  names: string[]
  first: Control | undefined
} {
  const missing = Array.from(form.elements).filter(
    (element): element is Control =>
      isControl(element) && element.willValidate && !element.validity.valid,
  )
  const names = Array.from(new Set(missing.map(nameOf).filter(Boolean)))
  return { names, first: missing[0] }
}

export function stillNeededText(names: readonly string[]): string {
  return `Still needed: ${names.join(", ")}.`
}

/**
 * The rule every form keeps: a button is never greyed out for a field nobody
 * has filled in yet. The form presses; on the press it marks what is empty
 * and required (`data-asked` on the form, so the fields' `invalid` style
 * shows), moves the focus to the first, and names them all ("Still needed:
 * Name, Email."). Filling one in takes it off the list as it is typed.
 *
 * Spread `formProps` on the <form>; it runs before an `action`, which runs
 * only once nothing is missing. Rules no single field can state (an end
 * before its beginning) stay the caller's.
 */
export function useRequiredFields() {
  const [needed, setNeeded] = useState<string[]>([])
  const asked = needed.length > 0

  const onSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    const { names, first } = stillNeeded(event.currentTarget)
    setNeeded(names)
    if (names.length > 0) {
      event.preventDefault()
      first?.focus()
    }
  }, [])

  const onInput = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (asked) setNeeded(stillNeeded(event.currentTarget).names)
    },
    [asked],
  )

  return {
    /** The names still missing since the last press, in form order. */
    needed,
    /** "Still needed: …." once a press found something missing, else null. */
    message: asked ? stillNeededText(needed) : null,
    formProps: {
      noValidate: true,
      "data-asked": asked ? "" : undefined,
      onSubmit,
      onInput,
    },
  }
}

/**
 * A <form> keeping that rule, with the "Still needed" notice at its end
 * (under the buttons, where the reader's eye already is). Your own
 * `onSubmit` runs only once nothing is missing.
 */
export function RequiredFieldsForm({
  onSubmit,
  onInput,
  children,
  noticeClassName,
  ...props
}: ComponentProps<"form"> & { noticeClassName?: string; children: ReactNode }) {
  const required = useRequiredFields()

  return (
    <form
      {...props}
      {...required.formProps}
      onSubmit={(event) => {
        required.formProps.onSubmit(event)
        if (!event.defaultPrevented) onSubmit?.(event)
      }}
      onInput={(event) => {
        required.formProps.onInput(event)
        onInput?.(event)
      }}
    >
      {children}
      <FormError error={required.message} className={noticeClassName} />
    </form>
  )
}
