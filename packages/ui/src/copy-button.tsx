"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button, type ButtonVariants } from "./button"
import { cn } from "./cn"
import { CheckIcon, CopyIcon } from "./icons"

/**
 * Copies a fixed value (a URL, a command, a token) and says so for two
 * seconds. When the clipboard is blocked (plain http, permissions) nothing
 * happens: the value is on screen to select by hand.
 */
function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "secondary",
  size = "sm",
  className,
}: {
  value: string
  label?: ReactNode
  copiedLabel?: ReactNode
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={copy}
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  )
}

/** A value on its own line with a copy button, for tokens and addresses. */
function CopyableValue({
  value,
  label,
  variant,
  className,
  testId,
}: {
  value: string
  label?: ReactNode
  variant?: ButtonVariants["variant"]
  className?: string
  testId?: string
}) {
  return (
    <div
      data-slot="copyable-value"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg bg-field py-1.5 pr-1.5 pl-3",
        className,
      )}
    >
      <code
        className="min-w-0 flex-1 text-[13px] break-all text-foreground"
        data-testid={testId}
      >
        {value}
      </code>
      <CopyButton value={value} label={label} variant={variant} />
    </div>
  )
}

export { CopyButton, CopyableValue }
