import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/crypto/tenant-data-keys", () => ({ ensureTenantDataKeys: vi.fn() }))

import { createStationRecordingHandler } from "@/lib/calls/station-recording-upload"
import { isPhoneWave, MAX_RECORDING_BYTES } from "@/lib/calls/station-recordings"

/** Owner, 2026-10-31: «нужно чтоб и диалог записывался». */
const token = "t".repeat(48)
const CALL = "17492d7a-9aff-416e-b329-dc405eda13a4"
const now = Date.now()
const line = {
  version: 1, enabled: true, purpose: "zeytun_line", id: "dddddddd-1111-4111-8111-111111111111",
  organizationId: "org-zeytun", channelConfigId: "channel-zeytun",
  issuedAt: new Date(now - 60_000).toISOString(), approvalReference: "owner-2026-10-24",
  approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64) }, orderOrganizationId: "org-zeytun",
}
const rehearsal = {
  version: 1, enabled: true, purpose: "owner_inbound_preview", id: "aaaaaaaa-1111-4111-8111-111111111111",
  organizationId: "org-zeytun", channelConfigId: "channel-zeytun", testPhoneE164: "+994500000001",
  issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), approvalReference: "test",
  approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64), catalogVersion: "b".repeat(64) },
}
const lineCall = { id: "call-log-1", organizationId: "org-zeytun", channelConfigId: "channel-zeytun", providerCallId: CALL }

function wave(format = 7, bytes = 8000) {
  const body = Buffer.alloc(bytes)
  const head = Buffer.alloc(44)
  head.write("RIFF", 0, "latin1"); head.writeUInt32LE(36 + bytes, 4); head.write("WAVE", 8, "latin1")
  head.write("fmt ", 12, "latin1"); head.writeUInt32LE(16, 16); head.writeUInt16LE(format, 20)
  head.write("data", 36, "latin1"); head.writeUInt32LE(bytes, 40)
  return Buffer.concat([head, body])
}

function setup(options: { config?: unknown; call?: unknown } = {}) {
  const store = vi.fn(async () => undefined)
  const loadCall = vi.fn(async () => options.call === undefined ? lineCall : options.call)
  const handle = createStationRecordingHandler({
    token, store, loadCall,
    loadConfig: async () => options.config === undefined ? line : options.config,
  })
  return { store, loadCall, handle }
}
function post(body: Buffer, headers: Record<string, string> = {}, callId = CALL) {
  return new Request(`https://crm.test/api/internal/asterisk/call-recording?callId=${callId}`, {
    method: "POST", body: new Uint8Array(body),
    headers: { authorization: `Bearer ${token}`, "content-type": "audio/wav", "content-length": String(body.byteLength), ...headers },
  })
}

describe("the station's recording of a line call", () => {
  it("keeps it for the line's own call, under that call", async () => {
    const f = setup()
    const response = await f.handle(post(wave()))
    expect(response.status).toBe(200)
    expect(f.store).toHaveBeenCalledWith("org-zeytun", "call-log-1", expect.any(Uint8Array))
    expect(f.loadCall).toHaveBeenCalledWith(expect.objectContaining({ purpose: "zeytun_line" }), CALL)
  })

  it("refuses anything but the station's token and a phone WAVE", async () => {
    const f = setup()
    expect((await f.handle(post(wave(), { authorization: "Bearer " + "x".repeat(48) }))).status).toBe(401)
    expect((await f.handle(post(wave(), {}, "not-a-call"))).status).toBe(400)
    expect((await f.handle(post(wave(), { "content-type": "application/json" }))).status).toBe(415)
    expect((await f.handle(post(Buffer.from("not a wave at all, really not")))).status).toBe(400)
    expect((await f.handle(post(wave(3)))).status).toBe(400)
    expect((await f.handle(post(wave(7, 16), { "content-length": String(MAX_RECORDING_BYTES + 1) }))).status).toBe(413)
    expect(f.store).not.toHaveBeenCalled()
  })

  it("is refused for good for a call that is not the line's, and asked again when the line cannot be read", async () => {
    for (const [options, status] of [
      [{ config: rehearsal }, 403],
      [{ call: null }, 404],
      [{ call: { ...lineCall, channelConfigId: "other-channel" } }, 404],
      [{ call: { ...lineCall, organizationId: "other-org" } }, 404],
      [{ config: null }, 409],
    ] as const) {
      const f = setup(options)
      expect((await f.handle(post(wave()))).status).toBe(status)
      expect(f.store).not.toHaveBeenCalled()
    }
  })

  it("takes linear PCM and mu-law, nothing else, and nothing over the proxy's limit", () => {
    expect(isPhoneWave(wave(1))).toBe(true)
    expect(isPhoneWave(wave(7))).toBe(true)
    expect(isPhoneWave(wave(85))).toBe(false)
    expect(isPhoneWave(wave(7, MAX_RECORDING_BYTES))).toBe(false)
    // Next's proxy passes the first 10 MB of a body to the route.
    expect(MAX_RECORDING_BYTES).toBeLessThan(10 * 1024 * 1024)
  })
})
