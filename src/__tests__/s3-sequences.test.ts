/**
 * S3 Sales Sequences — unit + route integration tests
 * v1.1: requireAuth wired to POST, email-type cron test, nextStepAt assertion,
 *       CRON_SECRET undef guard verified.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// ── Pure helper tests ────────────────────────────────────────────────────────

describe("computeNextStepAt", () => {
  it("returns same date/time when delayDays is 0", async () => {
    const { computeNextStepAt } = await import("@/lib/sequences")
    const base = new Date("2026-01-01T00:00:00Z")
    const result = computeNextStepAt(base, 0)
    expect(result.getTime()).toBe(base.getTime())
  })

  it("adds correct number of days (UTC arithmetic)", async () => {
    const { computeNextStepAt } = await import("@/lib/sequences")
    const base = new Date("2026-01-01T12:00:00Z")
    const result = computeNextStepAt(base, 3)
    // 3 × 86 400 000 ms = Jan 4 12:00 UTC
    expect(result.toISOString()).toBe("2026-01-04T12:00:00.000Z")
  })

  it("does not mutate the base date", async () => {
    const { computeNextStepAt } = await import("@/lib/sequences")
    const base = new Date("2026-06-15T00:00:00Z")
    const orig = base.getTime()
    computeNextStepAt(base, 10)
    expect(base.getTime()).toBe(orig)
  })

  it("workdaysOnly rolls a Saturday/Sunday due date to Monday", async () => {
    const { computeNextStepAt } = await import("@/lib/sequences")
    // 2026-07-11 = Sat, 07-12 = Sun, 07-13 = Mon, 07-14 = Tue
    const sat = computeNextStepAt(new Date("2026-07-11T10:00:00Z"), 0, { workdaysOnly: true })
    expect(sat.toISOString()).toBe("2026-07-13T10:00:00.000Z") // → Monday
    const sun = computeNextStepAt(new Date("2026-07-12T10:00:00Z"), 0, { workdaysOnly: true })
    expect(sun.toISOString()).toBe("2026-07-13T10:00:00.000Z") // → Monday
    // Weekday unchanged
    const tue = computeNextStepAt(new Date("2026-07-14T10:00:00Z"), 0, { workdaysOnly: true })
    expect(tue.toISOString()).toBe("2026-07-14T10:00:00.000Z")
    // Off (default) → weekend stays
    const off = computeNextStepAt(new Date("2026-07-11T10:00:00Z"), 0)
    expect(off.toISOString()).toBe("2026-07-11T10:00:00.000Z")
  })
})

// ── Route integration tests ──────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesSequence: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sequenceStep: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
    },
    sequenceEnrollment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    task: { create: vi.fn() },
    activity: { create: vi.fn() },
    lead: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET as GET_LIST, POST as POST_CREATE } from "@/app/api/v1/sequences/route"
import {
  GET as GET_ONE,
  PATCH as PATCH_ONE,
  DELETE as DELETE_ONE,
} from "@/app/api/v1/sequences/[id]/route"
import { POST as POST_ENROLL } from "@/app/api/v1/sequences/[id]/enroll/route"
import { GET as GET_ENROLLMENTS } from "@/app/api/v1/sequences/[id]/enrollments/route"
import { POST as POST_CRON } from "@/app/api/cron/sequences/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"

function req(url: string, init?: RequestInit) {
  return new Request(url, init) as any
}
function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

const MOCK_AUTH = { orgId: "org-1", userId: "user-1", role: "admin" as const }

const MOCK_SEQ = {
  id: "seq-1",
  organizationId: "org-1",
  name: "New Lead Follow-up",
  description: null,
  isActive: true,
  createdAt: new Date().toISOString(),
  steps: [],
  _count: { enrollments: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue(MOCK_AUTH as any)
  // Enroll now validates the entity + resolves the touch-queue owner
  vi.mocked(prisma.lead.findFirst).mockResolvedValue({ assignedTo: null } as any)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1" } as any)
  // Cron claims steps via guarded updateMany — default: claim succeeds
  vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)
  process.env.CRON_SECRET = "test-secret"
})

// ── GET /sequences ────────────────────────────────────────────────────────────
describe("GET /api/v1/sequences", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_LIST(req("http://localhost/api/v1/sequences"))
    expect(res.status).toBe(401)
  })

  it("returns list of sequences", async () => {
    vi.mocked(prisma.salesSequence.findMany).mockResolvedValue([MOCK_SEQ] as any)
    const res = await GET_LIST(req("http://localhost/api/v1/sequences"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe("New Lead Follow-up")
  })
})

// ── POST /sequences ───────────────────────────────────────────────────────────
describe("POST /api/v1/sequences", () => {
  it("returns 401 when requireAuth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    )
    const res = await POST_CREATE(
      req("http://localhost/api/v1/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for missing name", async () => {
    const res = await POST_CREATE(
      req("http://localhost/api/v1/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "no name" }),
      })
    )
    expect(res.status).toBe(400)
  })

  it("rejects an active sequence without active steps", async () => {
    const res = await POST_CREATE(
      req("http://localhost/api/v1/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Draft with no steps" }),
      })
    )
    expect(res.status).toBe(422)
    expect(vi.mocked(prisma.salesSequence.create)).not.toHaveBeenCalled()
  })

  it("creates an inactive draft without steps", async () => {
    vi.mocked(prisma.salesSequence.create).mockResolvedValue({
      ...MOCK_SEQ,
      isActive: false,
      createdBy: "user-1",
      steps: [],
      _count: { enrollments: 0 },
    } as any)
    const res = await POST_CREATE(
      req("http://localhost/api/v1/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Lead Follow-up", isActive: false }),
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    // createdBy is passed to prisma.create
    expect(vi.mocked(prisma.salesSequence.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdBy: "user-1" }),
      })
    )
  })

  it("creates an active sequence when at least one active step is present", async () => {
    vi.mocked(prisma.salesSequence.create).mockResolvedValue({
      ...MOCK_SEQ,
      createdBy: "user-1",
      steps: [
        { id: "s1", stepOrder: 1, type: "email", delayDays: 0, subject: "Hi", body: null, isActive: true },
      ],
      _count: { enrollments: 0 },
    } as any)
    const res = await POST_CREATE(
      req("http://localhost/api/v1/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Lead Follow-up",
          steps: [{ stepOrder: 1, type: "email", delayDays: 0, subject: "Hi", isActive: true }],
        }),
      })
    )
    expect(res.status).toBe(201)
  })
})

// ── GET /sequences/[id] ───────────────────────────────────────────────────────
describe("GET /api/v1/sequences/[id]", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(null)
    const res = await GET_ONE(req("http://localhost/api/v1/sequences/seq-99"), params("seq-99"))
    expect(res.status).toBe(404)
  })

  it("returns the sequence", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(MOCK_SEQ as any)
    const res = await GET_ONE(req("http://localhost/api/v1/sequences/seq-1"), params("seq-1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.id).toBe("seq-1")
  })
})

// ── PATCH /sequences/[id] ─────────────────────────────────────────────────────
describe("PATCH /api/v1/sequences/[id]", () => {
  it("returns 404 when sequence not found", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(null)
    const res = await PATCH_ONE(
      req("http://localhost/api/v1/sequences/seq-x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      params("seq-x")
    )
    expect(res.status).toBe(404)
  })

  it("updates name without touching steps", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(MOCK_SEQ as any)
    vi.mocked(prisma.salesSequence.update).mockResolvedValue({
      ...MOCK_SEQ,
      name: "Renamed",
      steps: [],
      _count: { enrollments: 0 },
    } as any)
    const res = await PATCH_ONE(
      req("http://localhost/api/v1/sequences/seq-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.name).toBe("Renamed")
    // When no steps in body, $transaction should NOT be called
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })

  it("rejects activation when the sequence has no active steps", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue({ ...MOCK_SEQ, isActive: false } as any)
    vi.mocked(prisma.sequenceStep.count).mockResolvedValue(0 as any)
    const res = await PATCH_ONE(
      req("http://localhost/api/v1/sequences/seq-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(422)
    expect(vi.mocked(prisma.salesSequence.update)).not.toHaveBeenCalled()
  })

  it("rejects edits that leave an active sequence without active steps", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue({ ...MOCK_SEQ, isActive: true } as any)
    const res = await PATCH_ONE(
      req("http://localhost/api/v1/sequences/seq-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: [
            { stepOrder: 1, type: "email", delayDays: 0, subject: "Hi", body: null, isActive: false },
          ],
        }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(422)
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled()
  })
})

// ── Regression: inactive steps survive an edit-and-save round-trip ────────────
// Bug was front-end (the editor seeded from the active-only list endpoint and
// re-sent only active steps, so the full-replace PATCH dropped inactive ones).
// These lock the API contract the fix relies on.
describe("PATCH /api/v1/sequences/[id] — inactive-step preservation", () => {
  it("preserves an inactive step sent in the payload (no silent data loss on edit)", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(MOCK_SEQ as any)
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.sequenceStep.deleteMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.sequenceStep.createMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.salesSequence.update).mockResolvedValue({ ...MOCK_SEQ, steps: [] } as any)

    const res = await PATCH_ONE(
      req("http://localhost/api/v1/sequences/seq-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Edited",
          steps: [
            { id: "active-1", stepOrder: 1, type: "email", delayDays: 0, subject: "Hi", body: null, isActive: true },
            { id: "inactive-1", stepOrder: 2, type: "call", delayDays: 1, subject: null, body: null, isActive: false },
          ],
        }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(200)

    const createArg = vi.mocked(prisma.sequenceStep.createMany).mock.calls[0][0] as any
    expect(createArg.data).toHaveLength(2)
    const inactive = createArg.data.find((s: any) => s.stepOrder === 2)
    expect(inactive).toBeDefined()
    expect(inactive.isActive).toBe(false)
  })

  it("GET /[id] returns inactive steps too (the data the editor reloads on open)", async () => {
    const SEQ_WITH_INACTIVE = {
      ...MOCK_SEQ,
      steps: [
        { id: "s1", stepOrder: 1, type: "email", delayDays: 0, subject: "Hi", body: null, isActive: true },
        { id: "s2", stepOrder: 2, type: "call", delayDays: 1, subject: null, body: null, isActive: false },
      ],
    }
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(SEQ_WITH_INACTIVE as any)
    const res = await GET_ONE(req("http://localhost/api/v1/sequences/seq-1"), params("seq-1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.steps).toHaveLength(2)
    expect(body.data.steps.some((s: any) => s.isActive === false)).toBe(true)
    // The single-sequence GET must NOT apply an isActive filter (unlike the list).
    const findArg = vi.mocked(prisma.salesSequence.findFirst).mock.calls[0][0] as any
    expect(findArg.include.steps.where).toBeUndefined()
  })
})

// ── DELETE /sequences/[id] ────────────────────────────────────────────────────
describe("DELETE /api/v1/sequences/[id]", () => {
  it("soft-stops active enrollments and deletes", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(MOCK_SEQ as any)
    vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prisma.salesSequence.delete).mockResolvedValue(MOCK_SEQ as any)

    const res = await DELETE_ONE(
      req("http://localhost/api/v1/sequences/seq-1", { method: "DELETE" }),
      params("seq-1")
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "stopped" }) })
    )
    expect(vi.mocked(prisma.salesSequence.delete)).toHaveBeenCalledWith({ where: { id: "seq-1" } })
  })
})

// ── POST /sequences/[id]/enroll ───────────────────────────────────────────────
describe("POST /api/v1/sequences/[id]/enroll", () => {
  const STEP = { id: "step-1", stepOrder: 1, type: "email", delayDays: 0, subject: "Hi", body: null, isActive: true }
  const SEQ_WITH_STEPS = { ...MOCK_SEQ, steps: [STEP] }

  it("returns 404 when sequence not found or inactive", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(null)
    const res = await POST_ENROLL(
      req("http://localhost/api/v1/sequences/seq-1/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "lead", entityId: "lead-1" }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(404)
  })

  it("returns 422 when sequence has no steps", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(MOCK_SEQ as any)
    const res = await POST_ENROLL(
      req("http://localhost/api/v1/sequences/seq-1/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "lead", entityId: "lead-1" }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(422)
  })

  it("returns 409 when entity already actively enrolled", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(SEQ_WITH_STEPS as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue({
      id: "enr-1",
      status: "active",
    } as any)
    const res = await POST_ENROLL(
      req("http://localhost/api/v1/sequences/seq-1/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "lead", entityId: "lead-1" }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(409)
  })

  it("creates enrollment with enrolledBy and returns 201", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(SEQ_WITH_STEPS as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue(null)
    const created = {
      id: "enr-new",
      sequenceId: "seq-1",
      entityType: "lead",
      entityId: "lead-1",
      enrolledBy: "user-1",
      status: "active",
      currentStep: 0,
      nextStepAt: new Date().toISOString(),
    }
    vi.mocked(prisma.sequenceEnrollment.create).mockResolvedValue(created as any)

    const res = await POST_ENROLL(
      req("http://localhost/api/v1/sequences/seq-1/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "lead", entityId: "lead-1" }),
      }),
      params("seq-1")
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.status).toBe("active")
    // Audit field populated from auth
    expect(vi.mocked(prisma.sequenceEnrollment.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enrolledBy: "user-1" }),
      })
    )
  })
})

// ── Cron POST /api/cron/sequences ────────────────────────────────────────────
describe("POST /api/cron/sequences", () => {
  it("returns 401 without cron secret", async () => {
    const res = await POST_CRON(req("http://localhost/api/cron/sequences", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("returns 503 when CRON_SECRET is unset (closed-by-default, no undefined===undefined bypass)", async () => {
    const saved = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    const res = await POST_CRON(
      req("http://localhost/api/cron/sequences", { method: "POST" })
    )
    expect(res.status).toBe(503)
    process.env.CRON_SECRET = saved
  })

  it("processes task-type step, advances enrollment, asserts nextStepAt", async () => {
    const NOW = new Date("2026-05-24T18:00:00Z")
    vi.setSystemTime(NOW)

    const STEP_1 = { id: "s1", stepOrder: 1, type: "task", delayDays: 0, subject: "Follow up", body: null, isActive: true }
    const STEP_2 = { id: "s2", stepOrder: 2, type: "email", delayDays: 1, subject: "Check in", body: null, isActive: true }

    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      {
        id: "enr-1",
        organizationId: "org-1",
        currentStep: 0,
        sequence: { id: "seq-1", name: "Cadence A", steps: [STEP_1, STEP_2] },
      },
    ] as any)

    // Mock $transaction to execute the callback
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "task-1" } as any)

    const res = await POST_CRON(
      req("http://localhost/api/cron/sequences", {
        method: "POST",
        headers: { "x-cron-secret": "test-secret" },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.advanced).toBe(1)

    // Task created for step 1
    expect(vi.mocked(prisma.task.create)).toHaveBeenCalledOnce()

    // Enrollment advanced to step 2 with correct nextStepAt (NOW + 1 day) via
    // the GUARDED claim (updateMany conditioned on status+currentStep)
    const expectedNextStepAt = new Date(NOW.getTime() + 86_400_000)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "enr-1", status: "active", currentStep: 0 }),
        data: expect.objectContaining({
          currentStep: 1,
          nextStepAt: expectedNextStepAt,
        }),
      })
    )

    vi.useRealTimers()
  })

  it("processes email-type step via Activity (uses subject not title)", async () => {
    const NOW = new Date("2026-05-24T18:00:00Z")
    vi.setSystemTime(NOW)

    const EMAIL_STEP = { id: "s1", stepOrder: 1, type: "email", delayDays: 0, subject: "Hello!", body: "Body text", isActive: true }

    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      {
        id: "enr-email",
        organizationId: "org-1",
        currentStep: 0,
        sequence: { id: "seq-email", name: "Email Cadence", steps: [EMAIL_STEP] },
      },
    ] as any)

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.activity.create).mockResolvedValue({ id: "act-1" } as any)

    const res = await POST_CRON(
      req("http://localhost/api/cron/sequences", {
        method: "POST",
        headers: { "x-cron-secret": "test-secret" },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.completed).toBe(1)

    // Activity uses `subject` field (not `title`) matching the schema
    expect(vi.mocked(prisma.activity.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: "Hello!" }),
      })
    )
    // No `title` key in the activity call
    const activityCall = vi.mocked(prisma.activity.create).mock.calls[0][0]
    expect((activityCall.data as any).title).toBeUndefined()

    vi.useRealTimers()
  })

  it("marks enrollment completed when last step executed", async () => {
    const ONLY_STEP = { id: "s1", stepOrder: 1, type: "call", delayDays: 0, subject: null, body: null, isActive: true }
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      {
        id: "enr-2",
        organizationId: "org-1",
        currentStep: 0,
        sequence: { id: "seq-2", name: "One-Step", steps: [ONLY_STEP] },
      },
    ] as any)

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "task-2" } as any)

    const res = await POST_CRON(
      req("http://localhost/api/cron/sequences", {
        method: "POST",
        headers: { "x-cron-secret": "test-secret" },
      })
    )
    const body = await res.json()
    expect(body.completed).toBe(1)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "enr-2", status: "active", currentStep: 0 }),
        data: expect.objectContaining({ status: "completed" }),
      })
    )
  })

  it("skips the side-effect when the guarded claim loses the race (count 0)", async () => {
    const ONLY_STEP = { id: "s1", stepOrder: 1, type: "call", delayDays: 0, subject: null, body: null, isActive: true }
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      {
        id: "enr-race",
        organizationId: "org-1",
        currentStep: 0,
        sequence: { id: "seq-2", name: "One-Step", steps: [ONLY_STEP] },
      },
    ] as any)
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await POST_CRON(
      req("http://localhost/api/cron/sequences", {
        method: "POST",
        headers: { "x-cron-secret": "test-secret" },
      })
    )
    const body = await res.json()
    expect(body.skipped).toBe(1)
    expect(body.completed).toBe(0)
    expect(vi.mocked(prisma.task.create)).not.toHaveBeenCalled()
  })

  it("sms/whatsapp steps create a Task (rep-actioned), not an Activity", async () => {
    const WA_STEP = { id: "s1", stepOrder: 1, type: "whatsapp", delayDays: 0, subject: null, body: "hi", isActive: true }
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-wa", organizationId: "org-1", currentStep: 0,
        entityType: "lead", entityId: "lead-1",
        sequence: { id: "seq-1", name: "Cadence", steps: [WA_STEP] } },
    ] as any)
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "task-wa" } as any)

    const res = await POST_CRON(
      req("http://localhost/api/cron/sequences", { method: "POST", headers: { "x-cron-secret": "test-secret" } })
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.task.create)).toHaveBeenCalledOnce()
    expect(vi.mocked(prisma.activity.create)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.task.create).mock.calls[0][0].data.title).toContain("WhatsApp")
  })

  it("owned enrollments are only fetched past the grace window (query shape)", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([] as any)
    await POST_CRON(
      req("http://localhost/api/cron/sequences", {
        method: "POST",
        headers: { "x-cron-secret": "test-secret" },
      })
    )
    const where = vi.mocked(prisma.sequenceEnrollment.findMany).mock.calls[0][0].where
    expect(where.OR).toHaveLength(2)
    expect(where.OR[0]).toEqual({ ownerId: null, nextStepAt: expect.anything() })
    expect(where.OR[1].ownerId).toEqual({ not: null })
    // owned cutoff is strictly earlier than the ownerless cutoff
    expect(where.OR[1].nextStepAt.lte.getTime()).toBeLessThan(where.OR[0].nextStepAt.lte.getTime())
  })
})
