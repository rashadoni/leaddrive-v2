"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import {
  NAV_GROUP_LABEL,
  NAV_ACTIVE_ICON,
  NAV_ACTIVE_BAR,
  RAW_LOCATION_CHANGE_EVENT,
  accessibleNavItems,
  navItemPathname,
  activeNavBase,
  type NavItem,
} from "@/lib/nav-items"
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { Logo } from "@/components/logo"
import { useTranslations } from "next-intl"
import { useTicketBadge } from "@/contexts/ticket-badge-context"

// Hoisted out of their own group and shown directly under /dashboard. Both are
// AI surfaces a director opens first thing, and both lived in Analytics — which
// sits far enough down the sidebar that it needs scrolling AND a group expand.
// The owner's reaction to the voice console living there was simply "и где он".
const SIDEBAR_TOP_PINNED_HREFS = new Set(["/ai/actions", "/ai/voice"])
const SIDEBAR_TOP_PIN_TARGET_HREF = "/dashboard"
const SIDEBAR_TOP_PIN_GROUP = "CRM"

// NavItem type, the `navItems` array, and the GROUP_* colour maps now live in
// `@/lib/nav-items` (imported above) so every navigation surface — sidebar,
// App Launcher, Cmd+K palette, dashboard Quick Access — shares one source of
// truth. Edit that file to add or change a menu entry.

interface SidebarProps {
  org: { plan: string; addons?: string[]; modules?: Record<string, boolean>; role?: string }
  /**
   * False while the client session is still hydrating. The sidebar then
   * renders a skeleton instead of computing the menu from a DEFAULT org
   * context — that default hides module-gated groups (MTM/Finance/Omni),
   * which users repeatedly reported as "все меню пропали".
   */
  sessionLoaded?: boolean
}

