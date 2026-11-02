/** The classes Tabs and NavTabs share, so a link tab looks like a tab. */
export const tabsListClassName =
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-control-md group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col"

export const tabsTriggerClassName =
  "relative inline-flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors focus-ring hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start data-active:bg-background data-active:text-foreground data-active:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
