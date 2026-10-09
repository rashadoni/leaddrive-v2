import type { LiveServerMessage } from "@google/genai"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { geminiLiveModel } from "@/lib/ai/voice/gemini-live"
import {
  checkGeminiLiveProvider,
  providerCheckPassed,
  type ProviderCheckConnect,
  type ProviderCheckSession,
} from "@/lib/ai/voice/provider-check"

const NEXT = geminiLiveModel("gemini-3.8-live")
const AUDIO = { serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } } }
const TURN_COMPLETE = { serverContent: { turnComplete: true } }
const toolCall = (id: string, name = "get_leads_summary") => ({ toolCall: { functionCalls: [{ id, name, args: {} }] } })

/**
 * A provider that does what the script says. `after` runs once the check has
 * sent something, so a scenario can react to the question or to the tool
 * result the way the real model would.
 */
function provider(script: {
  onConnect?: (send: (message: unknown) => void, fail: (reason: string) => void) => void
  onQuestion?: (send: (message: unknown) => void) => void
  onToolResponse?: (send: (message: unknown) => void, ids: string[], fail: (reason: string) => void) => void
  rejectConnect?: string
}) {
  const sent = { questions: [] as string[], responses: [] as Array<{ id?: string; response?: unknown }>, closed: 0 }
  const connect: ProviderCheckConnect = async ({ onmessage, onfailure }) => {
    if (script.rejectConnect) throw new Error(script.rejectConnect)
    const send = (message: unknown) => onmessage(message as LiveServerMessage)
    const session: ProviderCheckSession = {
      sendClientContent: ({ turns }) => {
        sent.questions.push(turns)
        script.onQuestion?.(send)
      },
      sendToolResponse: ({ functionResponses }) => {
        sent.responses.push(...functionResponses)
        script.onToolResponse?.(send, functionResponses.map((response) => response.id ?? ""), onfailure)
      },
      close: () => { sent.closed += 1 },
    }
    queueMicrotask(() => script.onConnect?.(send, onfailure))
    return session
  }
  return { connect, sent }
}

const mint = vi.fn(async (input: { model?: { id: string } }) => ({
  token: "auth_tokens/one-use",
  expiresAt: "2026-10-08T12:00:00.000Z",
  model: input.model?.id ?? "",
}))

