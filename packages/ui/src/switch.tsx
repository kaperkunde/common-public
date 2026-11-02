import type { ComponentProps, ReactNode } from "react"

import { cn } from "./cn"

/**
 * An on/off control: a native checkbox with the switch role, so it submits
 * with a form like any checkbox (`name`, `defaultChecked`) and a label's
 * text is its accessible name.
 */
function Switch({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      role="switch"
      data-slot="switch"
      className={cn(
        "relative m-0 h-[26px] w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-switch transition-colors focus-ring checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        "before:absolute before:top-[3px] before:left-[3px] before:size-5 before:rounded-full before:bg-switch-thumb before:shadow-sm before:transition-[left] before:content-[''] checked:before:left-[21px]",
        className,
      )}
      {...props}
    />
  )
}

/**
 * A row in a List that turns one thing on or off: the label, a grey line
 * under it, the switch at the right. The label names the switch.
 */
function SwitchRow({
  id,
  label,
  description,
  className,
  trailing,
  ...props
}: Omit<ComponentProps<"input">, "id"> & {
  id: string
  label: ReactNode
  description?: ReactNode
  /** Anything between the text and the switch (a link to more). */
  trailing?: ReactNode
}) {
  return (
    <div
      data-slot="list-row"
      className={cn(
        "flex min-h-14 items-center gap-3.5 px-4 py-2.5 text-sm",
        className,
      )}
    >
      <label
        htmlFor={id}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
      >
        <span className="text-[15px] leading-snug text-foreground">
          {label}
        </span>
        {description ? (
          <span className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </label>
      {trailing}
      <Switch id={id} {...props} />
    </div>
  )
}

export { Switch, SwitchRow }
