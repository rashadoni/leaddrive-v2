// @vitest-environment jsdom
/**
 * The CRM shell with a session that came with the page (lib/session-seed.ts).
 *
 * The shell holds every page back until it knows who is signed in
 * (`childrenReady` in `(dashboard)/layout.tsx`), and a page asks for its data
 * only once it is mounted. On production 2026-11-23 that wait was a request of
 * its own, 0.55–1.8 s on every page load, before any page had asked for
 * anything.
 *
 * The real root `Providers` (next-auth's real `SessionProvider`) and the real
 * dashboard layout are server-rendered and hydrated here. Asserted: the server
 * still sends the skeleton and nobody's page; the page is mounted and loading
 * its data when hydration finishes; no request for the session was made.
 */
import { act, createElement, useEffect, type ReactNode } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgFromSession } from "@/lib/nav-items"

const router = { replace: () => {}, push: () => {} }
vi.mock("next/navigation", () => ({ usePathname: () => "/deals", useRouter: () => router }))
vi.mock("@/lib/fonts/dashboard-font", () => ({ dashboardFont: { variable: "synthetic-font" } }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/web-vitals", () => ({ useReportWebVitals: () => undefined }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ useNavOrgContext: (user: unknown) => orgFromSession(user) }))

// The session gate, the identity key and the module checks are the layout's
// own. Background providers that have nothing to do with them are replaced.
vi.mock("@tanstack/react-query", () => ({
  QueryClient: class {}, QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/ui/crm-appearance", () => ({ CrmAppearanceProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/contexts/wallpaper-context", () => ({ WallpaperProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/contexts/ticket-badge-context", () => ({ TicketBadgeProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/tour/tour-provider", () => ({ TourProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/shell-events-provider", () => ({ ShellEventsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/voip-call-provider", () => ({ VoipCallProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/contexts/launcher-prefs-context", () => ({ LauncherPrefsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/ui/motion", () => ({
  MotionPage: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}))
vi.mock("@/components/sidebar", () => ({
  Sidebar: ({ sessionLoaded }: { sessionLoaded: boolean }) => createElement("nav", { "data-testid": "sidebar", "data-session-loaded": String(sessionLoaded) }),
}))
vi.mock("@/components/support-mobile-navigation", () => ({ SupportMobileNavigation: () => null }))
vi.mock("@/components/header", () => ({ Header: () => null }))
vi.mock("@/components/command-search", () => ({ CommandSearch: () => null }))
vi.mock("@/components/app-launcher", () => ({ AppLauncher: () => null }))
vi.mock("@/components/ai-assistant-panel", () => ({ AiAssistantPanel: () => null }))
vi.mock("@/components/ai/voice-orb", () => ({ VoiceOrb: () => null }))
vi.mock("@/components/ai/content-search-bar", () => ({ ContentSearchBar: () => null }))
vi.mock("@/components/dashboard-wallpaper", () => ({ DashboardWallpaper: () => null }))
vi.mock("@/components/reviewer-watermark", () => ({ ReviewerWatermark: () => null }))
vi.mock("@/components/tour/tour-renderer", () => ({ TourRenderer: () => null }))
vi.mock("@/components/ticket-notifier", () => ({ TicketNotifier: () => null }))
vi.mock("@/components/cross-tenant-notice", () => ({ CrossTenantNotice: () => null }))
vi.mock("@/components/web-vitals-reporter", () => ({ WebVitalsReporter: () => null }))
vi.mock("@/components/help/help-video-launcher", () => ({ HelpVideoLauncher: () => null }))
vi.mock("@/components/help/help-video-first-visit", () => ({ HelpVideoFirstVisitPrompt: () => null }))
vi.mock("@/components/mtm/pharmacy-promotion-outbox-sync", () => ({ PharmacyPromotionOutboxSync: () => null }))
vi.mock("@/components/ui/page-skeleton", () => ({ PageSkeleton: () => createElement("div", { "data-testid": "page-skeleton" }) }))

import DashboardLayout from "@/app/(dashboard)/layout"
import { Providers } from "@/components/providers"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SESSION = {
  expires: "2099-01-01T00:00:00.000Z",
  iat: 1,
  user: {
    id: "synthetic-user-a", email: "synthetic-a@example.invalid", name: "Synthetic A",
    organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
    modules: { crm: true, sales: true, settings: true },
  },
}

let requests: string[] = []
let pageDataLoads = 0

/** A CRM page: mounted by the shell, asks for its data once it is. */
function DealsPage() {
  useEffect(() => {
    pageDataLoads++
    void fetch("/api/v1/deals")
  }, [])
  return createElement("h1", { "data-testid": "deals-page" }, "deals")
}

const app = (session: typeof SESSION | null) =>
  createElement(Providers, { session: session as never }, createElement(DashboardLayout, null, createElement(DealsPage)))

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  requests = []
  pageDataLoads = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    requests.push(new URL(url, "https://crm.example.invalid").pathname)
    // A session request that never comes back in time: the staircase's first step.
    if (url.includes("/api/auth/session")) return new Promise<Response>(() => {})
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  }))
})

afterEach(async () => {
  if (root) await act(async () => { root?.unmount() })
  root = null
  container.remove()
  vi.unstubAllGlobals()
})

describe("the CRM shell, opened with the session that came with the page", () => {
  it("is sent by the server as before: the skeleton, the sidebar waiting, no page", () => {
    const html = renderToString(app(SESSION))
    expect(html).toContain('data-testid="page-skeleton"')
    expect(html).toContain('data-session-loaded="false"')
    expect(html).not.toContain('data-testid="deals-page"')
    expect(pageDataLoads).toBe(0)
  })

  it("has the page mounted and asking for its data when hydration finishes — and never asks who is signed in", async () => {
    container.innerHTML = renderToString(app(SESSION))
    const hydrationErrors: unknown[] = []
    await act(async () => {
      root = hydrateRoot(container, app(SESSION), { onRecoverableError: (error) => hydrationErrors.push(error) })
    })

    expect(hydrationErrors).toEqual([])
    expect(container.querySelector('[data-testid="deals-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="page-skeleton"]')).toBeNull()
    expect(container.querySelector('[data-testid="sidebar"]')?.getAttribute("data-session-loaded")).toBe("true")
    expect(pageDataLoads).toBe(1)
    // The page's own request is the first thing the browser sends.
    expect(requests).toEqual(["/api/v1/deals"])
  })

  it("without that session still waits for the answer, as it did: the page is not mounted while the request is out", async () => {
    container.innerHTML = renderToString(app(null))
    await act(async () => { root = hydrateRoot(container, app(null)) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })

    expect(requests).toContain("/api/auth/session")
    expect(container.querySelector('[data-testid="deals-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="page-skeleton"]')).not.toBeNull()
    expect(pageDataLoads).toBe(0)
  })
})
