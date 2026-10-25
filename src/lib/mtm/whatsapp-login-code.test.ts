import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/whatsapp", () => ({ resolveWhatsAppConfig: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (work: () => unknown) => work() }))
import { sendLoginCodeToWhatsApp, resetLoginCodeAvailability, loginCodeTemporarilyUnavailable } from "./whatsapp-login-code"
const sender = { id: "sender", organizationId: "sender-org", accessToken: "fixture", phoneNumberId: "fixture", businessAccountId: null, verifyToken: null, appSecret: null, displayName: null }
const input = { to: "+994507770014", code: "123456", language: "ru" }
beforeEach(() => resetLoginCodeAvailability())
describe("recovery provider lease", () => {
  it("never sends after the caller's lease was aborted", async () => {
    const controller = new AbortController(); controller.abort()
    const fetch = vi.fn()
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch, signal: controller.signal, singleAttempt: true })).toEqual({ status: "failed", reason: "timeout" })
    expect(fetch).not.toHaveBeenCalled()
  })
  it("makes one request on missing translation and does not disable other languages", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 }))
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch, singleAttempt: true })).toEqual({ status: "unavailable", reason: "template_language_missing" })
    expect(fetch).toHaveBeenCalledOnce(); expect(loginCodeTemporarilyUnavailable()).toBe(false)
  })
  it("propagates lease cancellation to the actual provider request", async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      controller.abort(); expect(init.signal.aborted).toBe(true)
      throw new Error("fictional transport aborted")
    })
    expect((await sendLoginCodeToWhatsApp(sender, input, { fetch, signal: controller.signal, singleAttempt: true })).status).toBe("failed")
    expect(fetch).toHaveBeenCalledOnce()
  })
})
