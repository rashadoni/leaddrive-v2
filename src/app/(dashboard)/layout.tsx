"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Plus_Jakarta_Sans } from "next/font/google"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ThemeProvider } from "@/components/theme-provider"
import { CommandSearch } from "@/components/command-search"
import { AppLauncher } from "@/components/app-launcher"
import { LauncherPrefsProvider } from "@/contexts/launcher-prefs-context"
import { isNavItemEnabled, orgFromSession, matchNavItem } from "@/lib/nav-items"
import { ModuleDisabled } from "@/components/module-disabled"
import { AiAssistantPanel } from "@/components/ai-assistant-panel"
import { VoiceOrb } from "@/components/ai/voice-orb"
import { ContentSearchBar } from "@/components/ai/content-search-bar"
import { MotionPage } from "@/components/ui/motion"
import { WallpaperProvider } from "@/contexts/wallpaper-context"
import { DashboardHeroProvider, useDashboardHero } from "@/contexts/dashboard-hero-context"
import { TicketBadgeProvider } from "@/contexts/ticket-badge-context"
import { DashboardWallpaper } from "@/components/dashboard-wallpaper"
import { TicketNotifier } from "@/components/ticket-notifier"
import { VoipCallProvider } from "@/components/voip-call-provider"
import { TourProvider } from "@/components/tour/tour-provider"
import { TourRenderer } from "@/components/tour/tour-renderer"
import { TooltipProvider } from "@/components/ui/tooltip"
import { HelpVideoLauncher } from "@/components/help/help-video-launcher"
import { PharmacyPromotionOutboxSync } from "@/components/mtm/pharmacy-promotion-outbox-sync"
import { dashboardAssistantVisibility } from "@/lib/dashboard-assistant-visibility"

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const { heroCommandVisible } = useDashboardHero()
  const user = session?.user
  const outboxSession = user as { id?: string; email?: string; organizationId?: string; role?: string } | undefined
  // Who the session belongs to. Stable for as long as the same person is
  // signed in — deliberately without `iat`, see pageIdentityKey below.
  const sessionIdentity = outboxSession
    ? `${outboxSession.organizationId ?? ""}:${outboxSession.id ?? outboxSession.email ?? ""}:${outboxSession.role ?? ""}`
    : ""
  // The outbox sync wants the token rotation too: it re-runs when the token is
  // re-issued, which is what tells it the credentials it drains with are fresh.
  const outboxSessionKey = outboxSession ? `${sessionIdentity}:${session?.iat ?? ""}` : ""
  const org = orgFromSession(user)

  // Hydration watchdog: the sidebar/header skeleton is meant for the brief
  // (~200ms) useSession() hydration gap. But if /api/auth/session hangs or fails
  // (slow next-auth resolve — see [P2] session-flip), `user` stays undefined and
  // the skeleton would render FOREVER (recoverable only by F5). After 6s we stop
  // waiting and render the menu with whatever org context we have (fallback
  // modules) — a brief fallback menu beats a permanently stuck skeleton. Once the
  // session eventually resolves, `user` becomes truthy and the menu re-renders
  // with the real modules. status === "unauthenticated" also releases the gate
  // immediately (middleware will redirect; no point showing a skeleton).
  const [hydrationTimedOut, setHydrationTimedOut] = useState(false)
  useEffect(() => {
    if (user) return // hydrated — watchdog not needed
    const t = setTimeout(() => setHydrationTimedOut(true), 6000)
    return () => clearTimeout(t)
  }, [user])
  const sessionLoaded = !!user || status === "unauthenticated" || hydrationTimedOut

  // The KPI Arena (leaderboard) is a full-bleed bubble visualization — the
  // content-top AI search bar clashes with it, so hide it there.
  //
  // On the dashboard the hero owns a larger, contextual Da Vinci field, so the
  // shared bar would be a duplicate — but only while the hero is actually
  // showing it. The greeting is a switchable widget now, and a tenant who
  // turns it off must get the ordinary search bar back instead of losing every
  // in-flow way to reach the assistant.
  const isDashboardHome = pathname === "/dashboard"
  const hideContentSearch =
    (isDashboardHome && heroCommandVisible) || pathname.startsWith("/leaderboard")
  const [launcherOpen, setLauncherOpen] = useState(false)

  // Direct-URL guard: if the current section's module/feature isn't enabled for
  // this tenant, render a clean "not enabled" screen instead of the page (the
  // page never mounts, so its data fetches — which would 403 — don't fire). The
  // real boundary is the API (requireAuth → 403); this is the UX layer.
  // Gated on `session` so the guard never flashes before the session loads;
  // superadmin bypasses; unknown paths (no nav item) are never blocked.
  const role = (user as { role?: string } | undefined)?.role
  const navItem = matchNavItem(pathname)
  const moduleBlocked =
    !!session &&
    role !== "superadmin" &&
    !!navItem &&
    !navItem.pageUngated && // page whose access is enforced server-side by its API (e.g. channels) — don't hard-block
    !isNavItemEnabled(org, navItem)

  // Page-fetch race fix (44 pages): child pages do raw `fetch()` in
  // `useEffect([session])`. If a page mounts BEFORE the session is authenticated,
  // its fetch races to a 401 (cookie not ready), the response isn't retried, and
  // the page renders empty until F5 (full reload → SSR has the cookie). Gate the
  // child pages on `status === "authenticated"` so every page's fetch starts with
  // a ready session. The 6s watchdog is the backstop: a hung/failing session still
  // renders the page eventually (its fetch may 401, but at least it's not a blank
  // shell forever). status === "unauthenticated" is left to middleware (redirect).
  const childrenReady = status === "authenticated" || hydrationTimedOut
  const {
    contentSearchVisible,
    showFloatingAiLauncher,
    showFloatingVoiceOrb,
  } = dashboardAssistantVisibility({
    pathname,
    childrenReady,
    moduleBlocked,
    hideContentSearch,
    heroCommandVisible: isDashboardHome && heroCommandVisible,
  })

  return (
    <ThemeProvider>
      <WallpaperProvider>
        <QueryClientProvider client={queryClient}>
          <TicketBadgeProvider>
          <TourProvider>
          <VoipCallProvider>
          <TooltipProvider delayDuration={200}>
          <LauncherPrefsProvider>
          <DashboardWallpaper />
          <div className="relative z-[2] flex h-screen min-w-0">
            {/* sessionLoaded: while useSession() is still hydrating, the
                sidebar shows a skeleton and the header shows shimmer
                placeholders — rendering the menu from a default org context
                here silently hid module groups (MTM/Finance) and showed a
                fake "User" identity (recurring bug report 2026-06-11). */}
            <Sidebar org={org} sessionLoaded={sessionLoaded} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Header
                orgName={user?.organizationName}
                userName={user?.name ?? undefined}
                sessionLoaded={sessionLoaded}
                onOpenLauncher={() => setLauncherOpen(true)}
              />
              <main className={`relative flex-1 overflow-y-auto bg-background p-3 sm:p-4 lg:p-8 ${jakarta.className}`}>
                {!childrenReady ? (
                  <div className="flex h-full items-center justify-center" aria-busy="true">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />
                  </div>
                ) : moduleBlocked ? (
                  <ModuleDisabled />
                ) : (
                  <>
                    {/* Prominent AI search — top of content (hidden on the
                        full-bleed KPI Arena) */}
                    {contentSearchVisible && <ContentSearchBar />}
                    {/* Section help video — an in-flow card at the top of the
                        content (never a floating overlay), so it doesn't cover
                        the work area. Expands into a modal on click. */}
                    <HelpVideoLauncher />
                    {/* Keyed on WHO is signed in, never on the token.
                        This used to be `key={outboxSessionKey}`, which carries
                        `session.iat`. Every GET /api/auth/session re-signs the
                        JWT to refresh its expiry (@auth/core jwt.js setIssuedAt),
                        so the iat — and with it the key — changed on the second
                        session read that next-auth's SessionProvider fires on
                        mount all by itself: the first read broadcasts on a fresh
                        BroadcastChannel, the provider's own listener hears it and
                        refetches. So a second or two after every page became
                        interactive, React threw the whole subtree away and built
                        it again: open wizards closed, half-typed forms were
                        wiped, every page-level fetch ran twice.
                        Identity still resets the page — switching account must
                        not leave the previous one's state on screen. Token
                        rotation is not an identity change. */}
                    <MotionPage key={sessionIdentity}>{children}</MotionPage>
                  </>
                )}
              </main>
              <CommandSearch />
              <AppLauncher org={org} open={launcherOpen} onOpenChange={setLauncherOpen} />
              <AiAssistantPanel showFloatingLauncher={showFloatingAiLauncher} />
              {/* The voice orb renders nothing unless the pilot gate allows
                  this user. MTM moves its control into the in-flow AI bar so
                  it cannot intercept bottom/sticky operational actions. */}
              <VoiceOrb
                showFloatingLauncher={showFloatingVoiceOrb}
                inlineLauncherAvailable={contentSearchVisible}
              />
            </div>
          </div>
          <TourRenderer />
          <TicketNotifier />
          {status === "authenticated" ? <PharmacyPromotionOutboxSync sessionKey={outboxSessionKey} /> : null}
          </LauncherPrefsProvider>
          </TooltipProvider>
          </VoipCallProvider>
          </TourProvider>
          </TicketBadgeProvider>
        </QueryClientProvider>
      </WallpaperProvider>
    </ThemeProvider>
  )
}

/**
 * The hero provider sits above the shell because the shell reads it: the
 * dashboard page reports whether its Da Vinci field is on screen, and the
 * shell decides from that whether a second entry point to the same assistant
 * is worth rendering.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardHeroProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardHeroProvider>
  )
}
