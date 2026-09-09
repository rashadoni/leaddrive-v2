"use client"

/**
 * App Launcher — a full "all apps" grid overlay, openable from anywhere via the
 * header waffle icon or Cmd/Ctrl+Shift+K. Built on Radix Dialog for focus-trap,
 * Esc handling, and a11y. Reads the shared nav source (`@/lib/nav-items`), gates
 * by `accessibleNavItems`, and personalizes the top of the grid with the user's
 * favorites + recently-used modules (via the launcher-prefs context).
 *
 * Each tile shows a colour-coded icon chip + title + one-line description (the
 * "hint" of what the section does). Theme-agnostic: semantic tokens + tint
 * chips adopt the glassmorphism treatment automatically under a video wallpaper.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog"
import {
  useEffect, useMemo, useRef, useState,
  type ReactNode, type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Search, Star, X, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  accessibleNavItems, NAV_GROUP_ORDER, groupLauncherStyle,
  type NavItem, type OrgNavContext,
} from "@/lib/nav-items"
import { useLauncherPrefs } from "@/contexts/launcher-prefs-context"

/** Window event other components dispatch to open the launcher without prop-drilling. */
export const OPEN_LAUNCHER_EVENT = "ld:open-launcher"

/** Open the App Launcher from anywhere (e.g. the dashboard Quick Access strip). */
export function openAppLauncher() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_LAUNCHER_EVENT))
}

interface AppLauncherProps {
  org: OrgNavContext
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppLauncher({ org, open, onOpenChange }: AppLauncherProps) {
  const t = useTranslations("nav")
  const tDesc = useTranslations("navDesc")
  const router = useRouter()
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const { favorites, recents, isFavorite, toggleFavorite, recordVisit } = useLauncherPrefs()

  const openRef = useRef(open)
  openRef.current = open

  // Global shortcut: Cmd/Ctrl+Shift+K toggles the launcher. Cmd+K is taken
  // (command palette + sidebar search), so the launcher uses +Shift. Listener
  // stays mounted while closed so the chord can OPEN it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        onOpenChange(!openRef.current)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onOpenChange])

  // Open on demand from other components (e.g. dashboard "All apps" tile).
  useEffect(() => {
    const openIt = () => onOpenChange(true)
    window.addEventListener(OPEN_LAUNCHER_EVENT, openIt)
    return () => window.removeEventListener(OPEN_LAUNCHER_EVENT, openIt)
  }, [onOpenChange])

  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const items = useMemo(() => accessibleNavItems(org), [org])
  const byHref = useMemo(() => {
    const m = new Map<string, NavItem>()
    for (const it of items) m.set(it.href, it)
    return m
  }, [items])

  const desc = (it: NavItem) => (tDesc.has(it.tKey) ? tDesc(it.tKey) : undefined)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return null
    return items.filter(
      (it) =>
        t(it.tKey).toLowerCase().includes(q) ||
        t(`groups.${it.group}`).toLowerCase().includes(q) ||
        (tDesc.has(it.tKey) && tDesc(it.tKey).toLowerCase().includes(q))
    )
  }, [q, items, t, tDesc])

  const favItems = favorites
    .map((h) => byHref.get(h))
    .filter((it): it is NavItem => !!it)
  const recentItems = recents
    .map((h) => byHref.get(h))
    .filter((it): it is NavItem => !!it && !favorites.includes(it.href))
    .slice(0, 6)

  function go(href: string) {
    recordVisit(href)
    onOpenChange(false)
    setQuery("")
    router.push(href)
  }

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && filtered && filtered.length > 0) {
      e.preventDefault()
      go(filtered[0].href)
    }
  }

  const tile = (it: NavItem) => (
    <AppTile
      key={it.href}
      item={it}
      label={t(it.tKey)}
      desc={desc(it)}
      pinned={isFavorite(it.href)}
      pinLabel={isFavorite(it.href) ? t("unpinApp") : t("pinApp")}
      onGo={go}
      onPin={toggleFavorite}
    />
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="fixed left-1/2 top-1/2 z-[71] flex max-h-[86vh] w-[min(1040px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">{t("allApps")}</DialogPrimitive.Title>

          {/* Search header */}
          <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-5">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={t("searchApps")}
              className="flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <X className="h-[18px] w-[18px]" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {filtered ? (
              filtered.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">{t("searchNoResults")}</p>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                  {filtered.map(tile)}
                </div>
              )
            ) : (
              <div className="space-y-7">
                {favItems.length > 0 && (
                  <Section label={t("favorites")} dot="bg-amber-500" headerIcon={<Star className="h-3.5 w-3.5 text-amber-500" />}>
                    {favItems.map(tile)}
                  </Section>
                )}
                {recentItems.length > 0 && (
                  <Section label={t("recentlyUsed")} dot="bg-muted-foreground" headerIcon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}>
                    {recentItems.map(tile)}
                  </Section>
                )}
                {NAV_GROUP_ORDER.map((group) => {
                  const groupItems = items.filter((it) => it.group === group)
                  if (groupItems.length === 0) return null
                  return (
                    <Section key={group} label={t(`groups.${group}`)} dot={groupLauncherStyle(group).dot}>
                      {groupItems.map(tile)}
                    </Section>
                  )
                })}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Section({
  label, dot, headerIcon, children,
}: {
  label: string
  dot?: string
  headerIcon?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 px-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {headerIcon ?? (dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />)}
        {label}
      </h3>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  )
}

function AppTile({
  item, label, desc, pinned, pinLabel, onGo, onPin,
}: {
  item: NavItem
  label: string
  desc?: string
  pinned: boolean
  pinLabel: string
  onGo: (href: string) => void
  onPin: (href: string) => void
}) {
  const Icon = item.icon
  const style = groupLauncherStyle(item.group)
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onGo(item.href)}
        className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/50 p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-border hover:bg-accent/40 hover:shadow-lg hover:shadow-black/5"
      >
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", style.chip)}>
          <Icon className={cn("h-[22px] w-[22px]", style.icon)} />
        </span>
        <span className="min-w-0 flex-1 pr-5">
          <span className="block truncate text-sm font-semibold text-foreground" title={label}>{label}</span>
          {desc && <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted-foreground" title={desc}>{desc}</span>}
        </span>
      </button>
      {/* Sibling (not nested) button — nested <button> is invalid HTML. */}
      <button
        type="button"
        aria-label={pinLabel}
        title={pinLabel}
        onClick={() => onPin(item.href)}
        className={cn(
          "absolute right-2 top-2 rounded-md p-1 transition-opacity",
          pinned
            ? "text-amber-400 opacity-100"
            : "text-muted-foreground opacity-0 hover:text-amber-400 focus-visible:opacity-100 group-hover:opacity-100"
        )}
      >
        <Star className={cn("h-3.5 w-3.5", pinned && "fill-amber-400")} />
      </button>
    </div>
  )
}
