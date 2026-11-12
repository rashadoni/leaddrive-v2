// @vitest-environment jsdom
/**
 * "Remember me" on the real /login page (owner 2026-11-12: «галочку сохранить
 * данные чтоб каждый раз не набирать»).
 *
 * Ticked at a good sign-in: the server is asked for the 30-day session and the
 * next visit opens with the e-mail filled in and the box ticked. Left empty:
 * the 8-hour session, and nothing is kept. The password is never stored by the
 * page. Only the two Auth.js endpoints are stubbed.
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

async function submit(email: string | null = "synthetic-admin@example.invalid") {
  if (email !== null) type("email", email)
  type("password", "synthetic-password")
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  // Until the attempt has an outcome — the page went on, or said "wrong" — not
  // a fixed number of turns: the first test of the file also pays for loading
  // the sign-in helper, and five turns were sometimes not enough (CI, #1143).
  for (let turn = 0; turn < 200 && !nav.push.mock.calls.length && !text().includes("auth.invalidCredentials"); turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
  }
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const text = () => container.textContent ?? ""

beforeEach(() => {
  window.localStorage.clear()
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

const emailField = () => container.querySelector<HTMLInputElement>("#email")!
const box = () => container.querySelector<HTMLInputElement>("#remember-me")!

async function tick() {
  await act(async () => { box().click() })
}

async function reopen() {
  await act(async () => { root.unmount() })
  root = createRoot(container)
  nav.push.mockClear()
  await openLogin("")
}

describe("Remember me on /login", () => {
  it("is offered, empty by default, with the e-mail and password fields autofill-ready", async () => {
    await openLogin("")
    expect(text()).toContain("auth.rememberMe")
    expect(box().checked).toBe(false)
    expect(emailField().autocomplete).toBe("username")
    expect(container.querySelector<HTMLInputElement>("#password")!.autocomplete).toBe("current-password")
  })

  it("ticked: asks for the long session, and the next visit has the e-mail and the box", async () => {
    await openLogin("")
    await tick()
    await submit("client@example.invalid")
    expect(nav.push).toHaveBeenCalledWith("/")
    expect(posted?.get("rememberMe")).toBe("1")

    await reopen()
    expect(emailField().value).toBe("client@example.invalid")
    expect(box().checked).toBe(true)
    // Nothing of the password survives on the device.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("synthetic-password")
  })

  it("unticked next time: the short session, and the e-mail is forgotten", async () => {
    await openLogin("")
    await tick()
    await submit("client@example.invalid")

    await reopen()
    await tick()
    expect(box().checked).toBe(false)
    await submit(null)
    expect(posted?.get("rememberMe")).toBe("0")

    await reopen()
    expect(emailField().value).toBe("")
    expect(box().checked).toBe(false)
  })

  it("a refused password keeps nothing", async () => {
    passwordAccepted = false
    await openLogin("")
    await tick()
    await submit("client@example.invalid")
    expect(text()).toContain("auth.invalidCredentials")

    await reopen()
    expect(emailField().value).toBe("")
    expect(box().checked).toBe(false)
  })
})
