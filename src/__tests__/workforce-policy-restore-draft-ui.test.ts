// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkforcePolicyRestoreDraftSection } from "@/components/workforce/workforce-policy-restore-draft"
import { WorkforcePolicyVersionComparisonPage } from "@/components/workforce/workforce-policy-version-comparison"
import type { WorkforcePolicyRestoreSource, WorkforcePolicyRestoreRequest } from "@/lib/workforce/policy-restore-receipt"

const auth = vi.hoisted(() => ({ status: "authenticated", user: { id: "reader", organizationId: "org" } }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: auth.user }, status: auth.status }) }))
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
const source: WorkforcePolicyRestoreSource = { id: "opaque-source", name: "Recorded policy", version: 2,
  status: "ACTIVE", teamId: null, teamName: null, definitionHash: "a".repeat(64) }
const first = { ...source, id: "opaque-before", name: "Earlier policy", version: 1 }
const metadata = (row: typeof source) => ({ id: row.id, name: row.name, version: row.version, status: row.status,
  effectiveFrom: "2026-01-01", effectiveTo: null, definitionHash: row.definitionHash })
const comparison = () => ({ basis: "RECORDED_DEFINITIONS_ONLY_NO_EFFECTIVE_IMPACT_OR_APPROVAL", scope: { kind: "ORGANIZATION", teamId: null },
  from: metadata(first), to: metadata(source), changedCalculationFields: 0, opaqueDefinitionChanged: false,
  fields: ["expectedWorkSeconds", "lateGraceSeconds", "undertimeToleranceSeconds", "overtimeThresholdSeconds", "longPauseThresholdSeconds"]
    .map(field => ({ field, before: field === "longPauseThresholdSeconds" ? null : 0, after: field === "longPauseThresholdSeconds" ? null : 0, changed: false, deltaSeconds: field === "longPauseThresholdSeconds" ? null : 0 })) })
