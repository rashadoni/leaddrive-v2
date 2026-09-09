import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock global fetch so we can inspect the outbound request and stub responses.
// ---------------------------------------------------------------------------
const fetchMock = vi.fn()
global.fetch = fetchMock as any

import { atlProvider } from "@/lib/sms/providers/atl"

beforeEach(() => {
  fetchMock.mockReset()
  process.env.ATL_LOGIN = ""
  process.env.ATL_PASSWORD = ""
  process.env.ATL_TITLE = ""
})

function okResponse(xml: string) {
  return { ok: true, status: 200, text: async () => xml, json: async () => ({}) }
}

describe("ATL provider — isConfigured", () => {
  it("is false when nothing is set", () => {
    expect(atlProvider.isConfigured({})).toBe(false)
  })

  it("reads from settings first, env as fallback", () => {
    expect(atlProvider.isConfigured({ atlLogin: "l", atlPassword: "p", atlTitle: "T" })).toBe(true)

    process.env.ATL_LOGIN = "l"
    process.env.ATL_PASSWORD = "p"
    process.env.ATL_TITLE = "T"
    expect(atlProvider.isConfigured({})).toBe(true)
  })

  it("requires all three — login, password, AND title", () => {
    expect(atlProvider.isConfigured({ atlLogin: "l", atlPassword: "p" })).toBe(false)
    expect(atlProvider.isConfigured({ atlLogin: "l", atlTitle: "T" })).toBe(false)
    expect(atlProvider.isConfigured({ atlPassword: "p", atlTitle: "T" })).toBe(false)
  })
})

describe("ATL provider — send", () => {
  const settings = { atlLogin: "testa", atlPassword: "test12345!", atlTitle: "TEST" }

  it("posts XML body to the ATL endpoint with all required elements", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<?xml version="1.0" encoding="UTF-8"?><response><head><responsecode>000</responsecode></head><body><taskid>4837</taskid></body></response>`
    ))

    const res = await atlProvider.send(settings, {
      to: "+994501234567",
      message: "Hello world",
    })

    expect(res.success).toBe(true)
    expect(res.messageId).toBe("4837")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/atlsms\.az/)
    expect((init as any).method).toBe("POST")
    expect((init as any).headers["Content-Type"]).toMatch(/xml/i)

    const body = (init as any).body as string
    expect(body).toContain("<operation>submit</operation>")
    expect(body).toContain("<login>testa</login>")
    expect(body).toContain("<password>test12345!</password>")
    expect(body).toContain("<title>TEST</title>")
    expect(body).toContain("<bulkmessage>Hello world</bulkmessage>")
    expect(body).toContain("<scheduled>now</scheduled>")
    expect(body).toContain("<isbulk>true</isbulk>")
    expect(body).toMatch(/<controlid>[^<]{1,49}<\/controlid>/)
    expect(body).toContain("<msisdn>994501234567</msisdn>")
  })

  it("strips leading + and non-digits from the phone number", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>000</responsecode></head><body><taskid>1</taskid></body></response>`
    ))

    await atlProvider.send(settings, { to: "+994 (50) 123-45-67", message: "hi" })
    const body = (fetchMock.mock.calls[0][1] as any).body as string
    expect(body).toContain("<msisdn>994501234567</msisdn>")
  })

  it("escapes XML-unsafe characters in the message body", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>000</responsecode></head><body><taskid>1</taskid></body></response>`
    ))

    await atlProvider.send(settings, {
      to: "994501234567",
      message: `A & B <script> "quoted" 'apos'`,
    })
    const body = (fetchMock.mock.calls[0][1] as any).body as string
    expect(body).toContain("A &amp; B &lt;script&gt; &quot;quoted&quot; &apos;apos&apos;")
    // Make sure no raw '<' or '&' leaked inside the bulkmessage element
    const inner = body.match(/<bulkmessage>([\s\S]*?)<\/bulkmessage>/)?.[1] ?? ""
    expect(inner).not.toContain("<script>")
    expect(inner).not.toContain(" & B")
  })

  it("uses params.from as title when provided (overrides settings/env)", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>000</responsecode></head><body><taskid>9</taskid></body></response>`
    ))

    await atlProvider.send(settings, {
      to: "994501234567",
      message: "x",
      from: "CUSTOM_BRAND",
    })
    const body = (fetchMock.mock.calls[0][1] as any).body as string
    expect(body).toContain("<title>CUSTOM_BRAND</title>")
  })

  it("returns error when credentials missing", async () => {
    const res = await atlProvider.send({}, { to: "994501234567", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns error when phone number is too short/invalid", async () => {
    const res = await atlProvider.send(settings, { to: "+12", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/invalid phone/i)
  })

  it("maps response code 105 to 'Invalid credentials'", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>105</responsecode></head></response>`
    ))
    const res = await atlProvider.send(settings, { to: "994501234567", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/invalid credentials/i)
  })

  it("maps response code 118 to 'Not enough units'", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>118</responsecode></head></response>`
    ))
    const res = await atlProvider.send(settings, { to: "994501234567", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not enough units/i)
  })

  it("maps response code 235 to sender-title error", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>235</responsecode></head></response>`
    ))
    const res = await atlProvider.send(settings, { to: "994501234567", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/invalid sender title/i)
  })

  it("returns error on HTTP non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "Service down" })
    const res = await atlProvider.send(settings, { to: "994501234567", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/ATL HTTP 503/)
  })

  it("returns error when fetch throws (network fault)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"))
    const res = await atlProvider.send(settings, { to: "994501234567", message: "x" })
    expect(res.success).toBe(false)
    expect(res.error).toBe("ECONNRESET")
  })

  it("generates controlid that fits ATL's 49-character limit", async () => {
    fetchMock.mockResolvedValue(okResponse(
      `<response><head><responsecode>000</responsecode></head><body><taskid>1</taskid></body></response>`
    ))

    // Send 3 in a row — each controlid must be unique
    await atlProvider.send(settings, { to: "994501234567", message: "1" })
    await atlProvider.send(settings, { to: "994501234567", message: "2" })
    await atlProvider.send(settings, { to: "994501234567", message: "3" })

    const ids = fetchMock.mock.calls.map((c) => {
      const body = (c[1] as any).body as string
      return body.match(/<controlid>([^<]+)<\/controlid>/)?.[1]
    })
    expect(new Set(ids).size).toBe(3) // all distinct
    for (const id of ids) {
      expect(id!.length).toBeLessThanOrEqual(49)
      expect(id!.length).toBeGreaterThan(0)
    }
  })
})
