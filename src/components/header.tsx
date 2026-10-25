"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Sun, Moon, Search, LogOut, Command, LayoutGrid, User, Globe } from "lucide-react"
import { signOut } from "next-auth/react"
import { signOutCallbackUrl } from "@/lib/tenant-domain"
import { NotificationBell } from "@/components/notification-bell"
import { LanguageSwitcher, LANGUAGE_CODES, LANGUAGE_KEYS, switchLocale } from "@/components/language-switcher"
import { WallpaperSelector } from "@/components/wallpaper-selector"
import { useLocale, useTranslations } from "next-intl"
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
  const locale = useLocale()
  const pathname = usePathname()
  const { theme, setTheme, resolvedTheme } = useTheme()

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
    <header
      data-testid="global-header"
      data-session-ready={orgName && userName ? "true" : "false"}
      className="flex h-14 min-w-0 items-center justify-between gap-2 border-b border-zinc-200/40 bg-card px-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-zinc-700/40 sm:px-4 lg:px-6"
    >
      <div className="flex min-w-0 items-center gap-2 overflow-x-clip sm:gap-4">
        {/* Below sm the organisation name moves into the user menu: next to
            the phone's sidebar rail there is no room for it, and it was one of
            the things pushing the avatar — the only way into the profile — off
            the right edge of the screen. */}
        {orgName ? (
          <span className="hidden max-w-24 truncate text-sm font-semibold text-foreground sm:inline sm:max-w-32 xl:max-w-none">{orgName}</span>
        ) : !sessionLoaded ? (
          <span className="hidden h-4 w-28 rounded bg-foreground/10 animate-pulse sm:inline-block" aria-hidden="true" />
        ) : null}

        {/* Visible search bar — pill style */}
        <button aria-label={t("search")} title={t("search")} className="flex shrink-0 items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted dark:text-zinc-300 sm:px-4 cursor-pointer">
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
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#c2410c] px-3 py-1.5 text-sm font-medium text-white shadow-sm ring-1 ring-black/10 transition-all hover:bg-[#9a3412] hover:shadow-md active:scale-[0.98] sm:px-3.5 cursor-pointer"
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
            {/* Below xl only a "?" icon for help: with their labels these two
                were wider than the room left before the bell, and "Справка"
                landed on top of the avatar — on a phone the profile could not
                be opened at all (2026-10-25). The tour replay waits for xl:
                as an icon it is a second identical "?". */}
            <TourReplayButton tourId="dashboard" className="max-xl:hidden" />
            <HelpButton slug="crm-dashboard" variant="label" className="max-xl:hidden" />
            <HelpButton slug="crm-dashboard" variant="icon" className="xl:hidden" />
          </div>
        )}
      </div>

      <div data-testid="global-header-actions" className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* The voice assistant's microphone portals here (VoiceOrb). The slot
            collapses to nothing for everyone outside the voice pilot; who sees
            the control is still decided by the pilot gate, not by the header. */}
        <div
          id="header-voice-assistant-slot"
          data-testid="header-voice-assistant-slot"
          className="flex shrink-0 items-center empty:hidden"
        />
        <NotificationBell />

        {/* Language, wallpaper and theme sit in the user menu below md (see
            the menu), so on a phone the avatar always stays on screen. */}
        <div className="hidden items-center gap-1 sm:gap-2 md:flex">
          <LanguageSwitcher />

          <WallpaperSelector />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
          className="hidden md:inline-flex"
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
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium">{userName}</span>
                  {orgName ? <span className="block truncate text-xs text-muted-foreground">{orgName}</span> : null}
                </div>
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

              {/* Phone-only: the header has no room for these three. */}
              <div className="md:hidden">
                <div className="my-1 h-px bg-zinc-200/60 dark:bg-zinc-700/60" />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <Globe className="h-4 w-4" />
                    {t("language")}
                  </span>
                  <div className="flex gap-1">
                    {LANGUAGE_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => switchLocale(code)}
                        title={t(LANGUAGE_KEYS[code])}
                        aria-pressed={code === locale}
                        className={`min-h-8 rounded-md px-2 text-xs font-medium uppercase transition-colors ${
                          code === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"
                        }`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-foreground transition-colors hover:bg-muted/60"
                >
                  <span className="flex items-center gap-2">
                    {resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    {tProfile("theme")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resolvedTheme === "dark" ? tProfile("themeDark") : tProfile("themeLight")}
                  </span>
                </button>
                <div className="flex items-center justify-between gap-2 px-2 py-0.5">
                  <span className="pl-6 text-sm text-foreground">{t("wallpaper")}</span>
                  <WallpaperSelector />
                </div>
              </div>

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