beforeEach(() => {
  vi.useFakeTimers()
  mint.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

async function run(script: Parameters<typeof provider>[0], turn = true) {
  const fake = provider(script)
  const pending = checkGeminiLiveProvider({
    apiKey: "server-only-key",
    model: NEXT,
    turn,
    connect: fake.connect,
    mint: mint as never,
    holdMs: 4_000,
    timeoutMs: 45_000,
  })
  await vi.advanceTimersByTimeAsync(60_000)
  return { check: await pending, sent: fake.sent }
}

describe("the provider check", () => {
  it("mints the console's own token for the model it was asked about", async () => {
    await run({ onConnect: (send) => send({ setupComplete: {} }) }, false)
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "server-only-key", model: NEXT }))
    // Every section a real session could publish, so every tool is declared.
    expect((mint.mock.calls[0]![0] as { allowedSections: string[] }).allowedSections.length).toBeGreaterThan(5)
  })

  it("passes a setup-only check on setupComplete and asks the model nothing", async () => {
    const { check, sent } = await run({ onConnect: (send) => send({ setupComplete: {} }) }, false)
    expect(check).toMatchObject({ model: "gemini-3.8-live", setupComplete: true, toolFirst: null, failure: null })
    expect(providerCheckPassed(check)).toBe(true)
    expect(sent.questions).toEqual([])
    expect(sent.closed).toBe(1)
  })

  it("fails, with the provider's reason, when the setup is refused", async () => {
    // What a field the model does not accept looks like: the socket opens and
    // is closed with a reason instead of setupComplete.
    const { check } = await run({
      onConnect: (_send, fail) => fail("closed: 1007 Request contains an invalid argument."),
    })
    expect(check.setupComplete).toBe(false)
    expect(check.toolFirst).toBeNull()
    expect(check.failure).toBe("closed: 1007 Request contains an invalid argument.")
    expect(providerCheckPassed(check)).toBe(false)
  })

  it("fails when the provider never answers the setup", async () => {
    const { check, sent } = await run({})
    expect(check).toMatchObject({ setupComplete: false, failure: "setupComplete timed out" })
    expect(providerCheckPassed(check)).toBe(false)
    expect(sent.closed).toBe(1)
  })

  it("fails when the token cannot be minted, and opens no session", async () => {
    mint.mockRejectedValueOnce(new Error("Gemini Live token mint failed (403)"))
    const { check, sent } = await run({ onConnect: (send) => send({ setupComplete: {} }) })
    expect(check).toMatchObject({ setupComplete: false, failure: "Gemini Live token mint failed (403)" })
    expect(sent.closed).toBe(0)
  })

  it("passes a model that calls a tool, waits for the result, then speaks", async () => {
    const { check, sent } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => send(toolCall("call-1")),
      onToolResponse: (send) => { send(AUDIO); send(TURN_COMPLETE) },
    })
    expect(sent.questions).toHaveLength(1)
    // The browser's own response shape, not a simplified one.
    expect(sent.responses).toEqual([{ id: "call-1", name: "get_leads_summary", response: { output: { total: 7 } } }])
    expect(check.toolFirst).toEqual({ tool: "get_leads_summary", waitedForResult: true, audioAfterResult: true })
    expect(check.failure).toBeNull()
    expect(providerCheckPassed(check)).toBe(true)
  })

  it("holds the tool result back before releasing it", async () => {
    const fake = provider({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => send(toolCall("call-1")),
      onToolResponse: (send) => { send(AUDIO); send(TURN_COMPLETE) },
    })
    const pending = checkGeminiLiveProvider({
      apiKey: "k", model: NEXT, turn: true, connect: fake.connect, mint: mint as never, holdMs: 4_000,
    })
    await vi.advanceTimersByTimeAsync(3_900)
    // The pause is the test: a model on the async default talks through it.
    expect(fake.sent.responses).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(fake.sent.responses).toHaveLength(1)
    expect(providerCheckPassed(await pending)).toBe(true)
  })

  it("fails a model that finishes its turn while the tool is still running", async () => {
    // The 3.8 default (NON_BLOCKING): it calls the tool and carries on.
    const { check, sent } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => { send(toolCall("call-1")); send(AUDIO); send(TURN_COMPLETE) },
    })
    expect(check.toolFirst).toEqual({ tool: "get_leads_summary", waitedForResult: false, audioAfterResult: false })
    expect(providerCheckPassed(check)).toBe(false)
    // It ended before the result was due, so none was sent.
    expect(sent.responses).toEqual([])
  })

  it("fails a model that answers a data question without calling a tool", async () => {
    const { check } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => { send(AUDIO); send(TURN_COMPLETE) },
    })
    expect(check.toolFirst).toEqual({ tool: null, waitedForResult: false, audioAfterResult: false })
    expect(providerCheckPassed(check)).toBe(false)
  })

  it("fails a model that takes the result and never speaks", async () => {
    const { check } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => send(toolCall("call-1")),
      onToolResponse: (send) => send(TURN_COMPLETE),
    })
    expect(check.toolFirst).toEqual({ tool: "get_leads_summary", waitedForResult: true, audioAfterResult: false })
    expect(providerCheckPassed(check)).toBe(false)
  })

  it("fails on audio the console could not play", async () => {
    const { check } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => send(toolCall("call-1")),
      onToolResponse: (send) => send({
        serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=16000" } }] } },
      }),
    })
    expect(check.failure).toBe("Gemini Live returned an invalid audio payload")
    expect(providerCheckPassed(check)).toBe(false)
  })

  it("answers every tool call, so a second one cannot hang the session", async () => {
    let second = false
    const { check, sent } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => { send(toolCall("call-1")); send(toolCall("call-2", "get_deals_summary")) },
      onToolResponse: (send, ids) => {
        if (!second && ids.includes("call-2")) {
          second = true
          send(toolCall("call-3", "get_tasks_summary"))
          return
        }
        if (ids.includes("call-3")) { send(AUDIO); send(TURN_COMPLETE) }
      },
    })
    expect(sent.responses.map((response) => response.id)).toEqual(["call-1", "call-2", "call-3"])
    expect(check.toolFirst?.tool).toBe("get_leads_summary")
    expect(providerCheckPassed(check)).toBe(true)
  })

  it("fails when the session dies mid-answer, however good it looked until then", async () => {
    const { check } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => send(toolCall("call-1")),
      onToolResponse: (send, _ids, fail) => { send(AUDIO); fail("closed: 1011 Internal error") },
    })
    // Tool called, result awaited, audio heard - and no end of turn.
    expect(check.toolFirst).toEqual({ tool: "get_leads_summary", waitedForResult: true, audioAfterResult: true })
    expect(check.failure).toBe("closed: 1011 Internal error")
    expect(providerCheckPassed(check)).toBe(false)
  })

  it("gives up on a model that goes quiet mid-turn", async () => {
    const { check } = await run({
      onConnect: (send) => send({ setupComplete: {} }),
      onQuestion: (send) => send(toolCall("call-1")),
    })
    expect(check).toMatchObject({ setupComplete: true, failure: "no complete answer in time" })
    expect(providerCheckPassed(check)).toBe(false)
  })

  it("keeps a credential out of the reason it reports", async () => {
    // Both shapes a one-use token can take in an error: as a query parameter
    // and as a resource name.
    const asParameter = await run({ rejectConnect: "wss://host/ws?access_token=RAW-TOKEN-VALUE&alt=json refused" })
    expect(asParameter.check.failure).not.toContain("RAW-TOKEN-VALUE")
    expect(asParameter.check.failure).toContain("refused")

    const asName = await run({ rejectConnect: "auth_tokens/NAMED-TOKEN-VALUE is expired" })
    expect(asName.check.failure).not.toContain("NAMED-TOKEN-VALUE")
    expect(asName.check.failure).toContain("is expired")
  })
})