export function Sidebar({ org, sessionLoaded = true }: SidebarProps) {
  const pathname = usePathname()
  // Реальный window.location.search: страницы с raw-history URL-контрактом
  // (/social-monitoring) не обновляют canonicalUrl роутера, поэтому
  // useSearchParams для подсветки непригоден — слушаем location напрямую.
  // Пустая строка на SSR → на первом рендере query-пункты просто не активны.
  const [locationSearch, setLocationSearch] = useState("")
  useEffect(() => {
    const sync = () => setLocationSearch(window.location.search)
    sync()
    window.addEventListener("popstate", sync)
    window.addEventListener(RAW_LOCATION_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener("popstate", sync)
      window.removeEventListener(RAW_LOCATION_CHANGE_EVENT, sync)
    }
    // pathname в зависимостях: router-навигации (Link с другой страницы) не
    // диспатчат ни popstate, ни наше событие — ловим их сменой pathname.
  }, [pathname])

  // Навигация по query-пунктам ТОГО ЖЕ роута идёт тем же raw-history
  // контрактом, что и сама страница: pushState + синтетический popstate,
  // который её hydrateFromLocation уже слушает. Router.push здесь непригоден:
  // после внутристраничных raw-pushState его canonicalUrl устаревает, и клик
  // в «тот же» URL молча не делает ничего (URL меняется, экран — нет).
  // Модифицированные клики (новая вкладка/окно) отдаём браузеру.
  const navigateRawHref = (event: ReactMouseEvent, href: string): void => {
    if (!href.includes("?")) return // обычные пункты — стандартный Link/router
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    if (navItemPathname(href) !== pathname) return // другой роут — обычный Link/router
    event.preventDefault()
    window.history.pushState(window.history.state, "", href)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }
  const [collapsed, setCollapsed] = useState(false)
  const [isNarrowViewport, setIsNarrowViewport] = useState(false)
  const t = useTranslations("nav")
  const { newTicketCount } = useTicketBadge()
  const [webChatUnread, setWebChatUnread] = useState(0)
  const [inboxNotifCount, setInboxNotifCount] = useState(0)
  const prevUnread = useRef(0)

  // Sidebar menu search — flat fuzzy match over translated labels so users
  // can find any page without remembering which group it lives in. Cmd/Ctrl+K
  // focuses the input from anywhere; Esc clears + blurs.
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Platform-specific shortcut hint — Mac shows ⌘, everything else Ctrl.
  // Detected once on mount so SSR can render the Ctrl default without a
  // hydration mismatch (server doesn't know the client's platform).
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl+K")
  useEffect(() => {
    if (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)) {
      setShortcutLabel("⌘K")
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia("(max-width: 1023px)")
    const syncViewport = () => setIsNarrowViewport(media.matches)
    syncViewport()
    media.addEventListener("change", syncViewport)
    return () => media.removeEventListener("change", syncViewport)
  }, [])

  useEffect(() => {
    let cancelled = false

    // Lazy-ask Notification permission + register Web Push subscription on
    // first user click. Browsers reject both without a user gesture; once
    // granted, push works even when the browser is fully closed (sw.js).
    if (typeof window !== "undefined" && "Notification" in window) {
      const askAndSubscribe = () => {
        document.removeEventListener("click", askAndSubscribe)
        import("@/lib/push-client")
          .then(m => m.registerPush())
          .catch(() => {
            // Fallback: at least ask for Notification permission
            if (Notification.permission === "default") Notification.requestPermission().catch(() => {})
          })
      }
      if (Notification.permission === "default") {
        document.addEventListener("click", askAndSubscribe, { once: true })
      } else if (Notification.permission === "granted") {
        // Refresh subscription silently on mount (idempotent upsert)
        import("@/lib/push-client").then(m => m.registerPush()).catch(() => {})
      }
    }

    const notify = (delta: number) => {
      if (typeof window === "undefined" || !("Notification" in window)) return
      if (Notification.permission !== "granted") return
      // Only fire when the CRM is not actively focused.
      if (document.visibilityState === "visible" && document.hasFocus()) return
      try {
        const n = new Notification("New web chat message", {
          body: delta === 1 ? "A visitor is waiting" : `${delta} new messages from visitors`,
          icon: "/favicon.ico",
          tag: "ld-webchat-global",
        })
        n.onclick = () => {
          try { window.focus() } catch {}
          window.location.href = "/inbox/web-chat"
          n.close()
        }
      } catch {}
    }

    const tick = async () => {
      try {
        const since = typeof window !== "undefined" ? localStorage.getItem("webChatLastReadAt") : null
        const url = since
          ? `/api/v1/web-chat/sessions/unread-count?since=${encodeURIComponent(since)}`
          : "/api/v1/web-chat/sessions/unread-count"
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.success) {
          const next = data.data.count as number
          if (next > prevUnread.current && prevUnread.current > 0) {
            notify(next - prevUnread.current)
          }
          prevUnread.current = next
          setWebChatUnread(next)
        }
      } catch {}
    }
    tick()
    const id = setInterval(tick, 30000)

    // Inbox notification badge — unread inbox_message notifications for this user (the assignee + the
    // collaborators fan-out). 20s poll so the menu badge tracks the bell without much extra load.
    const pollInboxNotif = async () => {
      try {
        const res = await fetch("/api/v1/notifications?entityType=inbox_message")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.success) setInboxNotifCount(data.data.unreadCount || 0)
      } catch {}
    }
    pollInboxNotif()
    const inboxId = setInterval(pollInboxNotif, 20000)
    // Immediate refresh when the inbox marks its notifications read (don't wait up to 20s for the poll).
    const onInboxRead = () => pollInboxNotif()
    window.addEventListener("inbox-notifs-read", onInboxRead)

    return () => { cancelled = true; clearInterval(id); clearInterval(inboxId); window.removeEventListener("inbox-notifs-read", onInboxRead) }
  }, [])

  // Filter sidebar items by org modules/features/plan. The gate logic lives in
  // `accessibleNavItems` (@/lib/nav-items) so the sidebar, App Launcher, Cmd+K
  // palette, and dashboard Quick Access strip all gate identically: superadmin
  // sees every item; everyone else is subject to `hasModule` + feature flags.
  //
  // Memoized — prevents re-filtering ~113 items on every badge-polling re-render (30s/60s)
  const accessibleItems = useMemo(
    () => accessibleNavItems(org),
    [org]
  )
  const groups = useMemo(
    () => [...new Set(accessibleItems.map((item) => item.group))],
    [accessibleItems]
  )

  // Какой ОДИН пункт выбран текущим URL — правило целиком в nav-items.ts
  // (`activeNavBase`), чтобы подсветка и открытая группа не разъезжались и
  // чтобы его можно было покрыть юнит-тестом без рендера сайдбара.
  const activeBase = useMemo(
    () => activeNavBase(accessibleItems, pathname),
    [accessibleItems, pathname]
  )

  // Пункты query-параметризованных разделов (виды /social-monitoring) активны,
  // когда совпал pathname И каждый параметр из href присутствует в текущем URL.
  // Несколько таких пунктов делят один pathname — у всех base === activeBase,
  // и различает их именно проверка query ниже.
  const isItemActive = (item: NavItem): boolean => {
    const base = navItemPathname(item.href)
    if (!base || base !== activeBase) return false
    const queryIndex = item.href.indexOf("?")
    if (queryIndex === -1) return true
    const current = new URLSearchParams(locationSearch)
    for (const [key, value] of new URLSearchParams(item.href.slice(queryIndex + 1)).entries()) {
      if (current.get(key) !== value) return false
    }
    return true
  }
  const sidebarItemsByGroup = useMemo(() => {
    const pinnedTopItems = accessibleItems.filter((item) => SIDEBAR_TOP_PINNED_HREFS.has(item.href))
    const pinnedTopHrefs = new Set(pinnedTopItems.map((item) => item.href))

    return new Map(groups.map((group) => {
      const groupItems = accessibleItems.filter((item) => item.group === group && !pinnedTopHrefs.has(item.href))
      if (group !== SIDEBAR_TOP_PIN_GROUP || pinnedTopItems.length === 0) return [group, groupItems] as const

      return [
        group,
        groupItems.flatMap((item) => (
          item.href === SIDEBAR_TOP_PIN_TARGET_HREF ? [item, ...pinnedTopItems] : [item]
        )),
      ] as const
    }))
  }, [accessibleItems, groups])

  // Search results — flat list of items whose translated label OR group name
  // includes the query (case-insensitive). Returns null when query is empty
  // so the rendering branch can fall back to the normal grouped accordion.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    return accessibleItems.filter((item) => {
      const label = t(item.tKey).toLowerCase()
      const groupLabel = t(`groups.${item.group}`).toLowerCase()
      return label.includes(q) || groupLabel.includes(q)
    })
  }, [searchQuery, accessibleItems, t])

  // Global Cmd/Ctrl+K shortcut to focus the menu search from anywhere.
  // Skip when collapsed (input isn't rendered) or when the user is typing
  // in another input/textarea/contenteditable (don't steal focus mid-edit).
  //
  // Uses CAPTURE phase so rich-text editors (Slate/TipTap/CodeMirror) that
  // already stopPropagation on Cmd+K in their own handlers still let us
  // through. Without capture, those editors would swallow the hotkey.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (collapsed) return
      const cmd = e.metaKey || e.ctrlKey
      if (!cmd || e.key !== "k") return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        // Allow if we're already in OUR own search input — re-focus is harmless
        if (target !== searchInputRef.current) return
      }
      e.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    document.addEventListener("keydown", handler, true)
    return () => document.removeEventListener("keydown", handler, true)
  }, [collapsed])

  // ── Accordion state ──────────────────────────────────────────────────────
  // Compute which group the current route belongs to
  const activeGroup = useMemo(
    () => {
      // Группа выбирается по pathname-части href (без query): любой URL
      // /social-monitoring?... держит группу «Sosial monitorinq» открытой,
      // даже когда ни один конкретный пункт (query-набор) не совпал — все они
      // делят один base, поэтому base-совпадения здесь достаточно.
      // Тот же activeBase, что и у подсветки: иначе открытая группа и
      // выделенный пункт могли разъехаться на вложенных URL.
      if (!activeBase) return ""
      const activeItem = accessibleItems.find((item) => navItemPathname(item.href) === activeBase)
      if (!activeItem) return ""
      return SIDEBAR_TOP_PINNED_HREFS.has(activeItem.href) ? SIDEBAR_TOP_PIN_GROUP : activeItem.group
    },
    [accessibleItems, activeBase]
  )

  // openGroups: accordion state. By default ONLY the active section's group is
  // open; the rest are collapsed. Manual toggles may open extra groups, but any
  // route change collapses back to just the active group (see effect below).
  // Intentionally NOT persisted to localStorage — the open set is derived from
  // the current route, so a reload always lands on "active group open, rest
  // collapsed" instead of restoring a pile of previously-opened groups.
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeGroup ? [activeGroup] : [])
  )

  // When the route changes: collapse the accordion back to ONLY the active
  // section's group, closing any groups the user manually opened. This is what
  // gives "switch to Marketing → only Marketing open, everything else collapsed".
  // The size===1 guard skips a redundant state update when already active-only.
  // rAF fires before React commits the new openGroups state, but the active item
  // is always rendered (only clipped by overflow) so scrollIntoView works
  // regardless of accordion animation state.
  useEffect(() => {
    setOpenGroups((prev) => {
      // Route with no matching nav group → collapse everything (still honours
      // "navigation collapses to the active group only"; here there's none).
      if (!activeGroup) return prev.size === 0 ? prev : new Set()
      // Otherwise keep only the active group open. size===1 guard skips a
      // redundant update when already active-only.
      return prev.size === 1 && prev.has(activeGroup) ? prev : new Set([activeGroup])
    })
    if (!activeGroup) return
    requestAnimationFrame(() => {
      document.querySelector("[data-nav-active='true']")?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  }, [pathname, activeGroup])

  const toggleGroup = (group: string) => {
    // Manual open/close. Allowed to open extra groups on top of the active one;
    // the route-change effect collapses back to active-only on the next navigation.
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }
  const effectiveCollapsed = collapsed || isNarrowViewport
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar-bg backdrop-blur-xl transition-[width,padding] duration-200",
        effectiveCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo header */}
      <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
        <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo collapsed={effectiveCollapsed} size="sm" sidebar />
        </Link>
        {!isNarrowViewport && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        )}
      </div>

      {/* Menu search — hidden when sidebar is collapsed (no room for input) */}
      {!effectiveCollapsed && (
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("")
                  searchInputRef.current?.blur()
                }
              }}
              placeholder={t("searchPlaceholder", { shortcut: shortcutLabel })}
              aria-label={t("searchPlaceholder", { shortcut: shortcutLabel })}
              className="w-full h-8 pl-8 pr-7 rounded-md bg-white/[0.06] border border-white/[0.08] text-xs text-white/90 placeholder:text-white/35 focus:outline-none focus:border-white/20 focus:bg-white/[0.09] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("")
                  searchInputRef.current?.focus()
                }}
                aria-label={t("searchClear")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Navigation — search mode shows flat results; otherwise the normal
          grouped accordion. Both modes share the same item-row markup. */}
      <nav className="flex-1 overflow-y-auto p-2 sidebar-scroll">
        {!sessionLoaded ? (
          <div className="space-y-2 px-1 pt-1" aria-busy="true">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-8 rounded-lg bg-white/[0.06] animate-pulse" />
            ))}
          </div>
        ) : searchResults !== null ? (
          searchResults.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-white/40">
              {t("searchNoResults")}
            </div>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((item) => {
                const isActive = isItemActive(item)
                const Icon = item.icon
                const iconColor = NAV_ACTIVE_ICON
                const activeBar = NAV_ACTIVE_BAR
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    data-nav-active={isActive ? "true" : undefined}
                    onClick={(event) => {
                      setSearchQuery("")
                      navigateRawHref(event, item.href)
                    }}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-150",
                      isActive
                        ? cn(
                            "font-medium text-white bg-white/[0.12] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r",
                            activeBar,
                          )
                        : "text-white/60 hover:bg-white/[0.06] hover:text-white/90",
                    )}
                  >
                    <div className={cn(
                      "relative flex h-6 w-6 items-center justify-center rounded-md shrink-0 transition-all",
                      isActive ? iconColor : "text-white/40",
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                      {/* Badge parity with accordion view — searching for
                          "tickets" must still surface unread counts. */}
                      {item.href === "/tickets" && newTicketCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold px-1">
                          {newTicketCount > 99 ? "99+" : newTicketCount}
                        </span>
                      )}
                      {item.href === "/inbox/web-chat" && webChatUnread > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-primary text-white text-[10px] flex items-center justify-center font-bold px-1">
                          {webChatUnread > 99 ? "99+" : webChatUnread}
                        </span>
                      )}
                      {item.href === "/inbox" && inboxNotifCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold px-1">
                          {inboxNotifCount > 99 ? "99+" : inboxNotifCount}
                        </span>
                      )}
                    </div>
                    <span className="flex-1 truncate">{t(item.tKey)}</span>
                    <span className={cn(
                      "text-[10px] uppercase tracking-wider opacity-50 shrink-0",
                      NAV_GROUP_LABEL,
                    )}>
                      {t(`groups.${item.group}`)}
                    </span>
                  </Link>
                )
              })}
            </div>
          )
        ) : (
        groups.map((group, groupIndex) => {
          const isOpen = effectiveCollapsed || openGroups.has(group)
          return (
            <div
              key={group}
              className={cn(
                groupIndex > 0 && "border-t border-white/[0.06] pt-3 mt-3"
              )}
            >
              {/* Group header — clickable toggle in expanded mode */}
              {!effectiveCollapsed ? (
                <button
                  type="button"
                  aria-expanded={openGroups.has(group)}
                  onClick={() => toggleGroup(group)}
                  className={cn(
                    "w-full flex items-center justify-between mb-1.5 px-3 py-1 rounded-md",
                    "text-[11px] font-semibold uppercase tracking-wider select-none",
                    "hover:bg-white/[0.05] transition-colors",
                    NAV_GROUP_LABEL
                  )}
                >
                  <span>{t(`groups.${group}`)}</span>
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 opacity-60 transition-transform duration-200",
                      openGroups.has(group) && "rotate-90"
                    )}
                  />
                </button>
              ) : (
                groupIndex > 0 && <hr className="border-white/[0.06] mx-3 my-1" />
              )}

              {/* Items — smooth CSS grid height animation */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-200 ease-in-out",
                  isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                )}
              >
                <div className="overflow-hidden">
                  {(sidebarItemsByGroup.get(group) ?? [])
                    .map((item) => {
                      const isActive = isItemActive(item)
                      const Icon = item.icon
                      const iconColor = NAV_ACTIVE_ICON
                      const activeBar = NAV_ACTIVE_BAR
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          prefetch={false}
                          data-nav-active={isActive ? "true" : undefined}
                          onClick={(event) => navigateRawHref(event, item.href)}
                          className={cn(
                            "relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-150",
                            isActive
                              ? cn("font-medium text-white bg-white/[0.12] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r", activeBar)
                              : "text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                          )}
                          title={effectiveCollapsed ? t(item.tKey) : undefined}
                        >
                          <div className={cn(
                            "relative flex h-6 w-6 items-center justify-center rounded-md shrink-0 transition-all",
                            isActive ? iconColor : "text-white/40"
                          )}>
                            <Icon className="h-3.5 w-3.5" />
                            {item.href === "/tickets" && newTicketCount > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold px-1">
                                {newTicketCount > 99 ? "99+" : newTicketCount}
                              </span>
                            )}
                            {item.href === "/inbox/web-chat" && webChatUnread > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-primary text-white text-[10px] flex items-center justify-center font-bold px-1">
                                {webChatUnread > 99 ? "99+" : webChatUnread}
                              </span>
                            )}
                            {item.href === "/inbox" && inboxNotifCount > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold px-1">
                                {inboxNotifCount > 99 ? "99+" : inboxNotifCount}
                              </span>
                            )}
                          </div>
                          {!effectiveCollapsed && <span>{t(item.tKey)}</span>}
                        </Link>
                      )
                    })}
                </div>
              </div>
            </div>
          )
        })
        )}
      </nav>
    </aside>
  )
}
