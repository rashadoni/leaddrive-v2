// @vitest-environment jsdom

import { act, createElement, useEffect, useState, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgFromSession } from "@/lib/nav-items"

const state = vi.hoisted(() => ({
  session: {
    iat: 1,
    user: {
      id: "synthetic-user-a", email: "synthetic-a@example.invalid",
      organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
      modules: { crm: true, sales: true, settings: true, mtm: false },
    },
  },
  sessionPresent: true,
  status: "authenticated" as "authenticated" | "loading" | "unauthenticated",
  pathname: "/dashboard",
  mounts: 0,
  unmounts: 0,
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: state.sessionPresent ? state.session : null, status: state.status }),
}))
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }))
vi.mock("next/font/google", () => ({ Plus_Jakarta_Sans: () => ({ variable: "synthetic-font" }) }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ useNavOrgContext: (user: unknown) => orgFromSession(user) }))

// Keep the actual layout's session gate, identity key, pathname handling and
// module/role checks. Replace unrelated background/browser providers only.
vi.mock("@tanstack/react-query", () => ({
  QueryClient: class {}, QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/ui/crm-appearance", () => ({ CrmAppearanceProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/contexts/wallpaper-context", () => ({ WallpaperProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/contexts/ticket-badge-context", () => ({ TicketBadgeProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/tour/tour-provider", () => ({ TourProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/voip-call-provider", () => ({ VoipCallProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/contexts/launcher-prefs-context", () => ({ LauncherPrefsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/ui/motion", () => ({
  MotionPage: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}))
vi.mock("@/components/sidebar", () => ({ Sidebar: () => null }))
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
vi.mock("@/components/help/help-video-launcher", () => ({ HelpVideoLauncher: () => null }))
vi.mock("@/components/mtm/pharmacy-promotion-outbox-sync", () => ({ PharmacyPromotionOutboxSync: () => null }))
vi.mock("@/components/module-disabled", () => ({
  ModuleDisabled: ({ reason }: { reason: string }) => createElement("div", { "data-testid": "blocked-page" }, reason),
}))

import DashboardLayout from "@/app/(dashboard)/layout"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function StatefulPage() {
  const [edits, setEdits] = useState(0)
  useEffect(() => {
    state.mounts += 1
    return () => { state.unmounts += 1 }
  }, [])
  return createElement("button", { "data-testid": "stateful-page", onClick: () => setEdits((value) => value + 1) }, `edits:${edits}`)
}

async function render() {
  await act(async () => { root.render(createElement(DashboardLayout, null, createElement(StatefulPage))) })
}

function page() {
  return container.querySelector<HTMLButtonElement>('[data-testid="stateful-page"]')
}

async function edit() {
  expect(page()).not.toBeNull()
  await act(async () => { page()!.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
  expect(page()?.textContent).toBe("edits:1")
}

function cloneSession() {
  state.session = {
    ...state.session, iat: state.session.iat + 1,
    user: { ...state.session.user, modules: { ...state.session.user.modules } },
  }
}

beforeEach(() => {
  state.session = {
    iat: 1,
    user: {
      id: "synthetic-user-a", email: "synthetic-a@example.invalid",
      organizationId: "synthetic-org-a", role: "manager", plan: "enterprise",
      modules: { crm: true, sales: true, settings: true, mtm: false },
    },
  }
  state.sessionPresent = true
  state.status = "authenticated"
  state.pathname = "/dashboard"
  state.mounts = 0
  state.unmounts = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.useRealTimers()
})

describe("dashboard shell session lifecycle", () => {
  it("waits for the first authenticated identity before mounting page content", async () => {
    state.sessionPresent = false
    state.status = "loading"
    await render()
    expect(page()).toBeNull()
    expect(state.mounts).toBe(0)
    expect(container.querySelector('main [aria-busy="true"]')).not.toBeNull()
    state.sessionPresent = true
    state.status = "authenticated"
    await render()
    expect(page()?.textContent).toBe("edits:0")
    expect(state.mounts).toBe(1)
  })

  it("keeps page state and DOM mounted through equivalent session refresh and transient loading", async () => {
    await render()
    await edit()
    const original = page()
    cloneSession()
    await render()
    expect(page()).toBe(original)
    expect(page()?.textContent).toBe("edits:1")

    state.status = "loading"
    cloneSession()
    await render()
    expect(page()).toBe(original)
    expect(page()?.textContent).toBe("edits:1")
    expect(state.mounts).toBe(1)
    expect(state.unmounts).toBe(0)

    state.status = "authenticated"
    cloneSession()
    await render()
    expect(page()).toBe(original)
    expect(page()?.textContent).toBe("edits:1")
    expect(state.mounts).toBe(1)
    expect(state.unmounts).toBe(0)
  })

  it.each([
    ["user", { id: "synthetic-user-b" }],
    ["organization", { organizationId: "synthetic-org-b" }],
    ["role", { role: "viewer" }],
  ] as const)("still resets page state when the %s changes", async (_kind, change) => {
    await render()
    await edit()
    const previous = page()
    state.session = { ...state.session, user: { ...state.session.user, ...change } }
    await render()
    expect(page()).not.toBe(previous)
    expect(page()?.textContent).toBe("edits:0")
    expect(state.mounts).toBe(2)
    expect(state.unmounts).toBe(1)
  })

  it("does not keep page content for an explicitly unauthenticated retained session", async () => {
    await render()
    await edit()
    state.status = "unauthenticated"
    await render()
    expect(page()).toBeNull()
    expect(state.unmounts).toBe(1)
  })

  it("still applies the module guard during a retained-session refresh", async () => {
    await render()
    state.status = "loading"
    state.session = { ...state.session, user: { ...state.session.user, modules: { ...state.session.user.modules, crm: false } } }
    await render()
    expect(page()).toBeNull()
    expect(container.querySelector('[data-testid="blocked-page"]')?.textContent).toBe("module")
    expect(state.unmounts).toBe(1)
  })

  it("still applies the role guard during a retained-session refresh", async () => {
    state.pathname = "/settings/users"
    state.session.user.role = "admin"
    await render()
    expect(page()).not.toBeNull()
    state.status = "loading"
    // Managers have no settings permission; viewers retain read-only access.
    state.session = { ...state.session, user: { ...state.session.user, role: "manager" } }
    await render()
    expect(page()).toBeNull()
    expect(container.querySelector('[data-testid="blocked-page"]')?.textContent).toBe("role")
  })

  it("preserves the existing six-second recovery for a hung initial session", async () => {
    vi.useFakeTimers()
    state.sessionPresent = false
    state.status = "loading"
    await render()
    await act(async () => { await vi.advanceTimersByTimeAsync(5999) })
    expect(page()).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(page()?.textContent).toBe("edits:0")
    expect(state.mounts).toBe(1)
  })
})
