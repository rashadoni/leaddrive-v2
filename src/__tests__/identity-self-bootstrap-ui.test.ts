// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider, createTranslator } from "next-intl"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { IdentitySelfBootstrap } from "@/components/mtm/identity-self-bootstrap"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const fetchMock = vi.fn<typeof fetch>()
let root: Root, container: HTMLDivElement
const messages = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const p = createTranslator({ locale: "ru", messages, namespace: "personnel" })
const reply = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })
const click = async (label: string) => act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === p(label))!.click())
async function type(label: string, value: string) {
  await act(async () => {
    const input = [...container.querySelectorAll("label")].find(l => l.textContent === p(label))!.querySelector("input")!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
beforeEach(async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    if (body.action === "review") return reply({ name: "Fixture administrator", phone: "+994507770099", sourceRevision: "a".repeat(64), applications: [{ application: "CRM", role: "admin" }] })
    if (body.action === "request") return reply({ proofId: "fixture-proof", delivery: "SENT" })
    if (body.action === "confirm") return reply({ setupToken: ["lds1", "fixture"].join(".") })
    return reply({ signInRequired: true })
  })
  const props = { locale: "ru", messages, timeZone: "Asia/Baku", children: createElement(IdentitySelfBootstrap, { onClose: vi.fn() }) }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
describe("administrator self-bootstrap UI", () => {
  it("shows the conflicting card without authorizing a link and clears stale details when the phone changes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT", conflicts: [
      { id: "fixture/card", kind: "field", name: "Fictional field card", active: false, ownerName: "Other fictional user" },
      { id: "fixture-time", kind: "time", name: "Fictional time card", active: true, ownerName: null },
      { id: "fixture-crm", kind: "crm", name: "Fictional CRM user", active: true, ownerName: null },
    ] }), { status: 409 }))
    await type("identitySetupOwnPhone", "+994507770099"); await click("identitySetupReview")
    expect(container.textContent).toContain("Fictional field card")
    expect(container.textContent).toContain(p("identitySetupConflictOwner", { name: "Other fictional user" }))
    expect(container.textContent).toContain(p("identitySetupConflictUnlinked"))
    const links = [...container.querySelectorAll("a")]
    expect(links.map(a => a.getAttribute("href"))).toEqual(["/mtm/agents/fixture%2Fcard", "/mtm/attendance/people/fixture-time", "/settings/users"])
    expect(links.every(a => a.target === "_blank" && a.rel.includes("noopener"))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull()
    await type("identitySetupOwnPhone", "+994507770098")
    expect(container.querySelector('[data-testid="identity-phone-conflicts"]')).toBeNull()
  })
  it("ignores unrecognized conflict payloads and never renders supplied URLs or extra sensitive fields", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT", conflicts: [
      { id: "fixture", kind: "field", name: "Private payload", active: true, ownerName: null, phone: "+994507770099", href: "https://unexpected.example" },
    ] }), { status: 409 }))
    await click("identitySetupReview")
    expect(container.querySelectorAll("a")).toHaveLength(0)
    expect(container.textContent).not.toContain("Private payload")
    expect(container.textContent).toContain(p("identitySetupPhoneConflict"))
  })
  it("reviews the administrator's own identity before sending and requires a fresh login after password setup", async () => {
    expect(container.textContent).toContain(p("identitySetupOwnPhone"))
    await type("identitySetupOwnPhone", "+994507770099"); await click("identitySetupReview")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Fixture administrator")
    expect(container.textContent).toContain(p("identitySetupCrm", { role: "admin" }))
    await click("identitySetupSend")
    const requested = JSON.parse(String(fetchMock.mock.calls[1][1]!.body))
    expect(requested).toMatchObject({ action: "request", phone: "+994507770099", sourceRevision: "a".repeat(64) })
    expect(requested).not.toHaveProperty("userId"); expect(requested).not.toHaveProperty("applications")
    await type("identitySetupCode", "123456"); await click("identitySetupConfirm")
    expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull()
    await type("identitySetupPassword", "Fictional!Admin482"); await type("identitySetupPasswordRepeat", "different")
    await click("identitySetupFinish")
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(container.textContent).toContain(p("identitySetupPasswordMismatch"))
    await type("identitySetupPasswordRepeat", "Fictional!Admin482"); await click("identitySetupFinish")
    expect(container.textContent).toContain(p("identitySetupDone"))
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/login?callbackUrl=%2Fmtm%2Fattendance%2Fpeople")
  })
  it.each([
    ["IDENTITY_SELF_BOOTSTRAP_PHONE_MISMATCH", "identitySetupPhoneMismatch"],
    ["IDENTITY_SELF_BOOTSTRAP_PHONE_CONFLICT", "identitySetupPhoneConflict"],
    ["IDENTITY_SELF_BOOTSTRAP_PHONE_INVALID", "identitySetupPhoneInvalid"],
    ["IDENTITY_SELF_BOOTSTRAP_TENANT_ADMIN_REQUIRED", "identitySetupTenantAdminRequired"],
    ["IDENTITY_SELF_BOOTSTRAP_CARD_REVIEW_REQUIRED", "identitySetupCardReviewRequired"],
    ["IDENTITY_SELF_BOOTSTRAP_APPLICATION_UNAVAILABLE", "identitySetupApplicationUnavailable"],
    ["IDENTITY_ADMIN_REQUIRED", "identitySetupSessionRequired"],
  ])("explains %s without advancing or requesting a WhatsApp code", async (code, message) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: code }), { status: 409 }))
    await type("identitySetupOwnPhone", "+994507770099"); await click("identitySetupReview")
    expect(container.textContent).toContain(p(message))
    expect(container.textContent).not.toContain(code)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull()
    expect(container.querySelector('input[type="tel"]')?.getAttribute("value")).toBe("+994507770099")
  })
  it("does not advance to code entry after a denied review or leak server details", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "PRIVATE_FAILURE_DETAILS" }), { status: 403 }))
    await type("identitySetupOwnPhone", "+994507770099"); await click("identitySetupReview")
    expect(container.textContent).toContain(p("identitySetupFailed"))
    expect(container.textContent).not.toContain("PRIVATE_FAILURE_DETAILS")
    expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull()
  })
})
