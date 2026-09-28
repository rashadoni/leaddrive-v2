import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// Pattern follows api-deals-bulk.test.ts. Uses the shared mockAuthSequence
// helper so the fragile "requireAuth called twice" ordering for delete
// permission re-check lives in one place. Roadmap #19 Phase C.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    socialMention: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
  logAudit: vi.fn(),
}))

// The two write actions run the shared command once per lead (roadmap C1.13),
// so the route's contract is what it asks the command to do — not a `where`
// clause it hands to Prisma.
const commandMock = vi.hoisted(() => ({ updateLead: vi.fn(async () => ({ entity: { id: "l1" } })) }))
vi.mock("@/lib/crm-commands/lead/update-lead", () => ({ updateLeadCommand: commandMock.updateLead }))
vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn(async (_o: string, _u: string, _r: string, _t: string, where: object) => where),
}))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => {}) }))

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
import { prisma, logAudit } from "@/lib/prisma"
import { fireWebhooks } from "@/lib/webhooks"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { CrmCommandError } from "@/lib/crm-commands/errors"
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
  commandMock.updateLead.mockReset()
  commandMock.updateLead.mockResolvedValue({ entity: { id: "l1" } })
  vi.mocked(prisma.lead.findMany).mockResolvedValue([])
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
    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      { id: "l1", contactName: "Ali" }, { id: "l2", contactName: "Aysel" },
    ] as never)
    vi.mocked(prisma.lead.deleteMany).mockResolvedValue({ count: 2 } as never)

    const res = await POST(makeRequest({ ids: ["l1", "l2"], action: "delete" }))
    expect(res.status).toBe(200)
    expect(prisma.lead.deleteMany).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.lead.deleteMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["l1", "l2"] }, organizationId: "org-1" })
  })

  // A seller could delete leads that are not theirs and that they cannot even
  // open: the single-lead DELETE has always applied the record filter.
  it("only deletes leads the caller may see", async () => {
    mockAuthSequence([{ role: "admin" }, { role: "admin" }])
    vi.mocked(prisma.lead.findMany).mockResolvedValue([{ id: "l1", contactName: "Ali" }] as never)
    vi.mocked(prisma.lead.deleteMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST(makeRequest({ ids: ["l1", "l2"], action: "delete" }))
    expect(applyRecordFilter).toHaveBeenCalledWith("org-1", expect.anything(), "admin", "lead", expect.anything())
    const call = vi.mocked(prisma.lead.deleteMany).mock.calls[0][0] as any
    expect(call.where.id.in).toEqual(["l1"])
    expect(await res.json()).toMatchObject({ affected: 1, failed: [{ id: "l2", code: "NOT_FOUND" }] })
  })

  // An integration that only hears about one-by-one deletions has an
  // incomplete picture of the CRM.
  it("announces every deletion, as the single-lead route does", async () => {
    mockAuthSequence([{ role: "admin" }, { role: "admin" }])
    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      { id: "l1", contactName: "Ali" }, { id: "l2", contactName: "Aysel" },
    ] as never)
    vi.mocked(prisma.lead.deleteMany).mockResolvedValue({ count: 2 } as never)

    await POST(makeRequest({ ids: ["l1", "l2"], action: "delete" }))
    expect(fireWebhooks).toHaveBeenCalledTimes(2)
    expect(fireWebhooks).toHaveBeenCalledWith("org-1", "lead.deleted", { id: "l1", contactName: "Ali" })
  })

  it("deletes nothing when none of the leads are visible", async () => {
    mockAuthSequence([{ role: "admin" }, { role: "admin" }])
    const res = await POST(makeRequest({ ids: ["l1"], action: "delete" }))
    expect(prisma.lead.deleteMany).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ affected: 0 })
  })
})

describe("POST /api/v1/leads/bulk → action: update_status", () => {
  it("accepts allowed status values", async () => {
    for (const status of ["new", "contacted", "qualified", "lost"]) {
      vi.clearAllMocks()
      mockAuthSequence([{ role: "admin" }])
      commandMock.updateLead.mockResolvedValue({ entity: { id: "l1" } })
      const res = await POST(makeRequest({ ids: ["l1"], action: "update_status", value: status }))
      expect(res.status).toBe(200)
      expect(commandMock.updateLead).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1", source: "rest" }),
        "l1",
        { status },
      )
    }
  })

  // Everything a single status change does — workflow, notification, scoring,
  // webhook, an audit row naming the author — happens because the command
  // happens. Writing the column directly is how a bulk action becomes a
  // different feature from the button next to it.
  it("runs the shared command once per lead, never a bare updateMany", async () => {
    const res = await POST(makeRequest({ ids: ["l1", "l2", "l3"], action: "update_status", value: "lost" }))
    expect(commandMock.updateLead).toHaveBeenCalledTimes(3)
    expect(prisma.lead.updateMany).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ affected: 3, failed: [] })
  })

  // It used to answer `affected: ids.length` without looking.
  it("reports what actually changed, and what did not", async () => {
    commandMock.updateLead
      .mockResolvedValueOnce({ entity: { id: "l1" } })
      .mockRejectedValueOnce(new CrmCommandError("NOT_FOUND", "Not found", 404))
      .mockResolvedValueOnce({ entity: { id: "l3" } })

    const res = await POST(makeRequest({ ids: ["l1", "l2", "l3"], action: "update_status", value: "lost" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ affected: 2, failed: [{ id: "l2", code: "NOT_FOUND" }] })
    expect(logAudit).toHaveBeenCalledWith(
      "org-1", "bulk_update", "lead", "l1,l2,l3",
      expect.stringContaining("Updated 2 leads"),
      expect.objectContaining({ userId: expect.anything() }),
    )
  })

  it("keeps going when one lead fails", async () => {
    commandMock.updateLead.mockRejectedValueOnce(new CrmCommandError("FORBIDDEN_FIELD", "no", 403))
    const res = await POST(makeRequest({ ids: ["l1", "l2"], action: "update_status", value: "lost" }))
    expect(commandMock.updateLead).toHaveBeenCalledTimes(2)
    expect(await res.json()).toMatchObject({ affected: 1, failed: [{ id: "l1", code: "FORBIDDEN_FIELD" }] })
  })

  it("rejects `converted` with a hand-holding error pointing at the conversion endpoint", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "update_status", value: "converted" }))
    expect(res.status).toBe(400)
    expect(commandMock.updateLead).not.toHaveBeenCalled()
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
    expect(commandMock.updateLead).toHaveBeenCalledWith(expect.anything(), "l1", { assignedTo: "u-42" })
  })

  it("unassigns when value is empty string (null FK)", async () => {
    const res = await POST(makeRequest({ ids: ["l1"], action: "reassign", value: "" }))
    expect(res.status).toBe(200)
    expect(commandMock.updateLead).toHaveBeenCalledWith(expect.anything(), "l1", { assignedTo: null })
  })

  // The endpoint used to accept any string as the new owner, including a user
  // of another organisation. The command checks membership; the route's job is
  // to surface the refusal instead of writing it.
  it("surfaces a refused owner instead of writing it", async () => {
    commandMock.updateLead.mockRejectedValue(new CrmCommandError("VALIDATION_FAILED", "Assignee must be an active member", 400))
    const res = await POST(makeRequest({ ids: ["l1"], action: "reassign", value: "u-from-another-org" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ affected: 0, failed: [{ id: "l1", code: "VALIDATION_FAILED" }] })
    expect(prisma.lead.updateMany).not.toHaveBeenCalled()
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
