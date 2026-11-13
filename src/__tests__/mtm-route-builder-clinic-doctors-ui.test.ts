// @vitest-environment jsdom
/**
 * Zeytun 2026-11-13, through the owner: «когда составляешь маршрут, выбор
 * клиники будет для того, чтоб выбрать там врачей… визит только к субъектам».
 * Owner, same day: pharmacies stay stops of their own. The planner is
 * rendered for real against a stubbed server.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/mtm/routes", useSearchParams: () => new URLSearchParams() }))

import { MtmRouteBuilder } from "@/components/mtm/route-builder"

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CLINIC = { id: "clinic-3", name: "Klinika 3", address: "Nizami 5", city: "Bakı", objectType: "CLINIC" }
const EMPTY_CLINIC = { id: "clinic-9", name: "Klinika 9", address: "Füzuli 1", city: "Bakı", objectType: "CLINIC" }
const PHARMACY = { id: "pharmacy-92", name: "Aptek 92", address: "Yasamal", city: "Bakı", objectType: "PHARMACY" }

function candidate(customer: typeof CLINIC, contact: { id: string; name: string } | null) {
  return {
    id: contact ? `contact:${contact.id}` : `customer:${customer.id}`,
    customerId: customer.id,
    contactId: contact?.id ?? null,
    name: contact?.name ?? customer.name,
    category: "A",
    code: null,
    specialtyCode: null,
    specialtyName: contact ? "Terapevt" : null,
    psychotype: null,
    score: null,
    scoreFormulaVersion: null,
    lastVisitAt: null,
    plannedRoute: null,
    availability: { source: "ACTIVE_CATALOG", validFrom: null, validThrough: null },
    coverage: null,
    customer,
  }
}

const requests: URLSearchParams[] = []
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  requests.length = 0
  // jsdom has no layout: the planner scrolls its client list into view.
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("/api/v1/mtm/agents")) {
      return new Response(JSON.stringify({ success: true, data: { agents: [{ id: "agent-1", name: "Rashad", status: "ACTIVE", role: "AGENT" }] } }))
    }
    if (url.startsWith("/api/v1/mtm/settings")) return new Response(JSON.stringify({ success: true, data: {} }))
    if (url.startsWith("/api/v1/mtm/routes/candidates")) {
      const params = new URL(url, "http://localhost").searchParams
      requests.push(params)
      let candidates: unknown[] = []
      if (params.get("direction") === "ORGANIZATION") candidates = [candidate(CLINIC, null), candidate(EMPTY_CLINIC, null)]
      if (params.get("direction") === "PHARMACY") candidates = [candidate(PHARMACY, null)]
      if (params.get("direction") === "DOCTOR" && params.get("customerId") === "clinic-3") {
        candidates = [candidate(CLINIC, { id: "doctor-aliyeva", name: "Dr. Əliyeva" }), candidate(CLINIC, { id: "doctor-huseynov", name: "Dr. Hüseynov" })]
      }
      return new Response(JSON.stringify({ success: true, data: { candidates, total: candidates.length, facets: { region: [], administrativeDistrict: [], objectType: [], organization: [], specialtyCode: [], psychotype: [] }, pagination: { nextCursor: null } } }))
    }
    return new Response(JSON.stringify({ success: true, data: {} }))
  }))
  const messages = JSON.parse(readFileSync("messages/ru.json", "utf8")) as AbstractIntlMessages
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(IntlProvider, { locale: "ru", messages, timeZone: "Asia/Baku" }, createElement(MtmRouteBuilder, {
      open: true, initialDate: "2026-11-20", initialAgentId: "agent-1", initialDirection: "ORGANIZATION", onClose: vi.fn(), onSaved: vi.fn(),
    } as never)))
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)]
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 300 && !check(); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  expect(check()).toBe(true)
}
/** Step one of the planner: the agent, then «Выбрать клиентов». */
async function toClients() {
  await until(() => [...container.querySelectorAll("option")].some((option) => option.value === "agent-1"))
  const select = [...container.querySelectorAll<HTMLSelectElement>("select")].find((element) => [...element.options].some((option) => option.value === "agent-1"))!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "agent-1")
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  const next = all("button").find((button) => button.textContent?.trim() === "Выбрать клиентов")!
  await act(async () => next.click())
}
const candidates = () => all("[data-testid='mtm-route-candidate']")
const named = (name: string) => candidates().find((button) => button.textContent?.includes(name))
const stopsText = () => all("[data-testid^='mtm-route-stop']").map((stop) => stop.textContent ?? "").join(" | ")

describe("a clinic opens its doctors", () => {
  it("shows the clinic's doctors instead of adding the clinic, and a tapped doctor becomes the stop", async () => {
    await toClients()
    await until(() => Boolean(named("Klinika 3")))
    expect(named("Klinika 3")?.getAttribute("aria-label")).toBe("Открыть врачей клиники Klinika 3")
    await act(async () => named("Klinika 3")!.click())
    await until(() => Boolean(named("Dr. Əliyeva")))

    expect(all("[data-testid='mtm-route-clinic-doctors']")[0].textContent).toContain("Врачи клиники «Klinika 3»")
    const doctorsRequest = requests.at(-1)!
    expect(doctorsRequest.get("direction")).toBe("DOCTOR")
    expect(doctorsRequest.get("customerId")).toBe("clinic-3")

    await act(async () => named("Dr. Əliyeva")!.click())
    await act(async () => named("Dr. Hüseynov")!.click())
    expect(named("Dr. Əliyeva")?.hasAttribute("disabled")).toBe(true)
    expect(named("Dr. Hüseynov")?.hasAttribute("disabled")).toBe(true)

    // Back to the clinics: the clinic itself was never added.
    await act(async () => all("[data-testid='mtm-route-clinic-back']")[0].click())
    await until(() => Boolean(named("Klinika 3")))
    expect(named("Klinika 3")?.hasAttribute("disabled")).toBe(false)
  })

  it("offers the clinic itself only when it has no doctors", async () => {
    await toClients()
    await until(() => Boolean(named("Klinika 9")))
    await act(async () => named("Klinika 9")!.click())
    await until(() => all("[data-testid='mtm-route-clinic-add-itself']").length === 1)
    expect(candidates()).toHaveLength(0)
  })

  it("leaves a pharmacy a stop of its own (owner, 2026-11-13: «Аптеки остаются»)", async () => {
    await toClients()
    await until(() => all("[data-testid='mtm-route-candidate-type-pharmacies']").length === 1)
    await act(async () => all("[data-testid='mtm-route-candidate-type-pharmacies']")[0].click())
    await until(() => Boolean(named("Aptek 92")))
    expect(named("Aptek 92")?.getAttribute("aria-label")).not.toContain("Открыть врачей")
    await act(async () => named("Aptek 92")!.click())
    expect(named("Aptek 92")?.hasAttribute("disabled")).toBe(true)
    expect(all("[data-testid='mtm-route-clinic-doctors']")).toHaveLength(0)
  })
})
