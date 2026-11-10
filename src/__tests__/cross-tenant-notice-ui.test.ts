// @vitest-environment jsdom
/**
 * The notice a cross-tenant tab shows (components/cross-tenant-notice).
 *
 * Production 2026-11-10 17:43 Baku: the Zeytun host refused three calls carrying a LeadDrive
 * session (`/api/v1/tasks`, `/api/v1/notifications` twice) and the tab said nothing at all — one
 * screen in the whole product reacted to that answer. The properties under test are therefore the
 * two that make this safe to install globally: the person is told WHICH organisations are involved,
 * and every caller still receives the untouched response, body included. A wrapper around
 * `window.fetch` that quietly ate a response body would break every screen at once.
 *
 * The copy is the real `messages/ru.json`, so a renamed key or a renamed placeholder fails here.
 */
import { readFileSync } from "fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// Function declarations, not consts: the `next-intl` factory below is hoisted above the imports and
// would meet a const in its temporal dead zone.
let cached: Record<string, string> | null = null
function auth(): Record<string, string> {
  if (!cached) cached = JSON.parse(readFileSync("messages/ru.json", "utf8")).auth as Record<string, string>
  return cached
}
function translate(key: string, values?: Record<string, string>): string {
  const template = auth()[key]
  if (typeof template !== "string") throw new Error(`messages/ru.json has no auth.${key}`)
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values?.[name]
    if (value === undefined) throw new Error(`auth.${key} wants {${name}}, which the component did not pass`)
    return value
  })
}
vi.mock("next-intl", () => ({ useTranslations: () => translate }))

import { CrossTenantNotice } from "@/components/cross-tenant-notice"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** What the server answers this call. Set per test. */
let answer: () => Response

beforeAll(() => {
  // Installed once, before anything renders: the component wraps whatever `window.fetch` is when it
  // first subscribes, exactly as it does in a browser.
  Object.defineProperty(window, "fetch", { writable: true, value: async () => answer() })
})

let container: HTMLDivElement
let root: Root

const text = () => container.textContent ?? ""

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

beforeEach(async () => {
  answer = () => json({ success: true }, 200)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(CrossTenantNotice)) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe("CrossTenantNotice", () => {
  it("names both organisations when the server refuses the tab", async () => {
    answer = () => json({ error: "Unauthorized", code: "cross_tenant", sessionSlug: "leaddrive", hostSlug: "zeytun" }, 401)

    await window.fetch("/api/v1/tasks")
    await settle()

    expect(container.querySelector('[data-testid="cross-tenant-notice"]')).not.toBeNull()
    expect(text()).toContain(auth().crossTenantTitle)
    // The sentence the owner was missing: which tab this is, and where he is actually signed in.
    expect(text()).toContain("zeytun")
    expect(text()).toContain("leaddrive")
    expect(text()).toContain("Войти в zeytun")
  })

  it("hands the caller the very response the server sent, body included", async () => {
    // The wrapper reads a clone. If it ever read the response itself, every `await res.json()` in
    // the product would throw on a 401 — a far worse failure than the silence it replaces.
    answer = () => json({ error: "Unauthorized", code: "cross_tenant", sessionSlug: "leaddrive", hostSlug: "zeytun" }, 401)

    const refused = await window.fetch("/api/v1/tasks")
    expect(refused.status).toBe(401)
    expect(refused.bodyUsed).toBe(false)
    await expect(refused.json()).resolves.toEqual({
      error: "Unauthorized", code: "cross_tenant", sessionSlug: "leaddrive", hostSlug: "zeytun",
    })

    answer = () => json({ success: true, data: [1, 2, 3] }, 200)
    const ok = await window.fetch("/api/v1/tasks")
    expect(ok.status).toBe(200)
    await expect(ok.json()).resolves.toEqual({ success: true, data: [1, 2, 3] })
  })

  it("says nothing about an ordinary lost session", async () => {
    // "Sign in again" is a different sentence and a different fix; this notice must not claim it.
    answer = () => json({ error: "Unauthorized", code: "session_expired" }, 401)

    await window.fetch("/api/v1/tasks")
    await settle()

    expect(container.querySelector('[data-testid="cross-tenant-notice"]')).toBeNull()
    expect(text()).toBe("")
  })

  it("says nothing while calls succeed", async () => {
    await window.fetch("/api/v1/tasks")
    await settle()
    expect(text()).toBe("")
  })

  it("speaks without the slugs rather than not at all", async () => {
    answer = () => json({ error: "Unauthorized", code: "cross_tenant", sessionSlug: null, hostSlug: null }, 401)

    await window.fetch("/api/v1/notifications")
    await settle()

    expect(text()).toContain(auth().crossTenantBodyUnknown)
    expect(text()).toContain(auth().crossTenantSignIn)
  })

  it("stays closed once the person closes it, however many calls keep failing", async () => {
    answer = () => json({ error: "Unauthorized", code: "cross_tenant", sessionSlug: "leaddrive", hostSlug: "zeytun" }, 401)
    await window.fetch("/api/v1/tasks")
    await settle()

    const close = [...container.querySelectorAll("button")].find((b) => b.textContent === auth().crossTenantDismiss)!
    await act(async () => { close.dispatchEvent(new MouseEvent("click", { bubbles: true })) })

    expect(container.querySelector('[data-testid="cross-tenant-notice"]')).toBeNull()

    // The background polls keep running and keep being refused; the person already answered.
    await window.fetch("/api/v1/notifications")
    await settle()
    expect(container.querySelector('[data-testid="cross-tenant-notice"]')).toBeNull()
  })
})
