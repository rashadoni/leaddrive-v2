"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { ChevronDown, Grid2X2 } from "lucide-react"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  isMtmNavigationItemActive,
  MTM_PRIMARY_NAVIGATION,
  MTM_TOOL_GROUPS,
} from "@/lib/mtm/navigation"

export function MtmModuleNavigation() {
  const pathname = usePathname()
  const t = useTranslations("mtmModuleNavigation")
  const tNav = useTranslations("nav")
  const activeTool = MTM_TOOL_GROUPS.flatMap((group) => group.items)
    .find((item) => isMtmNavigationItemActive(item.href, pathname))

  return (
    <div className="mb-6 border-b border-zinc-200/80 pb-3 dark:border-zinc-700/80">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <nav
          aria-label={t("primaryNavigationLabel")}
          className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-1 sm:flex-1 sm:pb-0"
        >
          {MTM_PRIMARY_NAVIGATION.map((item) => {
            const active = isMtmNavigationItemActive(item.href, pathname)
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium outline-none transition-[background-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 active:scale-[0.98]",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{t(item.labelKey)}</span>
              </Link>
            )
          })}
        </nav>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold outline-none transition-[background-color,border-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto",
                activeTool
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-zinc-200 bg-card text-foreground hover:bg-muted/60 dark:border-zinc-700",
              )}
            >
              <Grid2X2 className="h-4 w-4" aria-hidden="true" />
              <span>{t("allTools")}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            sideOffset={8}
            className="max-h-[min(72vh,40rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto p-0"
          >
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <p className="text-sm font-semibold text-foreground">{t("allTools")}</p>
              <p className="mt-1 max-w-[65ch] text-xs leading-5 text-muted-foreground">
                {t("allToolsHint")}
              </p>
            </div>

            <div className="grid gap-x-6 gap-y-5 p-4 sm:grid-cols-2">
              {MTM_TOOL_GROUPS.map((group) => (
                <section key={group.key} aria-labelledby={`mtm-tool-group-${group.key}`}>
                  <h2
                    id={`mtm-tool-group-${group.key}`}
                    className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {t(`groups.${group.key}`)}
                  </h2>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const active = isMtmNavigationItemActive(item.href, pathname)
                      const Icon = item.icon

                      return (
                        <PopoverClose key={item.href} asChild>
                          <Link
                            href={item.href}
                            prefetch={false}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/35",
                              active
                                ? "bg-primary/10 text-primary"
                                : "text-foreground hover:bg-muted/70",
                            )}
                          >
                            <Icon
                              className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
                              aria-hidden="true"
                            />
                            <span>{tNav(item.navKey)}</span>
                          </Link>
                        </PopoverClose>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