const texts = (locale = "en") => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforcePolicyRestoreDraft
let container: HTMLDivElement, root: Root, uuidCounter: number
let pending: Array<{ url: string; options: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void }>
const denied = vi.fn(), held = vi.fn()
function render(locale = "en", integrated = false, selected: WorkforcePolicyRestoreSource | null = source) {
  root.render(createElement(IntlProvider, { locale, messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")), timeZone: "UTC" },
    integrated ? createElement(WorkforcePolicyVersionComparisonPage) : createElement(WorkforcePolicyRestoreDraftSection, {
      key: JSON.stringify(selected), source: selected, onDenied: denied, onHold: held,
    })))
}
const section = () => container.querySelector<HTMLElement>('section[aria-labelledby="workforce-policy-restore-title"]')!
const button = (label: string) => Array.from(section().querySelectorAll<HTMLButtonElement>("button")).find(row => row.textContent === label)!
async function change(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(selector)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
async function review(locale = "en") {
  await change("#workforce-policy-restore-name", "  New draft  "); await change("#workforce-policy-restore-date", "2026-12-01")
  await act(async () => button(texts(locale).review).closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}
async function submit(locale = "en") { await review(locale); await act(async () => button(texts(locale).create).click()) }
const request = (index = pending.length - 1) => JSON.parse(String(pending[index].options.body)) as WorkforcePolicyRestoreRequest
function receipt(index = pending.length - 1, replayed = false) {
  const body = request(index)
  return { schemaVersion: 1, basis: "CREATION_RECEIPT_ONLY_NOT_CURRENT_STATE", replayed,
    creation: { policyId: "opaque-created", teamId: null, version: 3, name: body.name, effectiveFrom: body.effectiveFrom,
      effectiveTo: null, definitionHash: source.definitionHash, createdAt: "2026-10-04T12:01:02.003Z", statusAtCreation: "DRAFT", sourcePolicyId: source.id, sourceVersion: 2 } }
}
const reply = (value: unknown, status = 201, code = "") => new Response(JSON.stringify({ success: status === 200 || status === 201,
  data: { restore: value }, code, error: "PRIVATE_ERROR_PAYLOAD" }), { status })
async function select(side: string, id: string) {
  await act(async () => { const picker = container.querySelector<HTMLSelectElement>("#workforce-policy-version-" + side)!; picker.value = id; picker.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function integrated() {
  await act(async () => render("en", true)); await change("#workforce-policy-version-query", "Policy")
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await act(async () => pending[0].resolve(new Response(JSON.stringify({ success: true, data: { policies: [first, source].map(row => ({ ...row, team: null })), query: "Policy", limit: 20, hasMore: false } }))))
  await select("from", first.id); await select("to", source.id)
  await act(async () => container.querySelector<HTMLButtonElement>('button[type="button"]')!.click())
  await act(async () => pending[1].resolve(new Response(JSON.stringify({ success: true, data: { comparison: comparison() } }))))
}
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  pending = []; uuidCounter = 0; denied.mockReset(); held.mockReset(); auth.status = "authenticated"; auth.user = { id: "reader", organizationId: "org" }
  vi.stubGlobal("crypto", { randomUUID: () => `operation-${++uuidCounter}-opaque` })
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => pending.push({ url: String(url), options, resolve, reject }))))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("manual restore creation and immutable uncertain retries", () => {
  it("requires a successfully compared recorded source; no mount request or automatic date", async () => {
    await act(async () => render("en", false, null)); expect(pending).toHaveLength(0); expect(section().querySelector("form")).toBeNull()
    await act(async () => render()); expect(pending).toHaveLength(0); expect(container.querySelector<HTMLInputElement>('#workforce-policy-restore-date')!.value).toBe("")
  })
  it.each(["en", "ru", "az"])("reviews explicitly, sends only strict fields and renders historical receipt in %s", async locale => {
    await act(async () => render(locale)); await review(locale); expect(pending).toHaveLength(0)
    await act(async () => { button(texts(locale).create).click(); button(texts(locale).create).click() })
    expect(pending).toHaveLength(1); expect(held).toHaveBeenCalledWith(true)
    expect(pending[0].url).toBe(`/api/v1/workforce/configuration/policies/${source.id}/restore-draft`)
    expect(pending[0].options.method).toBe("POST"); expect(pending[0].options.credentials).toBe("same-origin")
    expect(request()).toEqual({ operationId: "operation-1-opaque", expectedSourceVersion: 2, expectedSourceDefinitionHash: source.definitionHash, name: "New draft", effectiveFrom: "2026-12-01" })
    await act(async () => pending[0].resolve(reply(receipt())))
    expect(section().textContent).toContain(texts(locale).created); expect(section().textContent).toContain(texts(locale).historical)
    expect(section().textContent).not.toMatch(/opaque-source|opaque-created|PRIVATE_ERROR_PAYLOAD|operation-1-opaque|aaaaaa|TENANT_ADMIN/)
    expect(section().querySelector("form")).toBeNull(); expect(held).toHaveBeenLastCalledWith(false)
  })
  it("retries a lost response with byte-identical payload and accepts original200 replay", async () => {
    await act(async () => render()); await submit(); const original = pending[0].options.body
    await act(async () => pending[0].reject(new Error("PRIVATE_NETWORK_DETAIL")))
    expect(section().textContent).toContain(texts().unknown); expect(held).toHaveBeenLastCalledWith(true)
    await act(async () => button(texts().retry).click()); expect(pending[1].options.body).toBe(original); expect(uuidCounter).toBe(1)
    await act(async () => pending[1].resolve(reply(receipt(1, true), 200)))
    expect(section().textContent).toContain(texts().replayed); expect(held).toHaveBeenLastCalledWith(false)
  })
  it.each([null, { schemaVersion: 2 }, { ...{ schemaVersion: 1, basis: "CURRENT_POLICY" }, creation: {} }])("treats malformed201 as uncertain and never permits changed-payload creation", async value => {
    await act(async () => render()); await submit(); await act(async () => pending[0].resolve(reply(value)))
    expect(section().textContent).toContain(texts().unknown); expect(section().querySelector("form")).toBeNull()
    expect(button(texts().abandonConfirm).disabled).toBe(true); expect(uuidCounter).toBe(1)
  })
  it("keeps prior uncertainty after a retry409; informed abandon is required for a new operation", async () => {
    await act(async () => render()); await submit(); await act(async () => pending[0].resolve(reply(null, 503)))
    const original = pending[0].options.body; await act(async () => button(texts().retry).click())
    await act(async () => pending[1].resolve(reply(null, 409, "WORKFORCE_POLICY_RESTORE_INTEGRITY_INVALID")))
    expect(section().textContent).toContain(texts().unknown); expect(section().querySelector("form")).toBeNull(); expect(pending[1].options.body).toBe(original)
    await act(async () => container.querySelector<HTMLInputElement>('#workforce-policy-restore-abandon')!.click())
    await act(async () => button(texts().abandonConfirm).click()); expect(held).toHaveBeenLastCalledWith(false)
    await submit(); expect(request().operationId).toBe("operation-2-opaque")
  })
  it("permits editing after an initial recognized no-write409 and does not expose server error text", async () => {
    await act(async () => render()); await submit(); await act(async () => pending[0].resolve(reply(null, 409, "WORKFORCE_POLICY_RESTORE_NOT_FUTURE")))
    expect(section().textContent).toContain(texts().notFuture); expect(section().textContent).not.toContain("PRIVATE_ERROR_PAYLOAD")
    expect(section().querySelector("form")).not.toBeNull(); expect(held).toHaveBeenLastCalledWith(false)
    await submit(); expect(request().operationId).toBe("operation-2-opaque")
  })
  it.each([401, 403])("clears through the parent on actual current denial%s", async status => {
    await act(async () => render()); await submit(); await act(async () => pending[0].resolve(reply(null, status)))
    expect(denied).toHaveBeenCalledExactlyOnceWith(status === 401 ? "session" : "permission")
    expect(section().textContent).not.toContain("PRIVATE_ERROR_PAYLOAD")
  })
  it("times out into uncertainty, preserving the same operation; abort is not rollback", async () => {
    vi.useFakeTimers(); await act(async () => render()); await submit(); const original = pending[0].options.body
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(pending[0].options.signal?.aborted).toBe(true); expect(section().textContent).toContain(texts().unknown)
    await act(async () => button(texts().retry).click()); expect(pending[1].options.body).toBe(original)
    await act(async () => pending[0].resolve(reply(receipt(0)))) // A late abandoned transport response cannot overwrite the retry.
    expect(section().textContent).not.toContain(texts().created)
    await act(async () => pending[1].resolve(reply(receipt(1, true), 200))); expect(section().textContent).toContain(texts().replayed)
  })
  it("fails locally without a cryptographic operation generator and makes no request", async () => {
    vi.stubGlobal("crypto", {}); await act(async () => render()); await review(); await act(async () => button(texts().create).click())
    expect(pending).toHaveLength(0); expect(section().textContent).toContain(texts().unavailable)
  })
})

describe("restore ownership in the real comparison parent", () => {
  it("locks search/selection/compare synchronously and holds them through uncertain outcomes", async () => {
    await integrated(); await submit(); expect(pending).toHaveLength(3)
    expect(container.querySelector<HTMLInputElement>('#workforce-policy-version-query')!.disabled).toBe(true)
    expect(container.querySelector<HTMLSelectElement>('#workforce-policy-version-to')!.disabled).toBe(true)
    await select("to", first.id)
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(pending).toHaveLength(3); expect(section().textContent).toContain(source.name)
    await act(async () => pending[2].resolve(reply(null, 503)))
    expect(container.querySelector<HTMLSelectElement>('#workforce-policy-version-from')!.disabled).toBe(true)
    await act(async () => button(texts().retry).click()); expect(pending[3].options.body).toBe(pending[2].options.body)
    await act(async () => pending[3].resolve(reply(receipt(3, true), 200)))
    expect(container.querySelector<HTMLInputElement>('#workforce-policy-version-query')!.disabled).toBe(false)
  })
  it.each([401, 403])("clears all private parent reads and form on restore denial%s", async status => {
    await integrated(); await submit(); await act(async () => pending[2].resolve(reply(null, status)))
    expect(container.querySelector('#workforce-policy-version-query')).toBeNull(); expect(container.querySelector('[aria-labelledby="workforce-policy-version-result"]')).toBeNull()
    expect(container.querySelector('[aria-labelledby="workforce-policy-future-window-title"]')).toBeNull(); expect(container.querySelector('[aria-labelledby="workforce-policy-restore-title"]')).toBeNull()
    expect(container.textContent).not.toContain(source.name); expect(container.textContent).not.toContain("New draft")
  })
  it("aborts and clears identity-owned state on tenant/principal changes, ignoring the late old receipt", async () => {
    await integrated(); await submit(); auth.user = { id: "new-reader", organizationId: "new-org" }
    await act(async () => render("en", true)); expect(pending[2].options.signal?.aborted).toBe(true)
    await act(async () => pending[2].resolve(reply(receipt(2))))
    expect(section().textContent).toContain(texts().chooseSource); expect(section().textContent).not.toContain("New draft")
    expect(container.querySelector<HTMLInputElement>('#workforce-policy-version-query')!.value).toBe("")
    expect(container.querySelector<HTMLSelectElement>('#workforce-policy-version-to')!.value).toBe("")
  })
})
