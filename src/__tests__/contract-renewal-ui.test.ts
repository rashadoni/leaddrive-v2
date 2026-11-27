// @vitest-environment jsdom

import { act, createElement, Fragment } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = () => true
    return translate
  },
}))
const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }))

import { ContractRenewDialog, ContractRenewalBanner, canRenew, type RenewalContract } from "@/components/contracts/contract-renewal"
import { readHint } from "./helpers/hint"
import { ContractRenewButton } from "@/components/contracts/contract-renewal"

/**
 * «Продление» on the contract card (owner 2026-11-26, mock, «Давай»): the line under the header,
 * the «Продлить» button and the window that makes the draft. React in jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const posts: Array<{ url: string; body: Record<string, unknown> }> = []
let reply: { status: number; json: unknown } = { status: 201, json: { success: true, data: { id: "ctr-new", contractNumber: "DG-7/2027" } } }

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  posts.length = 0
  nav.push.mockReset()
  reply = { status: 201, json: { success: true, data: { id: "ctr-new", contractNumber: "DG-7/2027" } } }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    posts.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.json } as Response
  }))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const DAY = 86_400_000
const inDays = (n: number) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + n * DAY).toISOString()
}
const contract = (over: Partial<RenewalContract> = {}): RenewalContract => ({
  id: "ctr-1", status: "active", startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-12-31T00:00:00.000Z",
  valueAmount: "120000.0000", currency: "AZN", renewalSource: null, renewedAs: [], ...over,
})
const banner = async (c: RenewalContract, onRenew = vi.fn()) => {
  await act(async () => root.render(createElement(ContractRenewalBanner, { contract: c, onRenew })))
  return onRenew
}

describe("the line under the header", () => {
  it("in the last 90 days: when it ends and «Продлить»", async () => {
    const onRenew = await banner(contract({ endDate: inDays(40) }))
    expect(q("renewal-ending")?.textContent).toContain('"days":40')
    await act(async () => q("renewal-banner-renew")!.click())
    expect(onRenew).toHaveBeenCalledTimes(1)
  })
  it("earlier than that, nothing", async () => {
    await banner(contract({ endDate: inDays(120) }))
    expect(container.textContent).toBe("")
  })
  it("a renewal in work is named instead, and «Продлить» is not offered again", async () => {
    const c = contract({ status: "renewing", endDate: inDays(40), renewedAs: [{ id: "ctr-2", contractNumber: "DG-7/2027", status: "pending_approval" }] })
    await banner(c)
    expect(q("renewal-open")?.textContent).toContain("DG-7/2027")
    expect(q("renewal-open")?.querySelector("a")?.getAttribute("href")).toBe("/contracts/ctr-2")
    expect(q("renewal-ending")).toBeNull()
    expect(canRenew(c)).toBe(false)
  })
  it("a renewed contract points to its successor; the successor to its source", async () => {
    await banner(contract({ status: "renewed", renewedAs: [{ id: "ctr-2", contractNumber: "DG-7/2027", status: "active" }] }))
    expect(q("renewal-renewed")?.querySelector("a")?.getAttribute("href")).toBe("/contracts/ctr-2")
    await banner(contract({ status: "draft", renewalSource: { id: "ctr-1", contractNumber: "DG-7", status: "renewing" } }))
    expect(q("renewal-source")?.querySelector("a")?.getAttribute("href")).toBe("/contracts/ctr-1")
  })
  it("«Продлить» is offered on a contract in force or ended, never on a draft", () => {
    expect(canRenew(contract())).toBe(true)
    expect(canRenew(contract({ status: "expired" }))).toBe(true)
    expect(canRenew(contract({ status: "draft" }))).toBe(false)
    expect(canRenew(contract({ status: "renewed" }))).toBe(false)
  })
})

it("the button says what it does", async () => {
  await act(async () => root.render(createElement(ContractRenewButton, { onClick: vi.fn() })))
  expect(await readHint(q("contract-renew-open"))).toBe("renewal.renewHint")
})

describe("the window", () => {
  const open = async (c: RenewalContract) => {
    await act(async () => root.render(createElement(Fragment, null, createElement(ContractRenewDialog, { open: true, onOpenChange: vi.fn(), contract: c }))))
    await flush()
  }
  const input = (id: string) => document.getElementById(id) as HTMLInputElement
  const submit = async () => {
    await act(async () => (q("renew-form") as HTMLFormElement).requestSubmit())
    await flush()
  }

  it("is filled in — the next year, the same amount — and makes the draft, then opens it", async () => {
    await open(contract())
    expect(input("renewal-start").value).toBe("2027-01-01")
    expect(input("renewal-end").value).toBe("2027-12-31")
    expect(input("renewal-value").value).toBe("120000")
    await submit()
    expect(posts).toEqual([{ url: "/api/v1/contracts/ctr-1/renew", body: { startDate: "2027-01-01", endDate: "2027-12-31", valueAmount: 120000 } }])
    expect(nav.push).toHaveBeenCalledWith("/contracts/ctr-new")
  })

  it("a renewal already open is named with a link, not made twice", async () => {
    reply = { status: 409, json: { code: "RENEWAL_EXISTS", renewal: { id: "ctr-2", contractNumber: "DG-7/2027" } } }
    await open(contract())
    await submit()
    const alert = document.body.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("renewal.errors.RENEWAL_EXISTS")
    expect(alert?.querySelector("a")?.getAttribute("href")).toBe("/contracts/ctr-2")
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("an end before the start is said before anything is sent", async () => {
    await open(contract())
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => { setter.call(input("renewal-end"), "2026-12-01"); input("renewal-end").dispatchEvent(new Event("input", { bubbles: true })) })
    await submit()
    expect(posts).toHaveLength(0)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("renewal.errors.RENEWAL_DATES_INVALID")
  })
})
