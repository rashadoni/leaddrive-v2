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
  it("does not advance to code entry after a denied review or leak server details", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "PRIVATE_FAILURE_DETAILS" }), { status: 403 }))
    await type("identitySetupOwnPhone", "+994507770099"); await click("identitySetupReview")
    expect(container.textContent).toContain(p("identitySetupFailed"))
    expect(container.textContent).not.toContain("PRIVATE_FAILURE_DETAILS")
    expect(container.querySelector('input[autocomplete="one-time-code"]')).toBeNull()
  })
})