describe("POST /api/cron/voice-provider-check", () => {
  function request(query = "", secret: string | null = "cron-secret") {
    return new NextRequest(`http://localhost/api/cron/voice-provider-check${query}`, {
      method: "POST",
      headers: secret ? { "x-cron-secret": secret } : {},
    })
  }

  beforeEach(() => {
    vi.useRealTimers()
    vi.stubEnv("CRON_SECRET", "cron-secret")
    vi.stubEnv("VOICE_REALTIME_PROVIDER", "gemini_live")
    vi.stubEnv("GEMINI_API_KEY", "server-only-key")
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", "")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("refuses a caller without the cron secret, before touching the provider", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/cron/voice-provider-check/route")
    expect((await POST(request("", null))).status).toBe(401)
    expect((await POST(request("", "wrong"))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a model id that could not hold a session, before touching the provider", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/cron/voice-provider-check/route")
    for (const model of ["gemini-3.8-live-extended-thinking", "gemini-3.8-flash", "..%2Fmodels"]) {
      const response = await POST(request(`?model=${model}`))
      expect(response.status, model).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports voice as off, not as passing, when the host has no provider key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/cron/voice-provider-check/route")
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: false, ok: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reports a refused token mint as a failed check, with the server key kept out of the answer", async () => {
    // The mint is the first thing that reaches Google; refuse it there and the
    // route must say so rather than throw.
    // Sessions on this host run one model; the check is asked about another.
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", "gemini-3.8-live")
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 403 }))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/cron/voice-provider-check/route")
    const response = await POST(request("?model=gemini-3.1-flash-live-preview&turn=1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      configured: true,
      ok: false,
      model: "gemini-3.1-flash-live-preview",
      // Nobody's session opens with this model: it was asked for by name.
      current: false,
      setupComplete: false,
      failure: "Gemini Live token mint failed (403)",
    })
    expect(JSON.stringify(body)).not.toContain("server-only-key")
    // And it asked Google about the model it was told to, with that model's setup.
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))
    expect(sent.bidiGenerateContentSetup.model).toBe("models/gemini-3.1-flash-live-preview")
    expect(sent.bidiGenerateContentSetup.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" })
  })

  it("checks the model sessions get now when none is named", async () => {
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", "gemini-3.8-live")
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 403 }))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/cron/voice-provider-check/route")
    const body = await (await POST(request())).json()
    expect(body).toMatchObject({ model: "gemini-3.8-live", current: true })
  })
})
