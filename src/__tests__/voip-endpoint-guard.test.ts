import { afterEach, describe, expect, it, vi } from "vitest"

import {
  requestVoipEndpoint,
  validateVoipEndpoint,
  validateVoipSettingsEndpoint,
  voipEndpointFingerprint,
  VoipEndpointSecurityError,
  type VoipEndpointTransport,
} from "@/lib/voip/endpoint-guard"

const publicResolver = vi.fn(async () => [
  { address: "93.184.216.34", family: 4 as const },
])

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("VoIP endpoint SSRF guard", () => {
  it("allows public HTTPS only after resolving every address", async () => {
    const target = await validateVoipEndpoint("https://pbx.example.com", {
      resolver: publicResolver,
      privateOrigins: [],
    })

    expect(publicResolver).toHaveBeenCalledWith("pbx.example.com")
    expect(target.url.origin).toBe("https://pbx.example.com")
    expect(target.addresses).toEqual([{ address: "93.184.216.34", family: 4 }])
    expect(target.privateOriginAllowlisted).toBe(false)
  })

  it("rejects public DNS with any private answer", async () => {
    const mixedResolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "10.0.0.7", family: 4 as const },
    ])

    await expect(validateVoipEndpoint("https://pbx.example.com", {
      resolver: mixedResolver,
      privateOrigins: [],
    })).rejects.toBeInstanceOf(VoipEndpointSecurityError)
  })

  it("requires an exact origin before allowing an on-prem address or HTTP", async () => {
    const privateResolver = vi.fn(async () => [
      { address: "10.20.30.40", family: 4 as const },
    ])

    await expect(validateVoipEndpoint("https://pbx.internal:5001", {
      resolver: privateResolver,
      privateOrigins: [],
    })).rejects.toBeInstanceOf(VoipEndpointSecurityError)
    await expect(validateVoipEndpoint("http://pbx.internal:5001", {
      resolver: privateResolver,
      privateOrigins: ["https://pbx.internal:5001"],
    })).rejects.toThrow("exact VOIP_PRIVATE_ENDPOINT_ALLOWLIST origin")

    const allowed = await validateVoipEndpoint("http://pbx.internal:5001/api", {
      resolver: privateResolver,
      privateOrigins: ["http://pbx.internal:5001"],
    })
    expect(allowed.privateOriginAllowlisted).toBe(true)
    expect(allowed.addresses).toEqual([{ address: "10.20.30.40", family: 4 }])
  })

  it("fails closed for malformed or wildcard environment allowlists", async () => {
    vi.stubEnv("VOIP_PRIVATE_ENDPOINT_ALLOWLIST", "http://*.internal:8088")

    await expect(validateVoipEndpoint("https://pbx.example.com", {
      resolver: publicResolver,
    })).rejects.toThrow("does not support wildcards")
  })

  it("pins the validated address and revalidates every redirect hop", async () => {
    const resolver = vi.fn(async (hostname: string) => [{
      address: hostname === "pbx-a.internal" ? "10.0.0.10" : "10.0.0.11",
      family: 4 as const,
    }])
    const transport = vi.fn<VoipEndpointTransport>()
      .mockResolvedValueOnce({
        status: 307,
        headers: { location: "https://pbx-b.internal:8443/final" },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode('{"ok":true}'),
      })

    const response = await requestVoipEndpoint(
      "https://pbx-a.internal:8443/start",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: "{}",
      },
      {
        resolver,
        privateOrigins: [
          "https://pbx-a.internal:8443",
          "https://pbx-b.internal:8443",
        ],
        transport,
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[0]?.[0].addresses).toEqual([
      { address: "10.0.0.10", family: 4 },
    ])
    expect(transport.mock.calls[1]?.[0].addresses).toEqual([
      { address: "10.0.0.11", family: 4 },
    ])
    expect(transport.mock.calls[0]?.[1].headers.authorization).toBe("Bearer secret")
    expect(transport.mock.calls[1]?.[1].headers.authorization).toBeUndefined()
  })

  it("blocks a redirect to an unlisted private origin before a second request", async () => {
    const resolver = vi.fn(async () => [{ address: "10.0.0.10", family: 4 as const }])
    const transport = vi.fn<VoipEndpointTransport>().mockResolvedValueOnce({
      status: 302,
      headers: { location: "http://127.0.0.1:3000/admin" },
    })

    await expect(requestVoipEndpoint(
      "http://pbx.internal:8088/start",
      { method: "POST", body: "{}" },
      {
        resolver,
        privateOrigins: ["http://pbx.internal:8088"],
        transport,
      },
    )).rejects.toBeInstanceOf(VoipEndpointSecurityError)
    expect(transport).toHaveBeenCalledOnce()
  })

  it("never exposes a non-success response body", async () => {
    const transport = vi.fn<VoipEndpointTransport>().mockResolvedValue({
      status: 500,
      headers: { "content-type": "text/plain" },
      body: new TextEncoder().encode("internal metadata secret"),
    })

    const response = await requestVoipEndpoint("https://pbx.example.com/status", {}, {
      resolver: publicResolver,
      privateOrigins: [],
      transport,
    })

    expect(response.status).toBe(500)
    await expect(response.text()).resolves.toBe("")
  })

  it("applies the same network policy while validating persisted settings", async () => {
    const privateResolver = vi.fn(async () => [
      { address: "192.168.10.20", family: 4 as const },
    ])

    await expect(validateVoipSettingsEndpoint({
      provider: "asterisk",
      ariHost: "192.168.10.20",
      ariPort: 8088,
    }, {
      resolver: privateResolver,
      privateOrigins: [],
    })).rejects.toBeInstanceOf(VoipEndpointSecurityError)

    await expect(validateVoipSettingsEndpoint({
      provider: "asterisk",
      ariHost: "192.168.10.20",
      ariPort: 8088,
    }, {
      resolver: privateResolver,
      privateOrigins: ["http://192.168.10.20:8088"],
    })).resolves.toBeUndefined()

    await expect(validateVoipSettingsEndpoint({
      provider: "threecx",
      serverUrl: "https://pbx.example.com/control",
    }, {
      resolver: publicResolver,
      privateOrigins: [],
    })).rejects.toThrow("without a path or query")
  })
})

