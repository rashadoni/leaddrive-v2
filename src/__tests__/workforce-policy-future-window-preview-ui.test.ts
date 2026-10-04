// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkforcePolicyFutureWindowSection } from "@/components/workforce/workforce-policy-future-window-preview"
import { WorkforcePolicyVersionComparisonPage } from "@/components/workforce/workforce-policy-version-comparison"

const auth = vi.hoisted(() => ({ status: "authenticated", user: { id: "reader", organizationId: "org" } }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: auth.user }, status: auth.status }) }))
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
const choice = { id: "opaque-draft-id", name: "Future policy", version: 2, status: "DRAFT", teamId: null }
const previous = { id: "opaque-old-id", name: "Published policy", version: 1, effectiveFrom: "2026-01-01", effectiveTo: null }
const preview = () => ({ basis: "RECORDED_SCOPE_WINDOWS_ONLY_NO_EMPLOYEE_IMPACT_OR_APPROVAL", currentDate: "2026-10-04",
  timezone: "UTC", observedAt: "2026-10-04T12:00:00.000Z", scope: { kind: "ORGANIZATION", teamId: null },
  draft: { id: choice.id, name: choice.name, version: choice.version, effectiveFrom: "2026-11-01", effectiveTo: null },
  recordedWindows: [previous], predecessor: { ...previous, projectedEffectiveTo: "2026-10-31" },
  projectedWindow: { effectiveFrom: "2026-11-01", effectiveTo: null }, canonicalActivationRequired: true, guaranteedAtActivation: false })
let container: HTMLDivElement, root: Root
let pending: Array<{ url: string; signal: AbortSignal; resolve: (response: Response) => void }>
const denied = vi.fn()
function render(locale = "en", selected: typeof choice | null = choice, integrated = false) {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  root.render(createElement(IntlProvider, { locale, messages, timeZone: "UTC" }, integrated ? createElement(WorkforcePolicyVersionComparisonPage)
    : createElement(WorkforcePolicyFutureWindowSection, { key: selected?.id, choice: selected, onDenied: denied })))
}
const button = () => container.querySelector<HTMLButtonElement>('section[aria-labelledby="workforce-policy-future-window-title"] button')!
const reply = (value: unknown = preview(), status = 200, code = "") => new Response(JSON.stringify({ success: status === 200,
  data: { preview: value }, code, error: "PRIVATE_ERROR_PAYLOAD" }), { status })
beforeEach(() => {
  container = document.createElement("div");document.body.append(container);root = createRoot(container)
  pending = [];denied.mockReset();auth.status = "authenticated";auth.user = { id: "reader", organizationId: "org" }
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => new Promise<Response>(resolve => pending.push({ url, signal: options.signal as AbortSignal, resolve }))))
})
afterEach(async () => { await act(async () => root.unmount());container.remove();vi.unstubAllGlobals() })

