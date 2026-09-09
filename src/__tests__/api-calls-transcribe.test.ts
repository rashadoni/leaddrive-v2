/**
 * C4 Call Transcription — route tests.
 *
 * Multi-tenant safety: every test asserts the org filter is applied
 * at the DB layer. Idempotency: re-transcribing a row that already
 * has a transcript returns the cached value unless `force: true`.
 *
 * Provider DI: `postWithClient` accepts an injected client so the
 * test can stub Whisper end-to-end without env or real fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}))

import { postWithClient } from "@/app/api/v1/calls/[id]/transcribe/_impl"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import type { TranscriptionClient } from "@/lib/transcription/types"

function makeReq(body?: unknown) {
  return new NextRequest(
    new URL("/api/v1/calls/c1/transcribe", "http://localhost:3000"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
  )
}
function params(id: string) {
  return { params: Promise.resolve({ id }) }
}
const auth = (orgId = "org1") => ({
  orgId, userId: "u1", role: "admin", email: "", name: "",
})

function stubClient(result?: {
  transcript: string
  language?: string
  durationSeconds?: number
}): TranscriptionClient {
  return {
    async transcribe() {
      if (!result) throw new Error("provider error")
      return { ...result, provider: "openai-whisper" as const }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── Auth + lookup ────────────────────────────────────────────── */

describe("POST /api/v1/calls/[id]/transcribe — auth + lookup", () => {
  it("propagates auth error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      new Response("Unauthorized", { status: 401 }) as never,
    )
    const res = await postWithClient(makeReq(), params("c1"), stubClient({ transcript: "x" }))
    expect(res.status).toBe(401)
  })

  it("404 when call is in another org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
    const res = await postWithClient(makeReq(), params("c1"), stubClient({ transcript: "x" }))
    expect(res.status).toBe(404)
  })

  it("scopes lookup by (id, organizationId)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)
    await postWithClient(makeReq(), params("c42"), stubClient({ transcript: "x" }))
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c42", organizationId: "org1" },
      }),
    )
  })
})

/* ── Idempotency ───────────────────────────────────────────────── */

describe("POST /api/v1/calls/[id]/transcribe — idempotency", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("returns cached transcript without re-running provider", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: "already done",
      duration: 30,
    } as any)
    const client = stubClient({ transcript: "fresh" })
    const spy = vi.spyOn(client, "transcribe")

    const res = await postWithClient(makeReq(), params("c1"), client)
    expect(res.status).toBe(200)
    const body: { cached: boolean; transcript: string } = await res.json()
    expect(body.cached).toBe(true)
    expect(body.transcript).toBe("already done")
    expect(spy).not.toHaveBeenCalled()
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("re-transcribes when force=true", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: "old",
      duration: 30,
    } as any)
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await postWithClient(
      makeReq({ force: true }),
      params("c1"),
      stubClient({ transcript: "new" }),
    )
    expect(res.status).toBe(200)
    const body: { cached: boolean; transcript: string } = await res.json()
    expect(body.cached).toBe(false)
    expect(body.transcript).toBe("new")
    expect(prisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transcription: "new" }) }),
    )
  })
})

/* ── Missing recording / invalid URL ──────────────────────────── */

describe("POST /api/v1/calls/[id]/transcribe — pre-flight", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("does not let the generic pipeline overwrite an AI-call transcript", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: "voice-agent transcript",
      duration: 30,
      callMode: "ai",
      userId: "u1",
    } as any)
    const client = stubClient({ transcript: "tampered" })
    const spy = vi.spyOn(client, "transcribe")

    const res = await postWithClient(makeReq({ force: true }), params("c1"), client)

    expect(res.status).toBe(409)
    expect(spy).not.toHaveBeenCalled()
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("409 when call has no recordingUrl and no audioUrl override", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: null,
      transcription: null,
      duration: null,
    } as any)
    const res = await postWithClient(makeReq(), params("c1"), stubClient({ transcript: "x" }))
    expect(res.status).toBe(409)
  })

  it("400 when audioUrl override is not http(s)", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: null,
      transcription: null,
      duration: null,
    } as any)
    const res = await postWithClient(
      makeReq({ audioUrl: "javascript:alert(1)" }),
      params("c1"),
      stubClient({ transcript: "x" }),
    )
    expect(res.status).toBe(400)
  })

  it("503 when no transcription provider is configured", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: null,
      duration: null,
    } as any)
    const res = await postWithClient(makeReq(), params("c1"), null)
    expect(res.status).toBe(503)
  })
})

/* ── Happy path + provider failure ────────────────────────────── */

describe("POST /api/v1/calls/[id]/transcribe — transcribe flow", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(auth() as never)
  })

  it("200 + persists transcription + backfills duration when missing", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: null,
      duration: null,
    } as any)
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    const res = await postWithClient(
      makeReq(),
      params("c1"),
      stubClient({ transcript: "hello world", language: "en", durationSeconds: 42.7 }),
    )
    expect(res.status).toBe(200)
    expect(prisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transcription: "hello world",
          duration: 43, // Math.round(42.7)
        }),
      }),
    )
  })

  it("200 + does NOT overwrite an existing duration", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: null,
      duration: 99, // Twilio webhook already stamped it
    } as any)
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)

    await postWithClient(
      makeReq(),
      params("c1"),
      stubClient({ transcript: "x", durationSeconds: 10 }),
    )
    const call = vi.mocked(prisma.callLog.update).mock.calls[0][0]
    expect(call.data.duration).toBeUndefined()
  })

  it("502 when provider throws", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: null,
      duration: null,
    } as any)
    const res = await postWithClient(makeReq(), params("c1"), stubClient())
    expect(res.status).toBe(502)
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })

  it("forwards language + prompt to the provider", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "c1",
      recordingUrl: "https://r/x.mp3",
      transcription: null,
      duration: null,
    } as any)
    vi.mocked(prisma.callLog.update).mockResolvedValue({} as any)
    const client = stubClient({ transcript: "x" })
    const spy = vi.spyOn(client, "transcribe")

    await postWithClient(
      makeReq({ language: "ru", prompt: "Acme product names: Foo, Bar" }),
      params("c1"),
      client,
    )
    expect(spy).toHaveBeenCalledWith({
      audioUrl: "https://r/x.mp3",
      language: "ru",
      prompt: "Acme product names: Foo, Bar",
    })
  })
})
