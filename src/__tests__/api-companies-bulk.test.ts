import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// Roadmap #19 Phase D. Same shape as deals/leads bulk endpoints; uses
// the shared `mockAuthSequence` helper for the delete-permission re-check.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
  logAudit: vi.fn(),
}))

// The delete branch fires clearTaskRelationsMany (fire-and-forget cleanup of task
// back-refs). Mock it so the delete happy-path test exercises the route's auth +
// org-scoped deleteMany, not the unrelated cleanup helper (which queries prisma.task,
// absent from this entity-only prisma mock — a pre-existing gap, not the codemod).
vi.mock("@/lib/tasks/clear-task-relations", () => ({
  clearTaskRelationsMany: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { POST } from "@/app/api/v1/companies/bulk/route"
import { prisma } from "@/lib/prisma"
import { mockAuthSequence } from "./helpers/bulk-auth"

function makeRequest(body: any) {
  return new Request("http://localhost/api/v1/companies/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSequence([{ role: "admin" }])
})

describe("POST /api/v1/companies/bulk → action: delete", () => {
  it("re-checks companies:delete permission separately", async () => {
    mockAuthSequence([{ role: "sales" }, { error: 403 }])

    const res = await POST(makeRequest({ ids: ["c1", "c2"], action: "delete" }))
    expect(res.status).toBe(403)
    expect(prisma.company.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes scoped by organizationId", async () => {
    mockAuthSequence([{ role: "admin" }, { role: "admin" }])

    const res = await POST(makeRequest({ ids: ["c1", "c2"], action: "delete" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.company.deleteMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["c1", "c2"] }, organizationId: "org-1" })
  })
})

describe("POST /api/v1/companies/bulk → action: update_status", () => {
  it("accepts each allowed status", async () => {
    for (const status of ["active", "inactive", "prospect"]) {
      vi.clearAllMocks()
      mockAuthSequence([{ role: "admin" }])
      const res = await POST(makeRequest({ ids: ["c1"], action: "update_status", value: status }))
      expect(res.status).toBe(200)
      const call = vi.mocked(prisma.company.updateMany).mock.calls[0][0] as any
      expect(call.data.status).toBe(status)
    }
  })

  it("rejects arbitrary status value", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "update_status", value: "weird" }))
    expect(res.status).toBe(400)
  })

  it("requires value", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "update_status" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/companies/bulk → action: update_category", () => {
  it("accepts each allowed category", async () => {
    for (const category of ["client", "partner", "prospect", "inactive"]) {
      vi.clearAllMocks()
      mockAuthSequence([{ role: "admin" }])
      const res = await POST(makeRequest({ ids: ["c1"], action: "update_category", value: category }))
      expect(res.status).toBe(200)
      const call = vi.mocked(prisma.company.updateMany).mock.calls[0][0] as any
      expect(call.data.category).toBe(category)
    }
  })

  it("rejects arbitrary category value", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "update_category", value: "weird" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/companies/bulk → validation", () => {
  it("rejects >100 ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${i}`)
    const res = await POST(makeRequest({ ids, action: "delete" }))
    expect(res.status).toBe(400)
  })

  it("rejects unknown action", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "nuke_everything" }))
    expect(res.status).toBe(400)
  })

  it("rejects empty ids array", async () => {
    const res = await POST(makeRequest({ ids: [], action: "delete" }))
    expect(res.status).toBe(400)
  })
})
