import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => {
  const task = {
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  }
  return {
    prisma: {
      task,
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb({ task })),
    },
    logAudit: vi.fn(),
  }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { POST } from "@/app/api/v1/tasks/[id]/stop-series/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

function makeRequest() {
  return new Request("http://localhost/api/v1/tasks/t1/stop-series", { method: "POST" }) as any
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "admin" } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)
})

describe("POST /api/v1/tasks/[id]/stop-series", () => {
  it("returns 404 when task doesn't exist in caller's org", async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)
    const res = await POST(makeRequest(), makeParams("t1"))
    expect(res.status).toBe(404)
  })

  it("returns 400 when task has no recurrence", async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", recurrenceParentId: null, recurrenceRule: null,
    } as any)
    const res = await POST(makeRequest(), makeParams("t1"))
    expect(res.status).toBe(400)
  })

  it("clears rule on parent + all children when called on the parent", async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t-root", title: "Weekly", recurrenceParentId: null, recurrenceRule: "weekly",
    } as any)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeRequest(), makeParams("t-root"))
    expect(res.status).toBe(200)

    const calls = vi.mocked(prisma.task.updateMany).mock.calls
    expect(calls.length).toBe(2)
    // First call: parent
    expect(calls[0][0]).toEqual({
      where: { id: "t-root", organizationId: "org-1" },
      data: { recurrenceRule: null },
    })
    // Second call: every child
    expect(calls[1][0]).toEqual({
      where: { recurrenceParentId: "t-root", organizationId: "org-1" },
      data: { recurrenceRule: null },
    })
  })

  it("walks UP to the root when called on a child", async () => {
    // User clicked Stop on a child; endpoint should clear the ROOT's
    // rule + every sibling, not just the clicked child.
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t-child", title: "Instance 3", recurrenceParentId: "t-root", recurrenceRule: "weekly",
    } as any)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeRequest(), makeParams("t-child"))
    expect(res.status).toBe(200)

    const calls = vi.mocked(prisma.task.updateMany).mock.calls
    // First call should target the ROOT, not the clicked child
    expect((calls[0][0] as any).where.id).toBe("t-root")
    // Second call should target the root's children
    expect((calls[1][0] as any).where.recurrenceParentId).toBe("t-root")
  })

  it("wraps the two updates in a transaction (atomic stop)", async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t-root", title: "X", recurrenceParentId: null, recurrenceRule: "daily",
    } as any)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 } as any)

    await POST(makeRequest(), makeParams("t-root"))
    expect((prisma as any).$transaction).toHaveBeenCalledOnce()
  })

  it("scopes both updates by organizationId", async () => {
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t-root", title: "X", recurrenceParentId: null, recurrenceRule: "daily",
    } as any)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 } as any)

    await POST(makeRequest(), makeParams("t-root"))
    const calls = vi.mocked(prisma.task.updateMany).mock.calls
    expect((calls[0][0] as any).where.organizationId).toBe("org-1")
    expect((calls[1][0] as any).where.organizationId).toBe("org-1")
  })
})