describe("future-window UI read, selection and identity fences", () => {
  it.each([null, { ...choice, status: "ACTIVE" }, { ...choice, status: "RETIRED" }])("does not fetch or enable preview for a non-draft choice", async selected => {
    await act(async () => render("en", selected));expect(button().disabled).toBe(true);expect(pending).toHaveLength(0)
  })
  it.each(["en", "ru", "az"])("shows localized dates and canonical recheck boundary in %s", async locale => {
    const t = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforcePolicyFutureWindowPreview
    await act(async () => render(locale));await act(async () => button().click())
    expect(pending[0].url).toBe(`/api/v1/workforce/configuration/policies/${choice.id}/window-preview`)
    await act(async () => pending[0].resolve(reply()))
    expect(container.textContent).toContain("2026-11-01");expect(container.textContent).toContain("2026-10-31")
    expect(container.textContent).toContain(t.boundary);expect(container.querySelector("details summary")).not.toBeNull()
    expect(container.textContent).not.toMatch(/opaque-draft-id|opaque-old-id|PRIVATE_ERROR_PAYLOAD|definitionHash/)
  })
  it("shows an initial future window without fabricating a previous policy", async () => {
    await act(async () => render());await act(async () => button().click())
    await act(async () => pending[0].resolve(reply({ ...preview(), recordedWindows: [], predecessor: null })))
    expect(container.textContent).toContain("No published version is recorded")
  })
  it("aborts and clears an old choice and ignores its late denial", async () => {
    await act(async () => render());await act(async () => button().click())
    await act(async () => render("en", { ...choice, id: "new-draft-id" }))
    expect(pending[0].signal.aborted).toBe(true)
    await act(async () => pending[0].resolve(reply(null, 403)))
    expect(denied).not.toHaveBeenCalled();expect(container.textContent).not.toContain("2026-10-31")
  })
  it("clears the old result immediately when selection changes", async () => {
    await act(async () => render());await act(async () => button().click());await act(async () => pending[0].resolve(reply()))
    expect(container.textContent).toContain("2026-10-31")
    await act(async () => render("en", { ...choice, id: "another-draft" }));expect(container.textContent).not.toContain("2026-10-31")
  })
  it.each([401,403])("asks the whole parent to clear actual current denial%s", async status => {
    await act(async () => render());await act(async () => button().click());await act(async () => pending[0].resolve(reply(null,status)))
    expect(denied).toHaveBeenCalledExactlyOnceWith(status === 401 ? "session" : "permission")
    expect(container.textContent).not.toContain("PRIVATE_ERROR_PAYLOAD")
  })
  it.each([
    { ...preview(), basis: "APPROVED" }, { ...preview(), guaranteedAtActivation: true },
    { ...preview(), draft: { ...preview().draft, id: "foreign" } },
    { ...preview(), predecessor: { ...preview().predecessor, projectedEffectiveTo: "2026-10-30" } },
    { ...preview(), recordedWindows: [previous, previous] },
    { ...preview(), recordedWindows: Array.from({ length: 101 }, () => previous) },
    { ...preview(), timezone: "Invalid/Timezone" },
  ])("refuses inconsistent/stale/unbounded preview data", async value => {
    await act(async () => render());await act(async () => button().click());await act(async () => pending[0].resolve(reply(value)))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be read safely")
    expect(container.textContent).not.toContain("2026-10-31")
  })
  it.each(["WORKFORCE_POLICY_WINDOW_CONFLICT","WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED","WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID","__proto__"])("uses only localized fixed409 copy for %s", async code => {
    await act(async () => render());await act(async () => button().click());await act(async () => pending[0].resolve(reply(null,409,code)))
    expect(container.querySelector('[role="alert"]')).not.toBeNull();expect(container.textContent).not.toMatch(/PRIVATE_ERROR_PAYLOAD|__proto__/)
  })
  it("uses the real parent session key to abort/reset a pending read on tenant/principal change", async () => {
    await act(async () => render("en", choice, true))
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>("input")!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Policy")
      input.dispatchEvent(new Event("input",{ bubbles:true }))
    })
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })))
    await act(async () => pending[0].resolve(new Response(JSON.stringify({success:true,data:{policies:[{...choice,team:null}],query:"Policy",limit:20,hasMore:false}}))))
    await act(async () => {
      const to = container.querySelector<HTMLSelectElement>("#workforce-policy-version-to")!;to.value=choice.id;to.dispatchEvent(new Event("change",{bubbles:true}))
    })
    await act(async () => button().click());expect(pending).toHaveLength(2)
    auth.user={id:"other-reader",organizationId:"other-org"};await act(async () => render("en",choice,true))
    expect(pending[1].signal.aborted).toBe(true);expect(button().disabled).toBe(true)
    await act(async () => pending[1].resolve(reply()))
    expect(container.textContent).not.toContain("2026-10-31");expect(container.querySelector<HTMLSelectElement>("#workforce-policy-version-to")!.value).toBe("")
  })
})
