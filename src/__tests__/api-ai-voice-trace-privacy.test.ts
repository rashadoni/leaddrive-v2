import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const deps = vi.hoisted(() => ({
  create: vi.fn<(args: { data: { text: string } }) => Promise<Record<string, never>>>(async () => ({})),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceSession: { findFirst: vi.fn(async () => ({ id: "voice-1" })) },
    voiceSessionTurn: { create: deps.create },
  },
}))
vi.mock("@/lib/ai/voice/scoped-where", () => ({
  voiceScopedWhere: (orgId: string, where: Record<string, unknown>) => ({ organizationId: orgId, ...where }),
}))

import { POST } from "@/app/api/v1/ai/voice/trace/route"

function request(tool: string, args: unknown, outcome: string) {
  return new NextRequest("http://localhost/api/v1/ai/voice/trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voiceSessionId: "voice-1", tool, args, outcome }),
  })
}

beforeEach(() => vi.clearAllMocks())

describe("voice lifecycle trace privacy", () => {
  it("stores only a sanitized status for transcription diagnostics", async () => {
    const privateWords = "customer private transcript"
    const response = await POST(request(
      "voice_transcription",
      { status: "failed", transcript: privateWords, error: privateWords },
      privateWords,
    ))

    expect(response.status).toBe(204)
    const text = deps.create.mock.calls[0]?.[0]?.data?.text as string
    expect(text).toBe("unknown {\"keys\":[\"status\"]}")
    expect(text).not.toContain(privateWords)
  })

  it("stores only sanitized identifiers for provider lifecycle errors", async () => {
    const privateWords = "raw provider message with customer speech"
    await POST(request(
      "voice_realtime_error",
      { code: "server_error", message: privateWords },
      "retryable",
    ))

    const text = deps.create.mock.calls[0]?.[0]?.data?.text as string
    expect(text).toBe("retryable {\"keys\":[\"code\"]}")
    expect(text).not.toContain(privateWords)
  })

  it("stores only allowed schema key names for client tools, never argument values", async () => {
    const privateWords = "private customer name and search query"
    await POST(request(
      "find_record",
      { type: "lead", query: privateWords, injected: privateWords },
      "ok",
    ))

    const text = deps.create.mock.calls[0]?.[0]?.data?.text as string
    expect(text).toBe("ok {\"keys\":[\"type\",\"query\"]}")
    expect(text).not.toContain(privateWords)
    expect(text).not.toContain("injected")
  })
})
