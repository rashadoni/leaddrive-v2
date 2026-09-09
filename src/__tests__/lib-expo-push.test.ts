/**
 * Expo Push client — token validation + the send wrapper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isExpoPushToken, sendExpoPush } from "@/lib/push/expo-push"

describe("isExpoPushToken", () => {
  it("accepts a well-formed ExponentPushToken", () => {
    expect(isExpoPushToken("ExponentPushToken[abc123]")).toBe(true)
  })
  it("rejects empty brackets, wrong prefix, non-strings", () => {
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false)
    expect(isExpoPushToken("abc123")).toBe(false)
    expect(isExpoPushToken("FCM[x]")).toBe(false)
    expect(isExpoPushToken(null)).toBe(false)
    expect(isExpoPushToken(123)).toBe(false)
  })
})

describe("sendExpoPush", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("POSTs valid messages to the Expo endpoint with sound defaulted", async () => {
    const n = await sendExpoPush([{ to: "ExponentPushToken[a]", title: "T", body: "B" }])
    expect(n).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://exp.host/--/api/v2/push/send")
    expect(opts.method).toBe("POST")
    const sent = JSON.parse(opts.body)
    expect(sent[0]).toMatchObject({ to: "ExponentPushToken[a]", title: "T", body: "B", sound: "default" })
  })

  it("drops malformed tokens and no-ops (no fetch) when none remain", async () => {
    const n = await sendExpoPush([{ to: "not-a-token", title: "T", body: "B" }])
    expect(n).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 0 and does not fetch for an empty batch", async () => {
    expect(await sendExpoPush([])).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never throws when the network/HTTP fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    await expect(sendExpoPush([{ to: "ExponentPushToken[a]", title: "T", body: "B" }])).resolves.toBe(1)
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    await expect(sendExpoPush([{ to: "ExponentPushToken[a]", title: "T", body: "B" }])).resolves.toBe(1)
  })
})
