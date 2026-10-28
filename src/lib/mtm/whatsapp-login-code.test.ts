import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/whatsapp", () => ({ resolveWhatsAppConfig: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (work: () => unknown) => work() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { sendLoginCodeToWhatsApp, resetLoginCodeAvailability, loginCodeTemporarilyUnavailable, loginCodeSenderFor } from "./whatsapp-login-code"
const sender = { id: "sender", organizationId: "sender-org", accessToken: "fixture", phoneNumberId: "fixture", businessAccountId: null, verifyToken: null, appSecret: null, displayName: null }
const input = { to: "+994507770014", code: "123456", language: "ru" }
beforeEach(() => resetLoginCodeAvailability())
describe("recovery provider lease", () => {
  it("never sends after the caller's lease was aborted", async () => {
    const controller = new AbortController(); controller.abort()
    const fetch = vi.fn()
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch, signal: controller.signal })).toEqual({ status: "failed", reason: "timeout" })
    expect(fetch).not.toHaveBeenCalled()
  })
  it("tries another language only after an explicit no-send template rejection", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "fixture-ack" }] }), { status: 200 }))
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch })).toEqual({ status: "sent", messageId: "fixture-ack", language: "az" })
    expect(fetch).toHaveBeenCalledTimes(2); expect(loginCodeTemporarilyUnavailable(sender)).toBe(false)
  })
  it("propagates lease cancellation to the actual provider request", async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      controller.abort(); expect(init.signal.aborted).toBe(true)
      throw new Error("fictional transport aborted")
    })
    expect((await sendLoginCodeToWhatsApp(sender, input, { fetch, signal: controller.signal })).status).toBe("failed")
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe("which number sends a company's codes", () => {
  const env = { MTM_LOGIN_CODE_SENDER_ORGANIZATION_ID: "leaddrive-org" }
  it("sends Zeytun's codes from Zeytun's own number, looked up in Zeytun's own organization", () => {
    expect(loginCodeSenderFor("cmu9ih71e01vbkpd4fvgjhlba", env)).toEqual({ organizationId: "cmu9ih71e01vbkpd4fvgjhlba", phoneNumberId: "1421873671003286" })
  })
  it("sends every other company's codes from LeadDrive's named number, not the first active channel", () => {
    expect(loginCodeSenderFor("another-company", env)).toEqual({ organizationId: "leaddrive-org", phoneNumberId: "984538588084578" })
    expect(loginCodeSenderFor("another-company", { ...env, MTM_LOGIN_CODE_SENDER_PHONE_NUMBER_ID: "555" })).toEqual({ organizationId: "leaddrive-org", phoneNumberId: "555" })
    expect(loginCodeSenderFor("another-company", {})).toBeNull()
  })
  it("refuses a broken company override instead of falling back to another sender", () => {
    expect(() => loginCodeSenderFor("another-company", { ...env, MTM_LOGIN_CODE_COMPANY_SENDERS: "{oops" })).toThrow(/MTM_LOGIN_CODE_COMPANY_SENDERS/)
    expect(() => loginCodeSenderFor("another-company", { ...env, MTM_LOGIN_CODE_COMPANY_SENDERS: '{"x":7}' })).toThrow(/MTM_LOGIN_CODE_COMPANY_SENDERS/)
  })
  it("keeps one number's missing template from silencing another number", async () => {
    const missing = () => new Response(JSON.stringify({ error: { code: 132001 } }), { status: 404 })
    const fetch = vi.fn().mockImplementation(async () => missing())
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch })).toEqual({ status: "unavailable", reason: "template_missing" })
    expect(loginCodeTemporarilyUnavailable(sender)).toBe(true)
    expect(loginCodeTemporarilyUnavailable({ phoneNumberId: "another-number" })).toBe(false)
  })
})
