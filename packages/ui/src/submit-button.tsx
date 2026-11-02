"use client"

import type { ComponentProps, ReactNode } from "react"
import { useFormStatus } from "react-dom"

import { Button } from "./button"

/**
 * A form's submit button, which says so while the action runs. It is
 * disabled then and at no other time: a button greyed out for a field
 * nobody has filled in yet says no and never says why. The press is what
 * answers; pair it with RequiredFieldsForm (or useRequiredFields) and the
 * form names what it is still missing.
 */
function SubmitButton({
  children,
  pendingText,
  ...props
}: Omit<ComponentProps<typeof Button>, "type" | "disabled" | "children"> & {
  children: ReactNode
  /** Shown in place of the label while the action runs ("Saving…"). */
  pendingText?: ReactNode
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && pendingText ? pendingText : children}
    </Button>
  )
}

export { SubmitButton }
