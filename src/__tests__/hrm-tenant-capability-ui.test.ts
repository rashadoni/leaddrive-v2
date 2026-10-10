// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TenantCapabilitiesPanel, type CapabilityRow } from "@/app/admin/tenants/[id]/tenant-capabilities-panel"
import { WorkforceCapabilityControl } from "@/app/admin/tenants/[id]/workforce-capability-control"
import TenantEditPage from "@/app/admin/tenants/[id]/edit/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const navigation = vi.hoisted(() => ({ id: "tenant-a", push: vi.fn() }))
vi.mock("next/navigation", () => ({ useParams: () => ({ id: navigation.id }), useRouter: () => ({ push: navigation.push }) }))
vi.mock("next/link", () => ({ default: ({ children, href }: { children?: ReactNode; href: string }) => createElement("a", { href }, children) }))
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
const messages = (locale = "en") => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const row = (enabled = false): CapabilityRow => ({
  id: "workforce-hrm", label: "Workforce HRM", description: "Human resources",
  kind: "capability", billing: "included", appSlug: null,
  status: enabled ? "enabled" : "disabled", enabled, reason: "Tenant decision", actions: ["approve", "disable"], visibleInMenu: enabled, entitlementKeys: ["workforce-hrm"],
})
const response = (enabled = false) => new Response(JSON.stringify({ data: { capabilities: [row(enabled)] } }), { status: 200 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  navigation.id = "tenant-a"
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
async function render(element: ReactNode, locale = "en") {
  const errors = vi.fn()
  await act(async () => root.render(createElement(IntlProvider, { locale, messages: messages(locale), timeZone: "UTC", onError: errors }, element)))
  expect(errors).not.toHaveBeenCalled()
}
function button(label: string) {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === label)
  expect(match, label).toBeTruthy()
  return match!
}
async function click(item: HTMLElement) { await act(async () => item.click()) }
const control = (tenantId = "tenant-a", refreshRevision = 0) => createElement(WorkforceCapabilityControl, {
  tenantId, refreshRevision, label: "HRM", pages: "People · Timesheets", onBusyChange: vi.fn(),
})

describe("HRM tenant capability UI", () => {
  it("keeps disabled HRM discoverable and requires an explicit Enable action", async () => {
    fetchMock.mockResolvedValueOnce(response(false))
    await render(createElement(TenantCapabilitiesPanel, { tenantId: "tenant-a" }))
    const section = Array.from(container.querySelectorAll("section")).find(item => item.querySelector("h4")?.textContent === "Disabled")!
    expect(section.textContent).toContain("Workforce HRM")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValueOnce(response(true))
    await click(button("Enable"))
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/admin/tenants/tenant-a/capabilities", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ capabilityId: "workforce-hrm", action: "approve" }) }))
    expect(container.textContent).toContain("Workforce HRM approved")
    expect(section.textContent).not.toContain("Workforce HRM")
  })

  it("catches a dropped panel response and never shows false approval", async () => {
    fetchMock.mockResolvedValueOnce(response(false))
    await render(createElement(TenantCapabilitiesPanel, { tenantId: "tenant-a" }))
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    await click(button("Enable"))
    expect(container.textContent).toContain("Refresh to confirm")
    expect(container.textContent).not.toContain("Workforce HRM approved")
    expect(button("Refresh").disabled).toBe(false)
  })

  it.each(["en", "ru", "az"])("reads canonical access and localizes HRM status in %s without writing on load", async locale => {
    fetchMock.mockResolvedValueOnce(response(true))
    await render(control(), locale)
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
    expect(container.textContent).toContain(messages(locale).admin.tenants.workforceEnabled)
    expect(container.textContent).toContain(messages(locale).admin.tenants.workforceControlHint)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  })

  it("serializes explicit changes and rereads authority after an ambiguous network failure", async () => {
    fetchMock.mockResolvedValueOnce(response(false))
    await render(control())
    const pending = deferred<Response>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!
    await click(toggle)
    await click(toggle)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(toggle.disabled).toBe(true)
    await act(async () => pending.reject(new Error("response lost")))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not confirm")
    expect(toggle.disabled).toBe(true)
    expect(container.textContent).not.toContain("Saved")
    fetchMock.mockResolvedValueOnce(response(true))
    await click(button("Reload HRM state"))
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    fetchMock.mockResolvedValueOnce(response(false))
    await click(toggle)
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(JSON.stringify({ capabilityId: "workforce-hrm", action: "disable" }))
    expect(toggle.getAttribute("aria-checked")).toBe("false")
  })

  it("ignores a delayed GET from a previous tenant", async () => {
    const pending = deferred<Response>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(true))
    await render(control("tenant-a"))
    await render(control("tenant-b"))
    await act(async () => pending.resolve(response(false)))
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/admin/tenants/tenant-b/capabilities", expect.any(Object))
  })

  it("ignores a delayed PATCH from a previous tenant in both controls", async () => {
    const pending = deferred<Response>()
    fetchMock.mockResolvedValueOnce(response(false)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(false))
    await render(control("tenant-a"))
    await click(container.querySelector<HTMLButtonElement>('[role="switch"]')!)
    await render(control("tenant-b"))
    await act(async () => pending.resolve(response(true)))
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
    expect(container.textContent).not.toContain("Saved")
    fetchMock.mockResolvedValueOnce(response(false))
    await render(createElement(TenantCapabilitiesPanel, { tenantId: "tenant-a" }))
    const patch = deferred<Response>()
    fetchMock.mockReturnValueOnce(patch.promise).mockResolvedValueOnce(response(false))
    await click(button("Enable"))
    await render(createElement(TenantCapabilitiesPanel, { tenantId: "tenant-b" }))
    await act(async () => patch.resolve(response(true)))
    expect(container.textContent).not.toContain("approved")
    expect(button("Enable").disabled).toBe(false)
  })

  it("does not accept malformed success payloads", async () => {
    fetchMock.mockResolvedValueOnce(response(false))
    await render(control())
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }))
    await click(container.querySelector<HTMLButtonElement>('[role="switch"]')!)
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
    expect(container.textContent).not.toContain("Saved")
  })

  it("editor ignores contradictory raw features, saves metadata separately, then reloads effective HRM", async () => {
    let enabled = false
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/capabilities")) {
        if (init?.method === "PATCH") enabled = true
        return response(enabled)
      }
      return new Response(JSON.stringify({ data: {
        id: "tenant-a", name: "Tenant", slug: "tenant", plan: "enterprise", maxUsers: 10, maxContacts: 100,
        branding: {}, features: ["crm", "workforce-hrm"], addons: [], settings: {},
      } }), { status: 200 })
    })
    await render(createElement(TenantEditPage))
    const toggle = container.querySelector<HTMLButtonElement>('[data-tenant-capability="workforce-hrm"] [role="switch"]')!
    expect(toggle.getAttribute("aria-label")).toBe("HRM")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true)
    await click(toggle)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    await click(button(messages().admin.tenants.save))
    const save = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!
    expect(String(save[0])).toBe("/api/v1/admin/tenants/tenant-a")
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/v1/admin/tenants/tenant-a/capabilities")
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })
})
