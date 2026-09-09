import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { webChatWidget: { upsert: vi.fn() } },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: unknown) => r instanceof NextResponse),
}))

import { prisma } from "@/lib/prisma"
import { PUT } from "@/app/api/v1/web-chat/config/route"
import { requireAuth } from "@/lib/api-auth"

const upsert = vi.mocked(prisma.webChatWidget.upsert)

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/v1/web-chat/config", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as never)
  upsert.mockResolvedValue({ id: "w-1" } as never)
})

describe("PUT /api/v1/web-chat/config — preChatForm", () => {
  it("accepts a full preChatForm and persists it", async () => {
    const form = {
      name: { enabled: true, required: true },
      email: { enabled: true, required: false },
      phone: { enabled: false, required: false },
    }
    const res = await PUT(request({ preChatForm: form }))

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ preChatForm: form }),
    }))
  })

  it("normalizes required ⇒ enabled before writing", async () => {
    await PUT(request({
      preChatForm: {
        name: { enabled: false, required: true },
        email: { enabled: true, required: false },
        phone: { enabled: true, required: false },
      },
    }))

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        preChatForm: expect.objectContaining({ name: { enabled: true, required: true } }),
      }),
    }))
  })

  it("rejects a malformed preChatForm", async () => {
    const res = await PUT(request({ preChatForm: { name: { enabled: "yes" } } }))
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})
