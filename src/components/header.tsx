"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Sun, Moon, Search, LogOut, Command, LayoutGrid, User } from "lucide-react"
import { signOut } from "next-auth/react"
import { signOutCallbackUrl } from "@/lib/tenant-domain"
import { NotificationBell } from "@/components/notification-bell"
import { LanguageSwitcher } from "@/components/language-switcher"
import { WallpaperSelector } from "@/components/wallpaper-selector"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverClose,
} from "@/components/ui/popover"

interface HeaderProps {
  orgName?: string
  userName?: string
  /** Optional avatar URL. When absent the header fetches it from /users/me. */
  userAvatar?: string | null
  onOpenLauncher?: () => void
  /** False while useSession() is still hydrating → show shimmer. Once true
   *  (session resolved OR the layout's 6s watchdog fired), stop shimmering even
   *  if name/org are still missing — avoids a permanently stuck placeholder. */
  sessionLoaded?: boolean
}

// No string defaults for orgName/userName: while the client session is still
// hydrating they arrive as undefined, and a fake "User"/"Organization" reads
// as a wrong account (recurring user report). Render skeletons instead.
export function Header({ orgName, userName, userAvatar, onOpenLauncher, sessionLoaded = false }: HeaderProps) {
  const t = useTranslations("common")
  const tAuth = useTranslations("auth")
  const tNav = useTranslations("nav")
  const tProfile = useTranslations("profile")
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  // The NextAuth session doesn't carry the avatar URL, so the header fetches it
  // once on mount (the same /users/me the profile page uses). Falls back to the
  // first-letter badge until it loads / when the user has no avatar.
  const [avatar, setAvatar] = useState<string | null>(userAvatar ?? null)
  useEffect(() => {
    if (userAvatar !== undefined) return // caller supplied it — don't fetch
    let active = true
    fetch("/api/v1/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.success && j.data?.avatar) setAvatar(j.data.avatar)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [userAvatar])

  const initial = userName ? userName.charAt(0).toUpperCase() : "·"

  return (
    <header data-testid="global-header" className="flex h-14 min-w-0 items-center justify-between gap-2 border-b border-zinc-200/40 bg-card px-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-zinc-700/40 sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {orgName ? (
          <span className="max-w-24 truncate text-sm font-semibold text-foreground sm:max-w-32 xl:max-w-none">{orgName}</span>
        ) : !sessionLoaded ? (
          <span className="inline-block h-4 w-28 rounded bg-foreground/10 animate-pulse" aria-hidden="true" />
        ) : null}

        {/* Visible search bar — pill style */}
        <button aria-label={t("search")} title={t("search")} className="flex shrink-0 items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:px-4 cursor-pointer">
          <Search className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t("search")}</span>
          <kbd className="hidden xl:inline-flex items-center gap-0.5 rounded-full border border-zinc-200/60 dark:border-zinc-700/60 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>

        {/* App Launcher — primary-accent waffle button opens the all-apps grid overlay */}
        <button
          onClick={onOpenLauncher}
          data-tour-id="app-launcher"
          title={`${tNav("allApps")} (⌘⇧K)`}
          aria-label={tNav("allApps")}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm ring-1 ring-primary/20 transition-all hover:bg-primary/90 hover:shadow-md active:scale-[0.98] sm:px-3.5 cursor-pointer"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="hidden sm:inline">{tNav("allApps")}</span>
        </button>

        {/* Help and the tour replay for the dashboard, right after "All apps".
            They used to sit at the end of the dashboard's shortcut row, which
            is in normal page flow — so at the right scroll position they ended
            up underneath the floating voice orb, which is fixed to the bottom
            right corner. Up here they are out of that corner's reach at any
            scroll position, and still on the right. */}
        {pathname === "/dashboard" && (
          <div
            data-testid="header-page-help"
            className="dashboard-welcome-help flex shrink-0 items-center gap-1"
            role="group"
          >
            <TourReplayButton tourId="dashboard" />
            <HelpButton slug="crm-dashboard" variant="label" />
          </div>
        )}
      </div>

      <div data-testid="global-header-actions" className="flex shrink-0 items-center gap-1 sm:gap-2">
        <NotificationBell />

        <LanguageSwitcher />

        <WallpaperSelector />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {/* User menu — avatar + name open a Popover with profile / logout */}
        <div className="ml-1 border-l border-zinc-200/40 pl-2 dark:border-zinc-700/40 sm:ml-2 sm:pl-4">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={userName ?? "User menu"}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-muted/60 cursor-pointer"
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt={userName ?? ""}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                    {initial}
                  </span>
                )}
                {userName ? (
                  <span className="hidden text-sm font-medium xl:block">{userName}</span>
                ) : !sessionLoaded ? (
                  <span className="hidden h-4 w-20 animate-pulse rounded bg-foreground/10 xl:inline-block" aria-hidden="true" />
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1.5">
              {/* Identity header inside the menu */}
              <div className="flex items-center gap-2 px-2 py-2">
                {avatar ? (
                  <img src={avatar} alt={userName ?? ""} className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                    {initial}
                  </span>
                )}
                <span className="truncate text-sm font-medium">{userName}</span>
              </div>

              <div className="my-1 h-px bg-zinc-200/60 dark:bg-zinc-700/60" />

              <PopoverClose asChild>
                <Link
                  href="/profile"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                >
                  <User className="h-4 w-4" />
                  {tProfile("myProfile")}
                </Link>
              </PopoverClose>

              <div className="my-1 h-px bg-zinc-200/60 dark:bg-zinc-700/60" />

              <button
                type="button"
                onClick={() => signOut({ callbackUrl: signOutCallbackUrl() })}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {tAuth("signOut")}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  )
}
