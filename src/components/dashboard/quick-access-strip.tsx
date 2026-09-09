"use client"

/**
 * Dashboard Quick Access — a compact, personalized strip of the user's favorite
 * + recently-used modules, plus an "All apps" entry that opens the App Launcher.
 * Purely additive: it sits above the KPI row and never replaces any dashboard
 * widget. Empty for brand-new users → shows just the "All apps" hint.
 */
import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { LayoutGrid } from "lucide-react"
import { cn } from "@/lib/utils"
import { accessibleNavItems, orgFromSession, groupLauncherStyle, type NavItem } from "@/lib/nav-items"
import { useLauncherPrefs } from "@/contexts/launcher-prefs-context"
import { openAppLauncher } from "@/components/app-launcher"

const PINNED_QUICK_ACCESS_HREFS = ["/dashboard", "/ai-command-center"] as const

export function QuickAccessStrip() {
  const t = useTranslations("nav")
  const router = useRouter()
  const { data: session } = useSession()
  const { favorites, recents, recordVisit } = useLauncherPrefs()

  const org = useMemo(() => orgFromSession(session?.user), [session])

  // Resolve hrefs against accessible items only — a favorite/recent for a module
  // the user can't see simply drops out.
  const byHref = useMemo(() => {
    const m = new Map<string, NavItem>()
    for (const it of accessibleNavItems(org)) m.set(it.href, it)
    return m
  }, [org])

  const pinnedItems = PINNED_QUICK_ACCESS_HREFS
    .map((href) => byHref.get(href))
    .filter((it): it is NavItem => !!it)
  const pinnedSet = new Set(pinnedItems.map((i) => i.href))
  const favItems = favorites
    .map((h) => byHref.get(h))
    .filter((it): it is NavItem => !!it && !pinnedSet.has(it.href))
  const favSet = new Set([...pinnedSet, ...favItems.map((i) => i.href)])
  const recentItems = recents
    .map((h) => byHref.get(h))
    .filter((it): it is NavItem => !!it && !favSet.has(it.href))
  const items = [...pinnedItems, ...favItems, ...recentItems].slice(0, 8)

  function go(href: string) {
    recordVisit(href)
    router.push(href)
  }

  return (
    <div className="dashboard-bento-app-strip flex items-center gap-2 overflow-x-auto pb-1">
      {items.map((it) => {
        const Icon = it.icon
        const style = groupLauncherStyle(it.group)
        return (
          <button
            key={it.href}
            onClick={() => go(it.href)}
            className="dashboard-bento-app-chip flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-card/60 py-1 pl-1 pr-3.5 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-accent"
          >
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", style.chip)}>
              <Icon className={cn("h-3.5 w-3.5", style.icon)} />
            </span>
            {it.href === "/ai-command-center" ? t("aiAdvisor") : t(it.tKey)}
          </button>
        )
      })}
      <button
        onClick={openAppLauncher}
        className="dashboard-bento-app-chip flex shrink-0 items-center gap-2 rounded-full border border-dashed border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        {items.length === 0 ? t("quickAccessEmpty") : t("allApps")}
      </button>
    </div>
  )
}
