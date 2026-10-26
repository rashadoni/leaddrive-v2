// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ReactNode, type ComponentProps, type FunctionComponent } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import TenantEditPage from "@/app/admin/tenants/[id]/edit/page"
import { TENANT_MODULE_CONTROLS } from "@/lib/admin-sidebar-catalog"

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "tenant-a" }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next/link", () => ({ default: ({ children, href }: { children?: ReactNode; href: string }) => createElement("a", { href }, children) }))
// The phone numbers panel loads its own list; this suite counts the tenant page's own requests.
vi.mock("@/components/admin/voice-numbers-panel", () => ({ VoiceNumbersPanel: () => null }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const tenant = (features: string[], modules = {}) => ({
  id: "tenant-a", name: "Tenant", slug: "tenant", plan: "enterprise", maxUsers: 10, maxContacts: 100,
  branding: {}, features, modules, addons: [], settings: {},
})
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(locale = "en") {
  const errors = vi.fn()
  await act(async () => root.render(createElement(IntlProvider, {
    locale, messages: messages(locale), timeZone: "UTC", onError: errors,
  }, createElement(TenantEditPage))))
  expect(errors).not.toHaveBeenCalled()
}
async function click(element: Element | null) {
  expect(element).toBeTruthy()
  await act(async () => (element as HTMLElement).click())
}
function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === label)!
}
function capability(id: string) { return container.querySelector(`[data-tenant-capability="${id}"] [role="switch"]`) }
function pageFeature(id: string) { return container.querySelector(`[data-page-feature="${id}"] [role="switch"]`) }
function hiddenCategory(label: string) {
  return Array.from(container.querySelectorAll("button[aria-label]")).find((element) => element.textContent?.includes(label))!
}

describe("unified tenant module picker", () => {
  it.each(["en", "ru", "az"])("shows routes, personnel and brand monitoring together in %s", async locale => {
    fetchMock.mockResolvedValueOnce(response(tenant(["social", "route-field", "personnel"])))
    await render(locale)
    const picker = container.querySelector("[data-tenant-module-picker]")!
    for (const id of ["route-field", "personnel"]) {
      expect(picker.contains(capability(id))).toBe(true)
      expect(capability(id)?.getAttribute("aria-checked")).toBe("true")
      expect(picker.textContent).not.toContain(id)
    }
    expect(picker.querySelectorAll('[data-module-group="Route & Field"]')).toHaveLength(1)
    expect(hiddenCategory(messages(locale).nav.groups["Route & Field"])).toBeUndefined()
    expect(picker.textContent).toContain(messages(locale).admin.tenants.brandMonitoring)
    expect(picker.textContent).not.toContain(messages(locale).admin.tenants.capabilitiesDesc)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  })

  it("reads legacy and explicit disabled access and persists only deliberate capability changes", async () => {
    fetchMock.mockResolvedValueOnce(response(tenant(["crm", "mtm", "personnel"], { personnel: false })))
    await render()
    expect(capability("route-field")?.getAttribute("aria-checked")).toBe("true")
    expect(capability("personnel")).toBeNull()
    await click(hiddenCategory("Personnel"))
    fetchMock.mockResolvedValueOnce(response({ ...tenant(["crm", "mtm", "personnel"]), features: '["crm","mtm","personnel"]', modules: { mtm: true, personnel: true } }))
    await click(button(messages("en").admin.tenants.save))
    const saved = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))
    expect(saved.capabilityChanges).toEqual({ personnel: true })
    expect(saved.features).toContain("mtm")
    expect(capability("personnel")?.getAttribute("aria-checked")).toBe("true")
    await click(capability("personnel"))
    fetchMock.mockResolvedValueOnce(response({ ...tenant(["crm", "mtm"]), modules: { mtm: true, personnel: false } }))
    await click(button(messages("en").admin.tenants.save))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).capabilityChanges).toEqual({ personnel: false })
    expect(capability("route-field")?.getAttribute("aria-checked")).toBe("true")
  })

  it("preserves an unrelated draft edit made while a save is in flight", async () => {
    fetchMock.mockResolvedValueOnce(response(tenant(["crm", "support", "personnel"])))
    await render()
    let finish!: (result: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve }))
    await click(button(messages("en").admin.tenants.save))
    const extraToggle = pageFeature("complaints_register")!
    await click(extraToggle)
    expect(extraToggle.getAttribute("aria-checked")).toBe("true")
    await act(async () => finish(response({ ...tenant(["crm", "support", "personnel"]), modules: { crm: true, support: true, personnel: true } })))
    expect(pageFeature("complaints_register")?.getAttribute("aria-checked")).toBe("true")
    fetchMock.mockResolvedValueOnce(response({ ...tenant(["crm", "support", "personnel", "complaints_register"]), modules: { crm: true, support: true, personnel: true } }))
    await click(button(messages("en").admin.tenants.save))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).features).toContain("complaints_register")
  })

  it("switches a flagged page on its own row, inside its group", async () => {
    fetchMock.mockResolvedValueOnce(response(tenant(["crm", "mtm"], { crm: true, mtm: true })))
    await render("az")
    const row = container.querySelector('[data-page-feature="pharmacy_phone_orders"]')!
    expect(row.closest("[data-module-group]")?.getAttribute("data-module-group")).toBe("Route & Field")
    expect(row.textContent).toContain(messages("az").nav.pharmacyPhoneOrders)
    expect(row.className).toContain("line-through")
    await click(pageFeature("pharmacy_phone_orders"))
    expect(row.className).not.toContain("line-through")
    fetchMock.mockResolvedValueOnce(response(tenant(["crm", "mtm", "pharmacy_phone_orders"], { crm: true, mtm: true })))
    await click(button(messages("az").admin.tenants.save))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).features).toContain("pharmacy_phone_orders")
  })

  it("includes both independent capabilities in bulk actions and preserves unrelated flags", async () => {
    const flags = ["social_discovery", "ai_auto_triage", "workforce-hrm"]
    fetchMock.mockResolvedValueOnce(response(tenant(flags)))
    await render()
    await click(button(messages("en").admin.tenants.selectAll))
    const picker = container.querySelector("[data-tenant-module-picker]")!
    expect(picker.querySelectorAll('[role="switch"][aria-checked="true"]')).toHaveLength(TENANT_MODULE_CONTROLS.length)
    expect(capability("personnel")?.getAttribute("aria-checked")).toBe("true")
    expect(capability("route-field")?.getAttribute("aria-checked")).toBe("true")
    expect(capability("workforce-hrm")).toBeNull()
    await click(button(messages("en").admin.tenants.clearAll))
    expect(picker.querySelectorAll('[role="switch"][aria-checked="true"]')).toHaveLength(0)
    fetchMock.mockResolvedValueOnce(response({ ...tenant(flags), modules: { mtm: false, personnel: false, "route-field": false } }))
    await click(button(messages("en").admin.tenants.save))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).features).toEqual(flags)
  })
})
