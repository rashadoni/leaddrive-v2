import { createHash, createHmac } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const transportMocks = vi.hoisted(() => ({
  secureFetch: vi.fn(),
  voipFetch: vi.fn(),
}))

vi.mock("@/lib/voip/fanum-pbx-control-transport", () => ({
  secureFanumPbxControlFetch: transportMocks.secureFetch,
}))

vi.mock("@/lib/voip/endpoint-guard", () => ({
  requestVoipEndpoint: transportMocks.voipFetch,
}))

import { AsteriskProvider } from "@/lib/voip/providers/asterisk"

describe("AsteriskProvider", () => {
  const fetchMock = vi.fn()
  const suppliedCorrelationId = "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7"
  const updatedAt = "2026-08-10T08:00:00.000Z"
  const runtimeToken = "pbx-runtime-test-token"

  function provider() {
    return new AsteriskProvider({
      provider: "asterisk",
      voiceAttemptRegistryEnabled: true,
      organizationId: "org-1",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })
  }

  function ariIdentity(status = 200) {
    return new Response(JSON.stringify({
      system: { version: "20.0.0" },
      build: { os: "Linux" },
    }), { status, headers: { "Content-Type": "application/json" } })
  }

  function attempt(
    state: "not_accepted" | "accepted" | "active" | "terminal",
    options?: {
      callId?: string
      outcome?: string
      protocol?: string
      revision?: number
      status?: number
      updatedAt?: string
      method?: "PUT" | "GET" | "POST"
      pathname?: string
      signed?: boolean
      signatureBody?: string
      signaturePathname?: string
      signatureStatus?: number
      signature?: string
    },
  ) {
    const body = JSON.stringify({
      protocol: options?.protocol ?? "fanum-voice-attempt-v1",
      callId: options?.callId ?? suppliedCorrelationId,
      state,
      ...(state === "terminal" ? { outcome: options?.outcome ?? "connected" } : {}),
      revision: options?.revision ?? 7,
      updatedAt: options?.updatedAt ?? updatedAt,
    })
    const status = options?.status ?? 200
    const method = options?.method ?? "PUT"
    const pathname = options?.pathname
      ?? `/ari/fanum/voice-attempts/${suppliedCorrelationId}`
    const signatureMessage = [
      "fanum-voice-attempt-response-v1",
      method,
      options?.signaturePathname ?? pathname,
      String(options?.signatureStatus ?? status),
      createHash("sha256").update(options?.signatureBody ?? body, "utf8").digest("hex"),
    ].join("\n")
    const signature = options?.signature ?? `v1=${createHmac("sha256", runtimeToken)
      .update(signatureMessage, "utf8")
      .digest("hex")}`
    return new Response(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(options?.signed === false ? {} : { "X-Fanum-Voice-Signature": signature }),
      },
    })
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "true")
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "org-1")
    vi.stubEnv("FANUM_VOICE_RUNTIME_TOKEN", runtimeToken)
    fetchMock.mockReset()
    transportMocks.secureFetch.mockReset()
    transportMocks.voipFetch.mockReset()
    transportMocks.secureFetch.mockImplementation((input, init) => fetchMock(input, init))
    transportMocks.voipFetch.mockImplementation((input, init) => fetchMock(input, init))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("fails before network I/O when the last-chance maintenance fence is active", async () => {
    vi.stubEnv("VOICE_OUTBOUND_CALL_DISPATCH_PAUSED", "true")

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({
      success: false,
      error: "Outbound voice dispatch is paused for maintenance",
      failureCertainty: "definite_rejection",
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
  })

  it("honors the durable per-config maintenance fence without a process flag", async () => {
    const pausedProvider = new AsteriskProvider({
      provider: "asterisk",
      voiceAttemptRegistryEnabled: true,
      organizationId: "org-1",
      outboundCallDispatchPaused: true,
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    const result = await pausedProvider.initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: false,
      correlationId: suppliedCorrelationId,
    })

    expect(result.success).toBe(false)
    expect(result.failureCertainty).toBe("definite_rejection")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
  })

  it.each([undefined, "false", "TRUE", "typo"])(
    "fails closed without legacy originate when an opted-in registry has global value %s",
    async (globalValue) => {
      if (globalValue === undefined) vi.unstubAllEnvs()
      else vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", globalValue)
      if (globalValue === undefined) {
        vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "org-1")
        vi.stubEnv("FANUM_VOICE_RUNTIME_TOKEN", runtimeToken)
      }

      await expect(provider().initiateCall({
        toNumber: "200",
        fromNumber: "100",
        voiceAgent: false,
        correlationId: suppliedCorrelationId,
      })).resolves.toEqual({
        success: false,
        error: "Asterisk voice-attempt registry is not active",
        failureCertainty: "definite_rejection",
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(transportMocks.secureFetch).not.toHaveBeenCalled()
    },
  )

  it("refuses an opted-in non-pilot tenant before reading the shared HMAC token", async () => {
    const nonPilotProvider = new AsteriskProvider({
      provider: "asterisk",
      voiceAttemptRegistryEnabled: true,
      organizationId: "org-2",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(nonPilotProvider.testConnection()).resolves.toEqual({
      success: false,
      message: "Asterisk secure control tenant is not eligible.",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
  })

  it("fails closed when the pilot global registry is on but its row capability is off", async () => {
    const mismatchedPilotProvider = new AsteriskProvider({
      provider: "asterisk",
      organizationId: "org-1",
      voiceAttemptRegistryEnabled: false,
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(mismatchedPilotProvider.initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: false,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({
      success: false,
      error: "Asterisk voice-attempt registry capability is not active",
      failureCertainty: "definite_rejection",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
  })

  it("preserves legacy raw AI dispatch before the coordinated registry cutover", async () => {
    vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "false")
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel-ai" }), { status: 200 }))
    const legacyProvider = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(legacyProvider.initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({ success: true, callSid: suppliedCorrelationId })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(rawUrl)
    expect(url.pathname).toBe("/ari/channels")
    expect(url.searchParams.get("context")).toBe("fanum-ai-bridge")
    expect(url.searchParams.get("extension")).toBe("s")
    expect(JSON.parse(String(init.body))).toEqual({
      variables: {
        __FANUM_CALL_ID: suppliedCorrelationId,
        __FANUM_CALL_MODE: "ai",
        __FANUM_RECORD: "0",
      },
    })
  })

  it("never downgrades an opted-in config to direct ARI when the registry gate is rolled back", async () => {
    vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "false")

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({
      success: false,
      error: "Asterisk voice-attempt registry is not active",
      failureCertainty: "definite_rejection",
    })

    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps an unrelated Asterisk config on raw ARI when only the global gate is enabled", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel-1" }), { status: 200 }))
    const suppliedCorrelationId = "436d80f6-e435-4f80-93c5-7d6e6a61e779"

    const provider = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(provider.initiateCall({
      toNumber: "+15551234567",
      fromNumber: "100",
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({ success: true, callSid: suppliedCorrelationId })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(transportMocks.secureFetch).not.toHaveBeenCalled()
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(rawUrl)

    expect(url.pathname).toBe("/ari/channels")
    expect(url.searchParams.get("endpoint")).toBe("Local/+15551234567@outbound-routes/n")
    expect(url.searchParams.get("extension")).toBe("100")
    expect(url.searchParams.get("context")).toBe("outbound-routes")
    expect(url.searchParams.get("callerId")).toBe("100")
    expect(url.searchParams.get("channelId")).toBe(suppliedCorrelationId)
    expect(init).toEqual(expect.objectContaining({ method: "POST" }))
    expect(JSON.parse(String(init.body))).toEqual({
      variables: {
        __FANUM_CALL_ID: suppliedCorrelationId,
        __FANUM_CALL_MODE: "human",
        __FANUM_RECORD: "0",
      },
    })
  })

  it("routes a human call through the signed registry after coordinated cutover", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted"))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({ success: true, callSid: suppliedCorrelationId })

    const [rawUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(rawUrl).pathname).toBe(
      `/ari/fanum/voice-attempts/${suppliedCorrelationId}`,
    )
    expect(new URL(String(transportMocks.secureFetch.mock.calls[0][0])).protocol).toBe("https:")
    expect(new URL(String(transportMocks.secureFetch.mock.calls[1][0])).protocol).toBe("https:")
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: "Local/200@outbound-routes/n",
      extension: "100",
      context: "outbound-routes",
      callerId: "100",
      variables: {
        __FANUM_CALL_ID: suppliedCorrelationId,
        __FANUM_CALL_MODE: "human",
      },
    })
  })

  it("tells the station to record only when the organisation asked for it", async () => {
    // The VoIP screen has had a "record calls" switch from the beginning, the
    // call route has always passed `record` to the provider, and THIS adapter
    // ignored it — only the Twilio one ever read it, and this deployment is
    // Asterisk. Measured on the station on 2026-08-25: no MixMonitor anywhere
    // in the dialplan and a recordings directory untouched since April 2024,
    // not one file in it. The switch was a promise nothing kept, which is
    // worse than an absent feature because it is believed.
    //
    // On the direct-ARI path, where the originate body is the tenant's own and
    // nothing validates its shape. The registry path cannot carry it — see the
    // contract test below, which is the defect this assertion used to hide.
    vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "false")
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel-1" }), { status: 200 }))

    const direct = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(direct.initiateCall({
      toNumber: "200",
      fromNumber: "100",
      record: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({ success: true, callSid: suppliedCorrelationId })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sent = JSON.parse(String(init.body))
    expect(sent.variables.__FANUM_RECORD).toBe("1")
    // And the two values are the only ones the station will act on: it filters
    // this variable down to these characters before reading it, so anything
    // else it might receive means "do not record" instead of failing a call.
    expect(["0", "1"]).toContain(sent.variables.__FANUM_RECORD)
  })

  function missingAttempt(options?: { callId?: string; signed?: boolean; error?: string }) {
    const callId = options?.callId ?? suppliedCorrelationId
    const body = JSON.stringify({
      protocol: "fanum-voice-attempt-v1",
      callId,
      error: options?.error ?? "attempt_not_found",
    })
    const pathname = `/ari/fanum/voice-attempts/${callId}`
    const signature = `v1=${createHmac("sha256", runtimeToken).update([
      "fanum-voice-attempt-response-v1",
      "GET",
      pathname,
      "404",
      createHash("sha256").update(body, "utf8").digest("hex"),
    ].join("\n"), "utf8").digest("hex")}`
    return new Response(body, {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        ...(options?.signed === false ? {} : { "X-Fanum-Voice-Signature": signature }),
      },
    })
  }

  it("calls a rejected attempt a rejection once the station proves it never existed", async () => {
    // An uncertain dispatch is not a free position to take. The route keeps the
    // active fences so an operator can reconcile, but the row it writes has no
    // endedAt and no block reason: the stale-dispatch reaper skips it and the
    // operator's own resolve endpoint cannot match it either. Nothing ever
    // releases activeOrganizationKey and EVERY lead in the tenant answers "a
    // call is already queued" — permanently. One rejected request did that on
    // 2026-08-26.
    //
    // The registry writes its row before the gate can dial, so a signed 404 for
    // this id proves the customer's phone never rang, and proof is what the
    // definite-rejection path is for.
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_variables" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(missingAttempt())

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual(expect.objectContaining({
      success: false,
      failureCertainty: "definite_rejection",
    }))
  })

  it("stays uncertain when the station cannot prove the attempt never existed", async () => {
    // The proof is the signature, not the status code. An unsigned 404 could
    // come from anything on the path, and releasing a call's fences on it would
    // let CRM redial a customer who may already be talking to the agent.
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_variables" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(missingAttempt({ signed: false }))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual(expect.objectContaining({
      success: false,
      failureCertainty: "unknown_delivery",
    }))
  })

  it("sends the registry exactly the two variables it accepts, recording or not", async () => {
    // The station's attempt registry compares the variable NAMES it received
    // against an exact set and answers `invalid_variables` to anything else.
    // A third key is not ignored, it fails the request — and a failure at this
    // stage cannot prove the call was not placed, so CRM must mark the attempt
    // uncertain and refuse to redial. Every AI and browser call then dies with
    // "provider unavailable" while the registry holds no row at all.
    //
    // That is not hypothetical: shipping `__FANUM_RECORD` here broke every call
    // from the deploy on 2026-08-26 07:44 UTC, and the tests above passed the
    // whole time because not one of them looked at what this body contains.
    for (const record of [false, true]) {
      for (const voiceAgent of [false, true]) {
        fetchMock.mockReset()
        fetchMock
          .mockResolvedValueOnce(ariIdentity())
          .mockResolvedValueOnce(attempt("accepted"))

        await expect(provider().initiateCall({
          toNumber: "200",
          fromNumber: "100",
          record,
          voiceAgent,
          correlationId: suppliedCorrelationId,
        })).resolves.toEqual({ success: true, callSid: suppliedCorrelationId })

        const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
        const sent = JSON.parse(String(init.body))
        expect(Object.keys(sent.variables).sort()).toEqual([
          "__FANUM_CALL_ID",
          "__FANUM_CALL_MODE",
        ])
      }
    }
  })

  it("sends a browser call's answered leg to the station's human bridge", async () => {
    // The third destination, executed rather than pattern-matched. A regex over
    // the provider's source proves the text exists; only the originate body
    // proves the customer's answered call is handed to the browser bridge and
    // not to somebody's phone.
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted"))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      // A profile phone is present and must be IGNORED: a browser call has no
      // second leg, and ringing one would be the very thing this removes.
      agentNumber: "994501112233",
      browserAudio: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({ success: true, callSid: suppliedCorrelationId })

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      // The customer is still dialled through the tenant's own context.
      endpoint: "Local/200@outbound-routes/n",
      extension: "s",
      context: "fanum-human-bridge",
      callerId: "100",
      variables: {
        __FANUM_CALL_ID: suppliedCorrelationId,
        // Still a human call: a person is on it. Only the destination differs,
        // and the station's gate accepts human|ai and nothing else.
        __FANUM_CALL_MODE: "human",
      },
    })
  })

  it("keeps the AI bridge for an AI call even when browser audio is asked for", async () => {
    // One answered call has one destination. If both were ever set, the AI
    // bridge wins — an AI call joined to a browser would be two voices on one
    // line, and the AI path is the one that must never change behaviour.
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted"))

    await provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      browserAudio: true,
      correlationId: suppliedCorrelationId,
    })

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.context).toBe("fanum-ai-bridge")
    expect(body.variables.__FANUM_CALL_MODE).toBe("ai")
  })

  it("classifies a signed human not_accepted registry state as definite", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("not_accepted"))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      correlationId: suppliedCorrelationId,
    })).resolves.toMatchObject({
      success: false,
      failureCertainty: "definite_rejection",
    })
  })

  it("keeps a human registry dispatch uncertain when the response is unsigned", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted", { signed: false }))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      correlationId: suppliedCorrelationId,
    })).resolves.toMatchObject({
      success: false,
      failureCertainty: "unknown_delivery",
    })
  })

  it("routes an AI call through authenticated durable attempt registration", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted"))

    const result = await provider().initiateCall({
      toNumber: "+15551234567",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [identityUrl, identityInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(identityUrl).pathname).toBe("/ari/asterisk/info")
    expect(identityInit).toEqual(expect.objectContaining({ method: "GET" }))

    const [rawUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const url = new URL(rawUrl)
    expect(url.pathname).toBe(`/ari/fanum/voice-attempts/${suppliedCorrelationId}`)
    expect(url.search).toBe("")
    expect(init).toEqual(expect.objectContaining({ method: "PUT" }))
    expect(result).toEqual({ success: true, callSid: suppliedCorrelationId })
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: "Local/+15551234567@outbound-routes/n",
      extension: "s",
      context: "fanum-ai-bridge",
      callerId: "100",
      variables: {
        __FANUM_CALL_ID: suppliedCorrelationId,
        __FANUM_CALL_MODE: "ai",
      },
    })
    const requestMessage = [
      "fanum-voice-attempt-request-v1",
      "PUT",
      url.pathname,
      createHash("sha256").update(String(init.body), "utf8").digest("hex"),
    ].join("\n")
    expect(new Headers(init.headers).get("x-fanum-voice-signature")).toBe(
      `v1=${createHmac("sha256", runtimeToken).update(requestMessage, "utf8").digest("hex")}`,
    )
  })

  it("replays the same UUID as the exact same signed idempotent request", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted", { status: 201 }))
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("accepted"))
    const input = {
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    }

    await expect(provider().initiateCall(input)).resolves.toEqual({
      success: true,
      callSid: suppliedCorrelationId,
    })
    await expect(provider().initiateCall(input)).resolves.toEqual({
      success: true,
      callSid: suppliedCorrelationId,
    })

    const first = fetchMock.mock.calls[1]?.[1] as RequestInit
    const replay = fetchMock.mock.calls[3]?.[1] as RequestInit
    expect(replay.body).toBe(first.body)
    expect(new Headers(replay.headers).get("x-fanum-voice-signature")).toBe(
      new Headers(first.headers).get("x-fanum-voice-signature"),
    )
  })

  it("does not send an AI attempt when the authenticated ARI identity cannot be proved", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({
      success: false,
      error: "Asterisk ARI identity could not be verified.",
      failureCertainty: "definite_rejection",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["", ` ${runtimeToken}`, "é".repeat(3_000)])(
    "keeps the fence for a missing or non-canonical HMAC key and sends no request",
    async (invalidToken) => {
    vi.stubEnv("FANUM_VOICE_RUNTIME_TOKEN", invalidToken)

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({
      success: false,
      error: "Asterisk voice-attempt delivery is uncertain.",
      failureCertainty: "unknown_delivery",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("treats a durable not_accepted tombstone as a definite rejection", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("not_accepted"))

    await expect(provider().initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: suppliedCorrelationId,
    })).resolves.toEqual({
      success: false,
      error: "Asterisk did not accept the voice attempt.",
      failureCertainty: "definite_rejection",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects an invalid correlation id in every Asterisk call mode", async () => {
    const provider = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(provider.initiateCall({
      toNumber: "+15551234567",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: "not-a-uuid",
    })).resolves.toEqual({
      success: false,
      error: "Invalid Asterisk call correlation id.",
      failureCertainty: "definite_rejection",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([400, 401])(
    "classifies HTTP %i as a definite ARI rejection without retrying",
    async (status) => {
      vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "false")
      fetchMock.mockResolvedValueOnce(new Response('{"error":"Rejected"}', { status }))

      const provider = new AsteriskProvider({
        provider: "asterisk",
        ariHost: "pbx.example.com",
        ariPort: 8088,
        username: "ari-user",
        password: "secret",
        context: "outbound-routes",
        callerExtension: "100",
      })

      await expect(provider.initiateCall({ toNumber: "200", fromNumber: "100" })).resolves.toEqual({
        success: false,
        error: `Asterisk ARI error (${status}).`,
        failureCertainty: "definite_rejection",
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([408, 409, 425, 429, 500, 503])(
    "classifies HTTP %i as unknown delivery and does not retry",
    async (status) => {
      vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "false")
      fetchMock.mockResolvedValueOnce(new Response('{"error":"Uncertain"}', { status }))
      const provider = new AsteriskProvider({
        provider: "asterisk",
        ariHost: "pbx.example.com",
        ariPort: 8088,
        username: "ari-user",
        password: "secret",
        context: "outbound-routes",
        callerExtension: "100",
      })

      await expect(provider.initiateCall({ toNumber: "200", fromNumber: "100" })).resolves.toEqual({
        success: false,
        error: `Asterisk ARI error (${status}).`,
        failureCertainty: "unknown_delivery",
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it("bounds originate latency and returns a timeout as an uncertain failure without retry", async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal)
    const timeoutError = new Error("The operation was aborted due to timeout")
    timeoutError.name = "TimeoutError"
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockRejectedValueOnce(timeoutError)

    const provider = new AsteriskProvider({
      provider: "asterisk",
      voiceAttemptRegistryEnabled: true,
      organizationId: "org-1",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    const result = await provider.initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
    })

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ signal: timeoutSignal }))
    expect(result).toMatchObject({ success: false, failureCertainty: "unknown_delivery" })
  })

  it("classifies a transport failure as unknown delivery without retrying", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockRejectedValueOnce(new TypeError("fetch failed"))
    const provider = new AsteriskProvider({
      provider: "asterisk",
      voiceAttemptRegistryEnabled: true,
      organizationId: "org-1",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    const result = await provider.initiateCall({
      toNumber: "200",
      fromNumber: "100",
      voiceAgent: true,
      correlationId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({
      success: false,
      error: "Asterisk connection failed: fetch failed",
      failureCertainty: "unknown_delivery",
    })
  })

  it("bounds the ARI connection check instead of leaving settings requests hanging", async () => {
    const timeoutSignal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal)
    const timeoutError = new Error("The operation was aborted due to timeout")
    timeoutError.name = "TimeoutError"
    fetchMock.mockRejectedValueOnce(timeoutError)

    const provider = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    const result = await provider.testConnection()

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal: timeoutSignal }))
    expect(result).toEqual({
      success: false,
      message: "Cannot reach Asterisk ARI: The operation was aborted due to timeout",
    })
  })

  it("uses pinned HTTPS for hangup, diagnostics, and connection tests after config opt-in", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(ariIdentity())
      .mockImplementationOnce((input: string | URL | Request) => {
        const pathname = new URL(String(input)).pathname
        const callId = pathname.split("/").at(-1) || ""
        const body = JSON.stringify({
          protocol: "fanum-voice-attempt-v1",
          callId,
          error: "attempt_not_found",
        })
        const signatureMessage = [
          "fanum-voice-attempt-response-v1",
          "GET",
          pathname,
          "404",
          createHash("sha256").update(body, "utf8").digest("hex"),
        ].join("\n")
        return Promise.resolve(new Response(body, {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "X-Fanum-Voice-Signature": `v1=${createHmac("sha256", runtimeToken)
              .update(signatureMessage, "utf8")
              .digest("hex")}`,
          },
        }))
      })

    await expect(provider().endCall(suppliedCorrelationId)).resolves.toEqual({ success: true })
    await expect(provider().inspectCallActivity(suppliedCorrelationId)).resolves.toEqual({ state: "active" })
    await expect(provider().testConnection()).resolves.toEqual({
      success: true,
      message: "Asterisk pinned control plane verified.",
    })

    expect(transportMocks.secureFetch).toHaveBeenCalledTimes(4)
    for (const [input, init] of transportMocks.secureFetch.mock.calls as Array<[URL, RequestInit]>) {
      expect(new URL(String(input)).protocol).toBe("https:")
      expect(init.redirect).toBe("error")
    }
    expect(transportMocks.secureFetch.mock.calls[0]?.[1])
      .toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it.each([
    [200, "active"],
    [401, "unknown"],
    [500, "unknown"],
  ] as const)("maps read-only ARI channel status %i to %s", async (status, state) => {
    fetchMock.mockResolvedValueOnce(new Response(status === 200 ? "{}" : "", { status }))
    const provider = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(provider.inspectCallActivity("call/id")).resolves.toEqual({ state })
    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(rawUrl).pathname).toBe("/ari/channels/call%2Fid")
    expect(init).toEqual(expect.objectContaining({ method: "GET" }))
  })

  it("never treats an ARI channel 404 as finality or performs an identity follow-up", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }))

    await expect(provider().inspectCallActivity("call-1")).resolves.toEqual({ state: "unknown" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe("/ari/channels/call-1")
  })

  it("returns a terminal attempt only from authenticated, exact typed registry proof", async () => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("terminal", { outcome: "no_answer", method: "GET" }))

    await expect(provider().inspectCallFinality(suppliedCorrelationId)).resolves.toEqual({
      state: "terminal",
      outcome: "no_answer",
      revision: 7,
      updatedAt,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [rawUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const pathname = new URL(rawUrl).pathname
    expect(pathname).toBe(`/ari/fanum/voice-attempts/${suppliedCorrelationId}`)
    expect(init).toEqual(expect.objectContaining({ method: "GET" }))
    const requestMessage = [
      "fanum-voice-attempt-request-v1",
      "GET",
      pathname,
      createHash("sha256").update("", "utf8").digest("hex"),
    ].join("\n")
    expect(new Headers(init.headers).get("x-fanum-voice-signature")).toBe(
      `v1=${createHmac("sha256", runtimeToken).update(requestMessage, "utf8").digest("hex")}`,
    )
  })

  it.each([
    ["generic 404", new Response("", { status: 404 })],
    ["typed HTTP 404", attempt("not_accepted", { status: 404, method: "GET" })],
    ["wrong protocol", attempt("not_accepted", { protocol: "wrong", method: "GET" })],
    ["wrong UUID", attempt("not_accepted", {
      callId: "00000000-0000-4000-8000-000000000999",
      method: "GET",
    })],
    ["revision zero", attempt("not_accepted", { revision: 0, method: "GET" })],
    ["non-RFC3339 timestamp", attempt("not_accepted", {
      updatedAt: "2026-08-10",
      method: "GET",
    })],
    ["invalid terminal", attempt("terminal", { outcome: "maybe", method: "GET" })],
  ])("keeps %s registry evidence unknown", async (_case, registryResponse) => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(registryResponse)

    await expect(provider().inspectCallFinality(suppliedCorrelationId)).resolves.toEqual({
      state: "unknown",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["missing signature", attempt("not_accepted", { method: "GET", signed: false })],
    ["invalid signature", attempt("not_accepted", {
      method: "GET",
      signature: `v1=${"0".repeat(64)}`,
    })],
    ["altered path", attempt("not_accepted", {
      method: "GET",
      signaturePathname: "/ari/fanum/voice-attempts/00000000-0000-4000-8000-000000000999",
    })],
    ["altered status", attempt("not_accepted", { method: "GET", signatureStatus: 201 })],
    ["altered body", attempt("not_accepted", { method: "GET", signatureBody: "{}" })],
  ])("rejects a typed registry response with %s", async (_case, registryResponse) => {
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(registryResponse)

    await expect(provider().inspectCallFinality(suppliedCorrelationId)).resolves.toEqual({
      state: "unknown",
    })
  })

  it("streams and cancels an oversized registry body even without Content-Length", async () => {
    const oversized = new Response("x".repeat(32_769), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
    expect(oversized.headers.get("content-length")).toBeNull()
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(oversized)

    await expect(provider().inspectCallFinality(suppliedCorrelationId)).resolves.toEqual({
      state: "unknown",
    })
  })

  it("posts an empty cancellation request and trusts its typed tombstone", async () => {
    const cancelPath = `/ari/fanum/voice-attempts/${suppliedCorrelationId}/cancel`
    fetchMock
      .mockResolvedValueOnce(ariIdentity())
      .mockResolvedValueOnce(attempt("not_accepted", {
        method: "POST",
        pathname: cancelPath,
      }))

    await expect(provider().cancelAndInspectCallFinality(suppliedCorrelationId)).resolves.toEqual({
      state: "not_accepted",
      revision: 7,
      updatedAt,
    })
    const [rawUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new URL(rawUrl).pathname).toBe(
      `/ari/fanum/voice-attempts/${suppliedCorrelationId}/cancel`,
    )
    expect(init).toEqual(expect.objectContaining({ method: "POST" }))
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).has("content-type")).toBe(false)
    const requestMessage = [
      "fanum-voice-attempt-request-v1",
      "POST",
      cancelPath,
      createHash("sha256").update("", "utf8").digest("hex"),
    ].join("\n")
    expect(new Headers(init.headers).get("x-fanum-voice-signature")).toBe(
      `v1=${createHmac("sha256", runtimeToken).update(requestMessage, "utf8").digest("hex")}`,
    )
  })

  it.each(["accepted", "active"] as const)(
    "retains an uncertain fence when cancellation returns durable %s",
    async (state) => {
      fetchMock
        .mockResolvedValueOnce(ariIdentity())
        .mockResolvedValueOnce(attempt(state, {
          method: "POST",
          pathname: `/ari/fanum/voice-attempts/${suppliedCorrelationId}/cancel`,
        }))

      await expect(provider().cancelAndInspectCallFinality(suppliedCorrelationId)).resolves.toEqual({
        state,
        revision: 7,
        updatedAt,
      })
    },
  )

  it("keeps a transport failure unknown during the read-only channel probe", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
    const provider = new AsteriskProvider({
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "secret",
      context: "outbound-routes",
      callerExtension: "100",
    })

    await expect(provider.inspectCallActivity("call-1")).resolves.toEqual({ state: "unknown" })
  })
})
