import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const endpointMocks = vi.hoisted(() => ({
  request: vi.fn(),
}))

vi.mock("@/lib/voip/endpoint-guard", () => ({
  requestVoipEndpoint: endpointMocks.request,
}))

import { ThreeCxProvider, __resetThreeCxTokenCache } from "@/lib/voip/providers/threecx"

describe("ThreeCxProvider", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    endpointMocks.request.mockReset()
    endpointMocks.request.mockImplementation((input, init) => fetchMock(input, init))
    // Access tokens are cached per (server, client, secret) across requests —
    // clear it so each case starts from an unauthenticated adapter.
    __resetThreeCxTokenCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("gets a 3CX access token and sends the required makecall payload", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 42, callid: 9001 } }), { status: 202 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com/",
      extension: "101",
      apiKey: "secret",
    })

    const result = await provider.initiateCall({ toNumber: "+994512060838", fromNumber: "101" })

    expect(result).toEqual({ success: true, callSid: "9001" })
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://pbx.example.com/connect/token", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }))
    const tokenBody = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(tokenBody.get("client_id")).toBe("101")
    expect(tokenBody.get("client_secret")).toBe("secret")
    expect(tokenBody.get("grant_type")).toBe("client_credentials")
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://pbx.example.com/callcontrol/101/makecall", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer tok_123",
        "Content-Type": "application/json",
      }),
      // Stored as E.164, dialled in the national form the outbound rule matches.
      body: JSON.stringify({ destination: "0512060838", timeout: 30 }),
    }))
  })

  it("uses the participant id when callid is absent", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 42 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await expect(provider.initiateCall({ toNumber: "100", fromNumber: "101" })).resolves.toEqual({
      success: true,
      callSid: "42",
    })
  })

  it("returns a useful error when the token request fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid client", { status: 401 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "bad-secret",
    })

    await expect(provider.initiateCall({ toNumber: "100", fromNumber: "101" })).resolves.toEqual({
      success: false,
      error: "3CX connection failed: 3CX auth failed (401)",
    })
  })

  it("drops the participant id returned from makecall", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await expect(provider.endCall("42")).resolves.toEqual({ success: true })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://pbx.example.com/callcontrol/101/participants/42/drop", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tok_123" }),
    }))
  })

  it("fails the connection test when the extension has no registered device", async () => {
    // makecall rings the DN's own devices first, so an extension with nothing
    // signed in accepts the request and rings nobody — invisible at call time.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dn: "101", devices: [] }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    const result = await provider.testConnection()
    expect(result.success).toBe(false)
    expect(result.message).toContain("no registered device")
  })

  it("passes the connection test and reports how many devices are registered", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dn: "101", devices: [{ device_id: "dev-1" }] }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    const result = await provider.testConnection()
    expect(result.success).toBe(true)
    expect(result.message).toContain("1 registered device")
  })

  it("reuses a cached token instead of re-authenticating on every call", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 2 } }), { status: 200 }))

    const settings = {
      provider: "threecx" as const,
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    }

    await new ThreeCxProvider(settings).initiateCall({ toNumber: "100", fromNumber: "101" })
    await new ThreeCxProvider(settings).initiateCall({ toNumber: "200", fromNumber: "101" })

    // token + makecall + makecall — the second adapter skipped /connect/token.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][0]).toBe("https://pbx.example.com/callcontrol/101/makecall")
  })

  it("re-authenticates once when the cached token has expired server-side", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_old", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_new", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 77 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await expect(provider.initiateCall({ toNumber: "100", fromNumber: "101" })).resolves.toEqual({
      success: true,
      callSid: "77",
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer tok_new")
  })

  it("falls back to a registered device when the DN has none attached", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("no device", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ devices: [{ device_id: "dev-9" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 55 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await expect(provider.initiateCall({ toNumber: "100", fromNumber: "101" })).resolves.toEqual({
      success: true,
      callSid: "55",
    })
    expect(fetchMock.mock.calls[3][0]).toBe(
      "https://pbx.example.com/callcontrol/101/devices/dev-9/makecall",
    )
  })

  it("dials the AZ national form rather than the stored E.164 number", async () => {
    // The PBX outbound rule matches Prefix 0 / Length 10; "+994…" matches
    // nothing and the call is refused before it reaches the carrier.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 42 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await provider.initiateCall({ toNumber: "+994512060838", fromNumber: "101" })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      destination: "0512060838",
    })
  })

  it("keeps the stored number when the dial plan is configured as-is", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 43 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
      dialFormat: "as-is",
    })

    await provider.initiateCall({ toNumber: "+994512060838", fromNumber: "101" })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      destination: "+994512060838",
    })
  })

  it("refuses to dial a contact with no number instead of calling the PBX", async () => {
    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    const result = await provider.initiateCall({ toNumber: "  ", fromNumber: "101" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("no phone number")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("treats a 422 as a missing device and retries through the registered one", async () => {
    // Observed on a live v20 U9 PBX: dialling a DN with no phone attached
    // answers 422 with an empty body, not 404.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ devices: [{ device_id: "dev-7" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 66 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await expect(provider.initiateCall({ toNumber: "100", fromNumber: "101" })).resolves.toEqual({
      success: true,
      callSid: "66",
    })
    expect(fetchMock.mock.calls[3][0]).toBe(
      "https://pbx.example.com/callcontrol/101/devices/dev-7/makecall",
    )
  })

  it("names the extension when a 422 turns out to have no phone at all", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dn: "100", devices: [] }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "100",
      apiKey: "secret",
    })

    const result = await provider.initiateCall({ toNumber: "994512060838", fromNumber: "100" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("extension 100 has no registered phone")
    // The bare status code must not leak to the operator.
    expect(result.error).not.toContain("422")
  })

  it("does not claim a missing phone when the device probe itself fails", async () => {
    // A transient 500 on the device lookup must not be misread as "the DN has
    // no devices" — the phone may well be signed in.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 422 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "100",
      apiKey: "secret",
    })

    const result = await provider.initiateCall({ toNumber: "0512060838", fromNumber: "100" })
    expect(result.success).toBe(false)
    expect(result.error).not.toContain("has no registered phone")
    // Falls through to the honest 422 description instead.
    expect(result.error).toContain("422")
  })

  it("re-authenticates when the device-fallback attempt hits a stale token", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_old", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("no device", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ devices: [{ device_id: "dev-9" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_new", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 88 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    await expect(provider.initiateCall({ toNumber: "0512060838", fromNumber: "101" })).resolves.toEqual({
      success: true,
      callSid: "88",
    })
    expect(fetchMock.mock.calls[5][1].headers.Authorization).toBe("Bearer tok_new")
  })

  it("explains a Call Control permission failure instead of echoing the status", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      apiKey: "secret",
    })

    const result = await provider.initiateCall({ toNumber: "100", fromNumber: "101" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Call Control Access")
  })

  it("uses a separate client id when the API client is not the DN", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: 3 } }), { status: 200 }))

    const provider = new ThreeCxProvider({
      provider: "threecx",
      serverUrl: "https://pbx.example.com",
      extension: "101",
      clientId: "crm-app",
      apiKey: "secret",
    })

    await provider.initiateCall({ toNumber: "100", fromNumber: "101" })

    const tokenBody = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(tokenBody.get("client_id")).toBe("crm-app")
    // The call still originates from the DN, not from the client id.
    expect(fetchMock.mock.calls[1][0]).toBe("https://pbx.example.com/callcontrol/101/makecall")
  })
})
