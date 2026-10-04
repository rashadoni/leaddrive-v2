// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkforcePolicyEmployeeImpactSection } from "@/components/workforce/workforce-policy-employee-impact-preview"
import { previewWorkforcePolicyEmployeeImpact, type WorkforcePolicyImpactRecord } from "@/lib/workforce/policy-employee-impact-preview"
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition"
import type { WorkforcePolicyImpactSource } from "@/lib/workforce/policy-employee-impact-receipt"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null }
const policy = (draft: boolean): WorkforcePolicyImpactRecord => ({ id: draft ? "PRIVATE_DRAFT_ID" : "PRIVATE_BASELINE_ID", organizationId: "PRIVATE_ORG",
  teamId: null, name: draft ? "Future draft" : "Recorded baseline", version: draft ? 2 : 1, status: draft ? "DRAFT" : "ACTIVE",
  effectiveFrom: new Date(draft ? "2026-10-06" : "2020-01-01"), effectiveTo: null, definition,
  definitionHash: workforcePolicyDefinitionHash(definition), activatedAt: draft ? null : new Date("2020-01-01"), retiredAt: null })
const preview = () => previewWorkforcePolicyEmployeeImpact({ organizationId: "PRIVATE_ORG", observedAt: new Date("2026-10-04T12:00:00Z"),
  timezone: "UTC", draft: policy(true), published: [policy(false)],
  employees: [{ id: "PRIVATE_EMPLOYEE", organizationId: "PRIVATE_ORG", status: "ACTIVE", membership: null }] })
const source: WorkforcePolicyImpactSource = { id: policy(true).id, name: "Future draft", version: 2, teamId: null,
  definitionHash: workforcePolicyDefinitionHash(definition), effectiveFrom: "2026-10-06" }
const texts = (locale = "en") => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforcePolicyEmployeeImpact
let container: HTMLDivElement, root: Root
let pending: Array<{ url: string; options: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void }>
const denied = vi.fn()
function render(locale = "en", selected: WorkforcePolicyImpactSource | null = source, blocked = false, sessionKey = "session-a") {
  root.render(createElement(IntlProvider, { locale, messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")), timeZone: "UTC" },
    createElement(WorkforcePolicyEmployeeImpactSection, { key: JSON.stringify([sessionKey, selected]), source: selected, blocked, onDenied: denied })))
}
const button = () => container.querySelector<HTMLButtonElement>("button")!
const response = (value: unknown = preview(), status = 200) => new Response(JSON.stringify(status < 400
  ? { success: true, data: { preview: value } } : value), { status })
const reply = async (value?: unknown, status = 200, index = pending.length - 1) => {
  await act(async () => pending[index].resolve(response(value, status)))
}
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  pending = []; denied.mockReset()
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => pending.push({ url, options, resolve, reject }))))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("on-demand aggregate employee impact card", () => {
  it.each(["en", "ru", "az"])("requires explicit read and displays aggregate facts/boundary without private ids in %s", async locale => {
    await act(async () => render(locale)); expect(pending).toHaveLength(0)
    await act(async () => button().click()); expect(pending).toHaveLength(1)
    expect(pending[0].url).toBe("/api/v1/workforce/configuration/policies/PRIVATE_DRAFT_ID/employee-impact")
    expect(pending[0].options.method).toBeUndefined(); expect(pending[0].options.body).toBeUndefined()
    expect(pending[0].options.credentials).toBe("same-origin"); await reply()
    expect(container.textContent).toContain(texts(locale).boundary)
    expect(container.textContent).toContain(texts(locale).membership)
    expect(container.textContent).toContain("Future draft")
    expect(container.textContent).not.toMatch(/PRIVATE_DRAFT_ID|PRIVATE_BASELINE_ID|PRIVATE_ORG|PRIVATE_EMPLOYEE|[a-f0-9]{64}/)
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(5)
    expect(button().disabled).toBe(false)
  })
  it("does not request without a compared draft or while restore is held", async () => {
    await act(async () => render("en", null)); expect(button().disabled).toBe(true)
    await act(async () => button().click()); expect(pending).toHaveLength(0)
    await act(async () => render("en", source, true)); expect(button().disabled).toBe(true)
    await act(async () => button().click()); expect(pending).toHaveLength(0)
  })
  it("aborts old session reads and ignores a late resolved old preview", async () => {
    await act(async () => render()); await act(async () => button().click())
    await act(async () => render("en", source, false, "different-principal-and-tenant"))
    expect((pending[0].options.signal as AbortSignal).aborted).toBe(true)
    await reply(undefined, 200, 0); expect(container.textContent).not.toContain(texts().boundary)
    expect(container.querySelector("table")).toBeNull(); expect(pending).toHaveLength(1)
  })
  it("clears old preview on selection change and never automatically loads the replacement", async () => {
    await act(async () => render()); await act(async () => button().click()); await reply()
    await act(async () => render("en", { ...source, id: "different-draft" }))
    expect(container.textContent).not.toContain(texts().boundary); expect(pending).toHaveLength(1)
  })
  it.each([401, 403])("propagates actual denial %s to clear the parent without showing raw payload", async status => {
    await act(async () => render()); await act(async () => button().click())
    await reply({ error: "PRIVATE_SERVER_MESSAGE" }, status)
    expect(denied).toHaveBeenCalledExactlyOnceWith(status === 401 ? "session" : "permission")
    expect(container.textContent).not.toContain("PRIVATE_SERVER_MESSAGE"); expect(container.querySelector("table")).toBeNull()
  })
  it("rejects an invented live guarantee instead of displaying server result", async () => {
    await act(async () => render()); await act(async () => button().click())
    await reply({ ...preview(), guaranteedAtActivation: true })
    expect(container.textContent).toContain(texts().failed); expect(container.querySelector("table")).toBeNull()
  })
  it("returns a meaningful cap error without partial groups or raw details", async () => {
    await act(async () => render()); await act(async () => button().click())
    await reply({ code: "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED", error: "PRIVATE_SERVER_MESSAGE", data: preview() }, 409)
    expect(container.textContent).toContain(texts().limit); expect(container.querySelector("table")).toBeNull()
    expect(container.textContent).not.toContain("PRIVATE_SERVER_MESSAGE")
  })
  it("clears the prior preview and rejects a refreshed draft that no longer matches comparison", async () => {
    await act(async () => render()); await act(async () => button().click()); await reply()
    await act(async () => button().click())
    expect(container.querySelector("table")).toBeNull()
    await reply({ ...preview(), draft: { ...preview().draft, version: 3 } })
    expect(container.textContent).toContain(texts().failed); expect(container.querySelector("table")).toBeNull()
  })
})
