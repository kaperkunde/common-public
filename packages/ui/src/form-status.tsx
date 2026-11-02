import type { ReactNode } from "react"

import { cn } from "./cn"

type Variant = "inline" | "banner"

const errorClassName: Record<Variant, string> = {
  inline: "text-sm text-destructive",
  banner: "rounded-lg bg-destructive/10 p-3 text-sm text-destructive",
}

const noteClassName: Record<Variant, string> = {
  inline: "text-sm text-muted-foreground",
  banner: "rounded-lg bg-accent p-3 text-sm text-accent-foreground",
}

/**
 * The error under a form or an action, read out as it appears
 * (role="alert"). Nothing is drawn when there is no error.
 *
 * With `support`, an error the reader could do nothing about (the
 * unexpected kind, where trying again may not help) also says how to reach a
 * person: `offerSupport` decides which errors those are, every one by
 * default.
 */
function FormError({
  error,
  variant = "inline",
  support,
  offerSupport = true,
  className,
}: {
  error: ReactNode | null | undefined
  variant?: Variant
  /** Where to reach a person, usually a mailto: link. */
  support?: { href: string; label?: ReactNode }
  /** Whether this error gets the support line. */
  offerSupport?: boolean | ((error: ReactNode) => boolean)
  className?: string
}) {
  if (!error) {
    return null
  }

  const withSupport =
    support !== undefined &&
    (typeof offerSupport === "function" ? offerSupport(error) : offerSupport)

  return (
    <p
      data-slot="form-error"
      role="alert"
      className={cn(errorClassName[variant], className)}
    >
      {error}
      {withSupport ? (
        <>
          {" "}
          If it keeps happening,{" "}
          <a href={support.href} className="underline underline-offset-4">
            {support.label ?? "email support"}
          </a>
          .
        </>
      ) : null}
    </p>
  )
}

/** The note that something worked, read out politely (role="status"). */
function FormNote({
  message,
  variant = "inline",
  className,
}: {
  message: ReactNode | null | undefined
  variant?: Variant
  className?: string
}) {
  if (!message) {
    return null
  }

  return (
    <p
      data-slot="form-note"
      role="status"
      className={cn(noteClassName[variant], className)}
    >
      {message}
    </p>
  )
}

/** A form's outcome in one place: the error if there is one, else the note. */
function FormStatus({
  error,
  message,
  variant = "inline",
  className,
}: {
  error?: ReactNode | null
  message?: ReactNode | null
  variant?: Variant
  className?: string
}) {
  return error ? (
    <FormError error={error} variant={variant} className={className} />
  ) : (
    <FormNote message={message} variant={variant} className={className} />
  )
}

export { FormError, FormNote, FormStatus }
