// @vitest-environment jsdom
/**
 * Signing in on a page whose address still carries an earlier result.
 *
 * The session cookie is shared across *.leaddrivecrm.org, so signing into one
 * organisation sends a tab of another to /login?error=cross-tenant. Auth.js
 * answers a good sign-in with the redirect target, and the sign-in helper took
 * that target from the address bar — then read `error=cross-tenant` back out
 * of it as this attempt's result. Production 2026-10-27, Zeytun: three correct
 * passwords in 22 s, none refused by the server (no `credentials_rejected` in
 * the log, the last sign-in time moved), each shown as "wrong email or
 * password".
 *
 * The real login page and the real sign-in helper are rendered; only the two
 * Auth.js endpoints are stubbed, answering as Auth.js does: a good sign-in
 * gets the callbackUrl back, a refused one the login page with `?error=`.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: unknown; href: string }) => createElement("a", { href }, children as never),
}))
const t = vi.hoisted(() => Object.assign((key: string) => `auth.${key}`, { has: () => true, rich: (key: string) => key }))
vi.mock("next-intl", () => ({ useTranslations: () => t, useLocale: () => "az" }))

import LoginPage from "@/app/(auth)/login/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** What the server holds: is this password right? */
let passwordAccepted: boolean
let posted: URLSearchParams | null

function authServer(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(String(input), window.location.href)
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  if (url.pathname === "/api/auth/csrf") return json({ csrfToken: "csrf-value" })
  if (url.pathname === "/api/auth/callback/credentials") {
    posted = new URLSearchParams(String(init?.body))
    if (passwordAccepted) return json({ url: posted.get("callbackUrl") })
    return json({ url: `${window.location.origin}/login?error=CredentialsSignin&code=credentials` })
  }
  return json({})
}

let container: HTMLDivElement
let root: Root

async function openLogin(search: string) {
  window.history.replaceState({}, "", `/login${search}`)
  await act(async () => { root.render(createElement(LoginPage)) })
}

function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

async function submit() {
  type("email", "synthetic-admin@example.invalid")
  type("password", "synthetic-password")
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const text = () => container.textContent ?? ""

beforeEach(() => {
  passwordAccepted = true
  posted = null
  nav.push.mockClear()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => authServer(input, init)))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("signing in on /login with an earlier result in the address", () => {
  it("a right password after being sent here from another organisation signs in", async () => {
    await openLogin("?error=cross-tenant")
    expect(text()).toContain("auth.errCrossTenant")

    await submit()
    expect(text()).not.toContain("auth.invalidCredentials")
    expect(text()).not.toContain("auth.errCrossTenant")
    expect(nav.push).toHaveBeenCalledWith("/")
    expect(posted?.get("callbackUrl")).toBe(`${window.location.origin}/`)
  })

  it("a right password after a mistyped one signs in", async () => {
    await openLogin("?error=CredentialsSignin&code=credentials")
    await submit()
    expect(text()).not.toContain("auth.invalidCredentials")
    expect(nav.push).toHaveBeenCalledWith("/")
  })

  it("a wrong password is still called wrong", async () => {
    passwordAccepted = false
    await openLogin("?error=cross-tenant")
    await submit()
    expect(text()).toContain("auth.invalidCredentials")
    expect(nav.push).not.toHaveBeenCalled()
  })
})

describe("the sign-in helper's default landing address", () => {
  it("is the current address without the previous attempt's result", async () => {
    window.history.replaceState({}, "", "/login?error=cross-tenant&code=credentials&next=keep")
    const { signIn } = await import("@/lib/auth-signin")
    const result = await signIn("credentials", { email: "a@example.invalid", password: "x", redirect: false })
    expect(posted?.get("callbackUrl")).toBe(`${window.location.origin}/login?next=keep`)
    expect(result).toMatchObject({ ok: true })
    expect(result?.error).toBeUndefined()
  })
})
