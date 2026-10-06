// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

vi.mock("next-intl", () => {
  const translate = (key: string) => key
  return { useTranslations: () => translate, useLocale: () => "en" }
})
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => {} }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import PortalUsersPage from "@/app/(dashboard)/settings/portal-users/page"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each([false, true])("refreshes the saved profile with the pending search; user moved focus: %s", async (movedFocus) => {
  let email: string | null = null
  const reads: string[] = []
  let releaseRefresh: (() => void) | undefined
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    if (options.method === "PATCH") {
      const request = JSON.parse(options.body as string)
      email = request.profile.email
      return new Response(JSON.stringify({ data: { credentialsRevoked: false }, auditRecorded: true }))
    }
    reads.push(url)
    if (email) await new Promise<void>((resolve) => { releaseRefresh = resolve })
    return new Response(JSON.stringify({ data: {
      contacts: [{ id: "synthetic", fullName: "Synthetic contact", email, phone: null, companyName: null,
        isActive: true, portalAccessEnabled: false, hasPassword: false, portalLastLoginAt: null, recoveryExpiresAt: null }],
      stats: { totalWithEmail: email ? 1 : 0, enabled: 0, registered: 0, recentLogins: 0 },
      scope: { shown: 1, limit: 100, truncated: false },
    } }))
  }))
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const inputValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  try {
    await act(async () => { root.render(createElement(PortalUsersPage)) })
    const search = host.querySelector<HTMLInputElement>("[data-testid='portal-users-search']")!
    await act(async () => { inputValue(search, "Synthetic") })
    const trigger = host.querySelector<HTMLButtonElement>("[data-testid='portal-user-access']")!
    await act(async () => { trigger.focus(); trigger.click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(16) })
    await act(async () => { inputValue(host.querySelector<HTMLInputElement>("#portal-user-email")!, "synthetic@support-evidence.invalid") })
    const save = host.querySelector<HTMLButtonElement>("[data-testid='portal-user-edit-save']")!
    await act(async () => { save.focus(); save.click() })
    expect(email).toBe("synthetic@support-evidence.invalid")
    expect(trigger.disabled).toBe(true)
    expect(reads).toEqual(["/api/v1/portal-users?", "/api/v1/portal-users?search=Synthetic"])
    if (movedFocus) search.focus()
    await act(async () => { releaseRefresh!() })
    expect(trigger.disabled).toBe(false)
    expect(document.activeElement).toBe(movedFocus ? search : trigger)
    // A stale debounce must not start another refresh and disable the focused action.
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(reads).toHaveLength(2)
    expect(trigger.disabled).toBe(false)
    expect(document.activeElement).toBe(movedFocus ? search : trigger)
  } finally {
    await act(async () => { root.unmount() })
    host.remove()
  }
})
