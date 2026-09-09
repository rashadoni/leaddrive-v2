import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// Pattern follows api-deals-bulk.test.ts. Uses the shared mockAuthSequence
// helper so the fragile "requireAuth called twice" ordering for delete
// permission re-check lives in one place. Roadmap #19 Phase C.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    socialMention: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
  logAudit: vi.fn(),
}))

// Delete branch fires clearDeletedMentionRefs + clearTaskRelationsMany (fire-and-forget
// cleanup, both query prisma models absent from this entity-only mock). Pre-existing gap,
// not the codemod; mock them so the delete happy-path validates auth + org-scoped delete.
vi.mock("@/lib/social/mention-refs", () => ({
  clearDeletedMentionRefs: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/tasks/clear-task-relations", () => ({
  clearTaskRelationsMany: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { POST } from "@/app/api/v1/leads/bulk/route"
import { prisma } from "@/lib/prisma"
import { mockAuthSequence } from "./helpers/bulk-auth"

function makeRequest(body: any) {
  return new Request("http://localhost/api/v1/leads/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: single auth check succeeds. Tests for the delete-permission
  // re-check override with their own sequence.
  mockAuthSequence([{ role: "admin" }])
})

describe("POST /api/v1/leads/bulk → action: delete", () => {
  it("re-checks leads:delete permission separately", async () => {
    mockAuthSequence([{ role: "sales" }, { error: 403 }])

    const res = await POST(makeRequest({ ids: ["l1", "l2"], action: "delete" }))
    expect(res.status).toBe(403)
    expect(prisma.lead.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes scoped by organizationId", async () => {
    mockAuthSequence([{ role: "admin" }, { role: "admin" }])

    const res = await POST(makeRequest({ ids: ["l1", "l2"], action: "delete" }))
    expect(res.status).toBe(200)
    expect(prisma.lead.deleteMany).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.lead.deleteMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["l1", "l2"] }, organizationId: "org-1" })
  })
})

describe("POST /api/v1/leads/bulk → action: update_status", () => {
  it("accepts allowed status values", async () => {
    for (const status of ["new", "contacted", "qualified", "lost"]) {
      vi.clearAllMocks()
      mockAuthSequence([{ role: "admin" }])
      const res = await POST(makeRequest({ ids: ["l1"], action: "update_status", value: status }))
      expect(res.status).toBe(200)
      const call = vi.mocked(prisma.lead.updateMany).mock.calls[0][0] as any
      expect(call.data.status).toBe(status)
    }
  })

  it("rejects `converted` with a hand-holding error pointing at the conversion endpoint", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "update_status", value: "converted" }))
    expect(res.status).toBe(400)
    expect(prisma.lead.updateMany).not.toHaveBeenCalled()
    const body = await res.json()
    // Architect P2: integrator hand-crafting a POST shouldn't have to
    // guess where the missing status went. Error explicitly names the
    // convert endpoint.
    expect(body.error).toMatch(/\/convert/)
    expect(body.error).toMatch(/per row/i)
  })

  it("rejects arbitrary status value", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "update_status", value: "weird_state" }))
    expect(res.status).toBe(400)
  })

  it("requires value (returns 400 when missing)", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "update_status" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/leads/bulk → action: reassign", () => {
  it("assigns to specified user", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "reassign", value: "u-42" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.lead.updateMany).mock.calls[0][0] as any
    expect(call.data.assignedTo).toBe("u-42")
  })

  it("unassigns when value is empty string (null FK)", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "reassign", value: "" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.lead.updateMany).mock.calls[0][0] as any
    expect(call.data.assignedTo).toBe(null)
  })
})

describe("POST /api/v1/leads/bulk → validation", () => {
  it("rejects ids array > 100", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `l${i}`)
    const res = await POST(makeRequest({ ids, action: "delete" }))
    expect(res.status).toBe(400)
  })

  it("rejects unknown action", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "nuke_everything" }))
    expect(res.status).toBe(400)
  })

  it("rejects empty ids array", async () => {
    const res = await POST(makeRequest({ ids: [], action: "delete" }))
    expect(res.status).toBe(400)
  })
})
