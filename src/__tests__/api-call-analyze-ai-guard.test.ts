import { beforeEach, describe, expect, it, vi } from "vitest"
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
  isAuthError: (value: unknown) => value instanceof Response,
}))

import { POST } from "@/app/api/v1/calls/[id]/analyze/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const PARAMS = { params: Promise.resolve({ id: "call-ai" }) }

describe("POST /api/v1/calls/[id]/analyze AI guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: "org-1",
      userId: "sales-1",
      role: "admin",
      email: "admin@example.test",
      name: "Admin",
    } as never)
  })

  it("does not let the generic analyzer overwrite correlated AI-call insights", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({
      id: "call-ai",
      transcription: "voice-agent transcript",
      duration: 30,
      callMode: "ai",
      userId: "sales-1",
      conversationId: null,
      ticketId: null,
      dealId: null,
      leadId: "lead-1",
      companyId: null,
      contactId: null,
    } as never)
    const request = new NextRequest("http://localhost:3000/api/v1/calls/call-ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "tampered transcript" }),
    })

    const response = await POST(request, PARAMS)

    expect(response.status).toBe(409)
    expect(prisma.callLog.update).not.toHaveBeenCalled()
  })
})