describe("VoIP endpoint fingerprint", () => {
  const asterisk = (overrides: Record<string, unknown> = {}) => ({
    provider: "asterisk",
    ariHost: "pbx.internal",
    ariPort: 8088,
    ...overrides,
  })

  it("ignores everything the network policy does not read", () => {
    expect(voipEndpointFingerprint(asterisk({
      voiceAgentPrompt: "old",
      username: "user",
    }))).toBe(voipEndpointFingerprint(asterisk({
      voiceAgentPrompt: "new",
      username: "other",
    })))
  })

  it("separates every field the network policy does read", () => {
    const base = voipEndpointFingerprint(asterisk())
    expect(voipEndpointFingerprint(asterisk({ ariHost: "other.internal" }))).not.toBe(base)
    expect(voipEndpointFingerprint(asterisk({ ariPort: 8089 }))).not.toBe(base)
    expect(voipEndpointFingerprint({
      provider: "threecx",
      serverUrl: "https://pbx.internal:8088",
    })).not.toBe(base)
    expect(voipEndpointFingerprint({
      provider: "custom-sip",
      sipServer: "sip.internal",
      sipPort: 5061,
      transport: "wss",
    })).not.toBe(voipEndpointFingerprint({
      provider: "custom-sip",
      sipServer: "sip.internal",
      sipPort: 5061,
      transport: "tls",
    }))
  })

  it("reports nothing to compare in exactly the cases the validator does not probe", async () => {
    const cases = [
      { provider: "twilio", accountSid: "AC1" },
      asterisk({ ariHost: "   " }),
      { provider: "threecx", serverUrl: "" },
      { provider: "custom-sip", sipServer: "sip.internal", sipPort: 5060, transport: "udp" },
    ]

    for (const settings of cases) {
      expect(voipEndpointFingerprint(settings)).toBeNull()
      await expect(validateVoipSettingsEndpoint(settings, {
        resolver: publicResolver,
        privateOrigins: [],
      })).resolves.toBeUndefined()
    }
    expect(publicResolver).not.toHaveBeenCalled()
  })
})
