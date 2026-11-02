// @vitest-environment jsdom
/**
 * «Sorğuya bax» on the Panel's «Yeni müştəri sorğusu» opens the request.
 *
 * Owner 2026-10-20, from a picture of /mtm: the button led to /mtm/contacts
 * and he saw the whole list of existing clients. The request queue stood above
 * the list folded to one line, its cards behind «Nəzərdən keçir».
 *
 * The address is the one the Panel's row really carries, and the page is the
 * real Clients page given that address. The list under the queue is not what
 * this test is about and stands in as a placeholder.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("next-intl", () => ({ useLocale: () => "az" }))
vi.mock("@/components/mtm/field-contacts-gate", () => ({ FieldContactsGate: ({ children }: { children: ReactNode }) => children }))
vi.mock("@/components/mtm/contact-explorer", () => ({ MtmContactExplorer: () => createElement("div", { "data-testid": "clients-list" }) }))

import MtmContactsPage from "@/app/(dashboard)/mtm/contacts/page"
import { attentionItemHref } from "@/lib/mtm/panel-attention"

const REQUEST = {
  id: "req-1",
  displayName: "Test Doctor",
  specialtyName: "Kardioloq",
  clinicName: "Test Clinic",
  requestedByAgent: { id: "agent-1", name: "Agent One" },
}

let root: Root
let container: HTMLDivElement
let decisions: Array<{ url: string; body: unknown }>

/** Follows a link the way the browser does: path, then the page given its query. */
async function follow(href: string) {
  const url = new URL(href, "https://app.example")
  expect(url.pathname).toBe("/mtm/contacts")
  const page = await MtmContactsPage({ searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) })
  await act(async () => { root.render(page) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

const queue = () => document.querySelector('[data-testid="mtm-contact-create-requests"]')
const button = (text: string) => [...(queue()?.querySelectorAll("button") ?? [])].find((item) => item.textContent?.trim() === text)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  decisions = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/v1/mtm/contact-create-requests") {
      return Response.json({ success: true, data: { requests: [REQUEST] } })
    }
    if (input.endsWith("/decision")) {
      decisions.push({ url: input, body: JSON.parse(String(init?.body)) })
      return Response.json({ success: true })
    }
    throw new Error(`unexpected request: ${input}`)
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("the Panel's «Sorğuya bax» on a new-client request", () => {
  it("opens the request itself, ready to approve or reject, with no click on the way", async () => {
    await follow(attentionItemHref({ kind: "contactCreateRequests", date: "2026-10-08" }))

    const cards = queue()?.querySelectorAll("article") ?? []
    expect(cards).toHaveLength(1)
    expect(cards[0]?.textContent).toContain("Test Doctor")
    expect(cards[0]?.textContent).toContain("Test Clinic")
    expect(cards[0]?.textContent).toContain("Agent One")
    expect(button("Rədd et")).toBeDefined()
    // The queue stands above the list, so it is what the first screen shows.
    expect(container.firstElementChild).toBe(queue())

    await act(async () => { button("Təsdiq et")?.click() })
    expect(decisions).toEqual([{ url: "/api/v1/mtm/contact-create-requests/req-1/decision", body: { decision: "APPROVED", comment: null } }])
    expect(queue()).toBeNull()
  })

  // Owner, 2026-10-16: on the Clients page by itself the queue is one line over the list.
  it("leaves the Clients page by itself as it was: one folded line over the list", async () => {
    await follow("/mtm/contacts")

    expect(queue()?.querySelectorAll("article")).toHaveLength(0)
    expect(button("Nəzərdən keçir")).toBeDefined()
    expect(document.querySelector('[data-testid="clients-list"]')).not.toBeNull()
  })
})
