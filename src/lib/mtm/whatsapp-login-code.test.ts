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
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch, signal: controller.signal })).toEqual({ status: "failed", reason: "timeout" })
    expect(fetch).not.toHaveBeenCalled()
  })
  it("tries another language only after an explicit no-send template rejection", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "fixture-ack" }] }), { status: 200 }))
    expect(await sendLoginCodeToWhatsApp(sender, input, { fetch })).toEqual({ status: "sent", messageId: "fixture-ack", language: "az" })
    expect(fetch).toHaveBeenCalledTimes(2); expect(loginCodeTemporarilyUnavailable()).toBe(false)
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
