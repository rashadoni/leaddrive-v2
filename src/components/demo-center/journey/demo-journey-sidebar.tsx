"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { ChevronRight, Lock } from "lucide-react"
import { Logo } from "@/components/logo"
import { NAV_ACTIVE_BAR, NAV_ACTIVE_ICON, NAV_GROUP_LABEL, NAV_GROUP_ORDER, navItems, type NavItem } from "@/lib/nav-items"
import { cn } from "@/lib/utils"
import { DEMO_JOURNEY_STRINGS as S } from "./strings"

/**
 * The product sidebar, reduced to the scenario's visible routes.
 *
 * Same item list, icons, group order, labels and row styling as
 * `src/components/sidebar.tsx`, so the prospect sees LeadDrive's own
 * navigation — only fewer entries. Rows are buttons that move the demo view,
 * never links into the tenant application. A route the story has not
 * reached yet shows a lock and, when clicked, says that the guide will lead
 * there — a silently greyed-out row read as broken (owner, 2026-09-22).
 */
export interface DemoJourneySidebarProps {
  visibleRoutes: readonly string[]
  reachableRoutes: readonly string[]
  activeRoute: string | null
  onNavigate: (route: string) => void
  onLocked: (label: string) => void
}

export function DemoJourneySidebar({ visibleRoutes, reachableRoutes, activeRoute, onNavigate, onLocked }: DemoJourneySidebarProps) {
  const t = useTranslations("nav")

  const groups = useMemo(() => {
    const visible = new Set(visibleRoutes)
    const byGroup = new Map<string, NavItem[]>()
    for (const item of navItems) {
      if (!visible.has(item.href)) continue
      const list = byGroup.get(item.group) ?? []
      list.push(item)
      byGroup.set(item.group, list)
    }
    return NAV_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({ group, items: byGroup.get(group)! }))
  }, [visibleRoutes])

  const reachable = new Set(reachableRoutes)

  return (
    <aside
      data-testid="demo-sidebar"
      aria-label={S.sidebarAria}
      className="flex w-16 shrink-0 flex-col overflow-x-clip bg-sidebar-bg backdrop-blur-xl 2xl:w-64"
    >
      <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
        <span className="flex items-center gap-2">
          {/* The mark alone while the sidebar is icons, the full name from 2xl. */}
          <span className="2xl:hidden"><Logo size="sm" sidebar collapsed /></span>
          <span className="hidden 2xl:inline"><Logo size="sm" sidebar /></span>
        </span>
      </div>
      {/* The demo scrolls as one page, so a full-height rail left its entries
          at the top of the page: on a phone the first step's arrow pointed at
          the empty middle of the dark strip. The entries stay in view instead,
          and the guide points at them rather than at the strip. */}
      <nav data-tour-id="demo-sidebar" className="sidebar-scroll sticky top-0 max-h-dvh overflow-y-auto p-2">
        {groups.map(({ group, items }, groupIndex) => (
          <div key={group} className={cn(groupIndex > 0 && "mt-3 border-t border-white/[0.06] pt-3")}>
            <div
              data-group={group}
              className={cn(
                "mb-1.5 hidden w-full items-center justify-between rounded-md px-3 py-1 2xl:flex",
                "select-none text-[11px] font-semibold uppercase tracking-wider",
                NAV_GROUP_LABEL,
              )}
            >
              <span>{t(`groups.${group}`)}</span>
              <ChevronRight className="h-3 w-3 shrink-0 rotate-90 opacity-60" />
            </div>
            {groupIndex > 0 && <hr className="mx-3 my-1 border-white/[0.06] 2xl:hidden" />}
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon
                const isActive = activeRoute === item.href
                const enabled = reachable.has(item.href)
                const label = t(item.tKey)
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => (enabled ? onNavigate(item.href) : onLocked(label))}
                    aria-disabled={enabled ? undefined : true}
                    data-nav-locked={enabled ? undefined : "true"}
                    aria-current={isActive ? "page" : undefined}
                    data-nav-href={item.href}
                    data-nav-active={isActive ? "true" : undefined}
                    title={enabled ? label : `${label} — ${S.notReachable}`}
                    className={cn(
                      "relative flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm transition-all duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none",
                      isActive
                        ? cn(
                            "bg-white/[0.12] font-medium text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r",
                            NAV_ACTIVE_BAR,
                          )
                        : enabled
                          ? "text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                          : "text-white/35 hover:bg-white/[0.04] hover:text-white/50",
                    )}
                  >
                    <span
                      className={cn(
                        "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all",
                        isActive ? NAV_ACTIVE_ICON : enabled ? "text-white/40" : "text-white/25",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="hidden flex-1 truncate 2xl:inline">{label}</span>
                    {!enabled ? (
                      <Lock
                        aria-hidden="true"
                        className="absolute right-1 top-1 h-2.5 w-2.5 text-white/40 2xl:static 2xl:h-3 2xl:w-3 2xl:shrink-0"
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
