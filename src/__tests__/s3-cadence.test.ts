/**
 * Sales cadence — touch queue, complete-step, auto-exit, analytics, enroll owner.
 * Follows the s3-sequences.test.ts mock pattern (real withRls/withRlsAuth wrappers,
 * mocked @/lib/api-auth + @/lib/prisma).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesSequence: { findFirst: vi.fn(), findMany: vi.fn() },
    sequenceEnrollment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    lead: { findFirst: vi.fn(), findMany: vi.fn() },
    contact: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    activity: { create: vi.fn() },
    task: { create: vi.fn(), findFirst: vi.fn() },
    surveyUnsubscribe: { findFirst: vi.fn(), create: vi.fn() },
    emailLog: { findFirst: vi.fn(), count: vi.fn() },
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

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}))

import { GET as GET_TOUCHES } from "@/app/api/v1/sequences/touches/route"
import { POST as POST_COMPLETE } from "@/app/api/v1/sequences/enrollments/[enrollmentId]/complete-step/route"
import { GET as GET_ANALYTICS } from "@/app/api/v1/sequences/analytics/route"
import { GET as GET_PARTICIPANTS } from "@/app/api/v1/sequences/[id]/enrollments/route"
import { POST as POST_SEND_EMAIL } from "@/app/api/v1/sequences/enrollments/[enrollmentId]/send-email/route"
import { sendEmail } from "@/lib/email"
import { POST as POST_ENROLL } from "@/app/api/v1/sequences/[id]/enroll/route"
import { POST as POST_ENROLL_BULK } from "@/app/api/v1/sequences/[id]/enroll-bulk/route"
import { PATCH as PATCH_ENROLLMENT } from "@/app/api/v1/sequences/[id]/enrollments/[enrollmentId]/route"
import { autoExitSequenceEnrollments } from "@/lib/sequence-auto-exit"
import { autoEnrollLeadIntoSequences } from "@/lib/sequences-auto-enroll"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { createNotification } from "@/lib/notifications"

function req(url: string, init?: RequestInit) {
  return new Request(url, init) as any
}
function params(enrollmentId: string) {
  return { params: Promise.resolve({ enrollmentId }) }
}
function seqParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const MOCK_AUTH = { orgId: "org-1", userId: "user-1", role: "admin" as const }
const NOW = new Date("2026-07-09T10:00:00.000Z")

const STEPS = [
  { id: "st-1", stepOrder: 1, type: "call", delayDays: 0, subject: "Intro call", body: null, isActive: true },
  { id: "st-2", stepOrder: 2, type: "email", delayDays: 2, subject: "Follow-up", body: "Hi {{name}}", isActive: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue(MOCK_AUTH as any)
  vi.mocked(prisma.task.create).mockResolvedValue({} as any)
  vi.mocked(prisma.task.findFirst).mockResolvedValue(null as any) // no open reply-task → dedup passes
  vi.mocked(prisma.surveyUnsubscribe.findFirst).mockResolvedValue(null as any) // not suppressed by default
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any) // no daily limit by default
  vi.mocked(prisma.emailLog.count).mockResolvedValue(0 as any)
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── GET /sequences/touches ───────────────────────────────────────────────────
describe("GET /api/v1/sequences/touches", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any)
    const res = await GET_TOUCHES(req("http://localhost/api/v1/sequences/touches"))
    expect(res.status).toBe(401)
  })

  it("resolves due touches (lead + contact) and flags overdue; owner=me filters by userId", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      {
        id: "enr-1", sequenceId: "seq-1", entityType: "lead", entityId: "lead-1",
        currentStep: 0, nextStepAt: new Date("2026-07-07T09:00:00Z"), // overdue (before today)
        sequence: { name: "Outbound", steps: STEPS },
      },
      {
        id: "enr-2", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1",
        currentStep: 1, nextStepAt: new Date("2026-07-09T15:00:00Z"), // today
        sequence: { name: "Outbound", steps: STEPS },
      },
      {
        id: "enr-3", sequenceId: "seq-1", entityType: "lead", entityId: "lead-2",
        currentStep: 5, nextStepAt: new Date("2026-07-09T15:00:00Z"), // beyond steps → excluded
        sequence: { name: "Outbound", steps: STEPS },
      },
    ] as any)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      { id: "lead-1", contactName: "Elvin M.", companyName: "ATL", phone: "+99450", phoneWhatsApp: null, email: "e@x.az" },
      { id: "lead-2", contactName: "Ghost", companyName: null, phone: null, phoneWhatsApp: null, email: null },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: "ct-1", fullName: "Nigar A.", phone: null, email: "n@bakcell.az", company: { name: "Bakcell" } },
    ] as any)
    vi.mocked(prisma.sequenceEnrollment.count)
      .mockResolvedValueOnce(3 as any)  // dueTotal (DB truth incl. the excluded row)
      .mockResolvedValueOnce(1 as any)  // overdueTotal

    const res = await GET_TOUCHES(req("http://localhost/api/v1/sequences/touches?owner=me"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.touches).toHaveLength(2)
    const [first, second] = body.data.touches
    expect(first.entityName).toBe("Elvin M.")
    expect(first.overdue).toBe(true)
    expect(first.stepType).toBe("call")
    expect(first.stepNumber).toBe(1)
    expect(second.entityName).toBe("Nigar A.")
    expect(second.entityCompany).toBe("Bakcell")
    expect(second.overdue).toBe(false)
    expect(second.stepType).toBe("email")
    expect(body.data.overdueTotal).toBe(1)
    expect(body.data.dueTotal).toBe(3) // from count(), not the rendered page

    // PR-1: contact context resolved for the queue
    expect(first.entityPhone).toBe("+99450") // call touch → phone
    expect(first.entityHref).toBe("/leads/lead-1")
    expect(second.entityEmail).toBe("n@bakcell.az") // email touch → email
    expect(second.entityHref).toBe("/contacts/ct-1")

    const where = vi.mocked(prisma.sequenceEnrollment.findMany).mock.calls[0][0].where
    expect(where.ownerId).toBe("user-1")
    expect(where.status).toBe("active")
  })

  it("owner=all drops the owner filter", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.sequenceEnrollment.count).mockResolvedValue(0 as any)
    const res = await GET_TOUCHES(req("http://localhost/api/v1/sequences/touches?owner=all"))
    expect(res.status).toBe(200)
    const where = vi.mocked(prisma.sequenceEnrollment.findMany).mock.calls[0][0].where
    expect("ownerId" in where).toBe(false)
  })
})

// ── POST /sequences/enrollments/[id]/complete-step ───────────────────────────
describe("POST complete-step", () => {
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    // guarded claim default: succeeds
    vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)
  })

  // ── E3: «Opt-out» outcome ──
  it("opt_out stops the enrollment and suppresses the entity's email org-wide", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "enr-1", organizationId: "org-1", status: "active", currentStep: 0,
      entityType: "contact", entityId: "ct-1",
      sequence: { name: "Outbound", workdaysOnly: false, steps: STEPS },
    } as any)
    vi.mocked(prisma.activity.create).mockResolvedValue({} as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ email: "n@x.az" } as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "ct-1" }] as any)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([] as any)

    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "opt_out" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).suppressed).toBe(true)
    // this enrollment stopped with opted_out (first updateMany call)
    const stop = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0] as any
    expect(stop.data).toMatchObject({ status: "stopped", exitReason: "opted_out", lastOutcome: "opt_out" })
    // org-wide suppression written for the entity email
    expect(vi.mocked(prisma.surveyUnsubscribe.create).mock.calls[0][0].data).toMatchObject({
      organizationId: "org-1", email: "n@x.az", surveyId: null,
    })
  })

  it("404 for unknown enrollment", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(null)
    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "done" }) }),
      params("nope"),
    )
    expect(res.status).toBe(404)
  })

  it("409 when enrollment is not active", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "enr-1", status: "paused", currentStep: 0,
      sequence: { name: "Outbound", steps: STEPS },
    } as any)
    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "done" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(409)
  })

  it("logs an Activity and advances to the next step with its delay", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "enr-1", organizationId: "org-1", status: "active", currentStep: 0,
      entityType: "contact", entityId: "ct-1",
      sequence: { name: "Outbound", steps: STEPS },
    } as any)

    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "done", note: "answered" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)

    const activity = vi.mocked(prisma.activity.create).mock.calls[0][0].data
    expect(activity.type).toBe("call") // step 1 is a call
    expect(activity.contactId).toBe("ct-1")
    expect(activity.createdBy).toBe("user-1")
    expect(activity.description).toBe("answered")

    // Guarded claim: conditioned on status + the step we read
    const claim = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: "enr-1", status: "active", currentStep: 0 })
    expect(claim.data.currentStep).toBe(1)
    expect(claim.data.lastOutcome).toBe("done")
    // next step delayDays=2 → NOW + 2 days
    expect(new Date(claim.data.nextStepAt).toISOString()).toBe("2026-07-11T10:00:00.000Z")
  })

  it("409 when the claim loses the race (cron or another user advanced it)", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "enr-1", organizationId: "org-1", status: "active", currentStep: 0,
      entityType: "contact", entityId: "ct-1",
      sequence: { name: "Outbound", steps: STEPS },
    } as any)
    vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "done" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(409)
    expect(vi.mocked(prisma.activity.create)).not.toHaveBeenCalled()
  })

  it("completes the enrollment on the last step", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "enr-1", organizationId: "org-1", status: "active", currentStep: 1,
      entityType: "lead", entityId: "lead-1",
      sequence: { name: "Outbound", steps: STEPS },
    } as any)

    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "skipped" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    const claim = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: "enr-1", status: "active", currentStep: 1 })
    expect(claim.data.status).toBe("completed")
    expect(claim.data.nextStepAt).toBeNull()
    expect(claim.data.lastOutcome).toBe("skipped")
    // lead enrollment must NOT set contactId on the activity
    const activity = vi.mocked(prisma.activity.create).mock.calls[0][0].data
    expect(activity.contactId).toBeUndefined()
  })

  it("rejects an unknown outcome", async () => {
    const res = await POST_COMPLETE(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ outcome: "party" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(400)
  })
})

// ── auto-exit lib ────────────────────────────────────────────────────────────
describe("autoExitSequenceEnrollments", () => {
  it("stops matching enrollments on reply, stamps repliedAt, notifies owners", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: "user-2", sequence: { name: "Outbound", exitOnReply: true, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
      { id: "enr-2", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: null, enrolledBy: "user-3", sequence: { name: "Outbound", exitOnReply: true, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)

    const n = await autoExitSequenceEnrollments({
      organizationId: "org-1",
      trigger: "replied",
      contactId: "ct-1",
    })
    expect(n).toBe(2)

    const where = vi.mocked(prisma.sequenceEnrollment.findMany).mock.calls[0][0].where
    // NO flag filter in the query — outcome stamping must happen regardless
    expect(where.sequence).toBeUndefined()
    expect(where.OR).toEqual([{ entityType: "contact", entityId: "ct-1" }])

    const upd = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(upd.where.id.in).toEqual(["enr-1", "enr-2"])
    expect(upd.data.status).toBe("stopped")
    expect(upd.data.exitReason).toBe("replied")
    expect(upd.data.repliedAt).toBeInstanceOf(Date)
    expect(upd.data.meetingBookedAt).toBeUndefined()

    // notification targets: ownerId first, enrolledBy fallback
    const notified = vi.mocked(createNotification).mock.calls.map((c) => c[0].userId)
    expect(notified).toEqual(["owner-1", "user-3"])

    // E2: ONE deduped follow-up task per person (both enrollments share ct-1)
    const tasks = vi.mocked(prisma.task.create).mock.calls.map((c: any) => c[0].data)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ relatedType: "contact", relatedId: "ct-1", priority: "high", assignedTo: "owner-1" })
    expect(tasks[0].title).toContain("Client replied")
  })

  // ── E2 reply reactions ──
  it("replyReaction=pause pauses (keeps nextStepAt) instead of stopping", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null,
        sequence: { name: "Outbound", exitOnReply: true, replyReaction: "pause", exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)
    const n = await autoExitSequenceEnrollments({ organizationId: "org-1", trigger: "replied", contactId: "ct-1" })
    expect(n).toBe(1)
    const upd = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(upd.data.status).toBe("paused")
    expect(upd.data.nextStepAt).toBeUndefined() // survives for resume
    expect(upd.data.repliedAt).toBeInstanceOf(Date)
    const note = vi.mocked(createNotification).mock.calls[0][0]
    expect(note.title).toContain("paused")
  })

  it("replyReaction=continue overrides legacy exitOnReply=true (stamp only)", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null,
        sequence: { name: "Outbound", exitOnReply: true, replyReaction: "continue", exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)
    const n = await autoExitSequenceEnrollments({ organizationId: "org-1", trigger: "replied", contactId: "ct-1" })
    expect(n).toBe(0)
    const upd = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(upd.data.status).toBeUndefined()
    expect(upd.where.repliedAt).toBeNull()
  })

  it("third-party reply: alert only — no stop, no stamp, no task", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null,
        sequence: { name: "Outbound", exitOnReply: true, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "ct-1", email: "enrolled@x.az" }] as any)
    const n = await autoExitSequenceEnrollments({
      organizationId: "org-1", trigger: "replied", contactId: "ct-1",
      fromEmail: "colleague@other.az",
    })
    expect(n).toBe(0)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.task.create)).not.toHaveBeenCalled()
    const note = vi.mocked(createNotification).mock.calls[0][0]
    expect(note.type).toBe("warning")
    expect(note.title).toContain("Third-party")
  })

  it("enrolled person WITHOUT an email on file → unverifiable sender treated as third party", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null,
        sequence: { name: "Outbound", exitOnReply: true, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "ct-1", email: null }] as any)
    const n = await autoExitSequenceEnrollments({
      organizationId: "org-1", trigger: "replied", contactId: "ct-1",
      fromEmail: "whoever@somewhere.test",
    })
    expect(n).toBe(0)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(createNotification).mock.calls[0][0].title).toContain("Third-party")
  })

  it("fromEmail matching the enrolled person is NOT a third party (case-insensitive)", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null,
        sequence: { name: "Outbound", exitOnReply: true, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "ct-1", email: "Enrolled@X.az" }] as any)
    const n = await autoExitSequenceEnrollments({
      organizationId: "org-1", trigger: "replied", contactId: "ct-1",
      fromEmail: "enrolled@x.az",
    })
    expect(n).toBe(1)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0].data.status).toBe("stopped")
  })

  it("exit rule OFF: stamps repliedAt (analytics) but does NOT stop the enrollment", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null,
        sequence: { name: "Outbound", exitOnReply: false, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)

    const n = await autoExitSequenceEnrollments({
      organizationId: "org-1",
      trigger: "replied",
      contactId: "ct-1",
    })
    expect(n).toBe(0) // nothing STOPPED

    // one updateMany: stamp-only, first-reply-wins (repliedAt: null in where)
    const calls = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls
    expect(calls).toHaveLength(1)
    const upd = calls[0][0]
    expect(upd.where.repliedAt).toBeNull()
    expect(upd.data.repliedAt).toBeInstanceOf(Date)
    expect(upd.data.status).toBeUndefined()

    expect(vi.mocked(createNotification)).not.toHaveBeenCalled()
  })

  it("resolves lead + contact by email when ids are unknown (email-inbound path)", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-9" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-9" } as any)
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([] as any)

    const n = await autoExitSequenceEnrollments({
      organizationId: "org-1",
      trigger: "replied",
      email: "reply@example.com",
    })
    expect(n).toBe(0)
    const where = vi.mocked(prisma.sequenceEnrollment.findMany).mock.calls[0][0].where
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { entityType: "lead", entityId: "lead-9" },
        { entityType: "contact", entityId: "ct-9" },
      ]),
    )
  })

  it("meeting trigger stops per exitOnMeeting and stamps meetingBookedAt", async () => {
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "enr-1", sequenceId: "seq-1", entityType: "contact", entityId: "ct-1", ownerId: "owner-1", enrolledBy: null, sequence: { name: "Outbound", exitOnReply: true, replyReaction: null, exitOnMeeting: true, exitOnDealClosed: true } },
    ] as any)
    await autoExitSequenceEnrollments({ organizationId: "org-1", trigger: "meeting_booked", contactId: "ct-1" })
    const upd = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(upd.data.status).toBe("stopped")
    expect(upd.data.meetingBookedAt).toBeInstanceOf(Date)
    expect(upd.data.repliedAt).toBeUndefined()
  })

  it("returns 0 with no refs and never throws on DB errors", async () => {
    expect(await autoExitSequenceEnrollments({ organizationId: "org-1", trigger: "replied" })).toBe(0)
    vi.mocked(prisma.sequenceEnrollment.findMany).mockRejectedValue(new Error("boom"))
    expect(
      await autoExitSequenceEnrollments({ organizationId: "org-1", trigger: "replied", contactId: "ct-1" }),
    ).toBe(0)
  })
})

// ── GET /sequences/analytics ─────────────────────────────────────────────────
describe("GET /api/v1/sequences/analytics", () => {
  it("aggregates per-sequence and org-wide reply/meeting stats", async () => {
    vi.mocked(prisma.sequenceEnrollment.groupBy)
      .mockResolvedValueOnce([ // totals
        { sequenceId: "seq-1", _count: { _all: 10 } },
        { sequenceId: "seq-2", _count: { _all: 4 } },
      ] as any)
      .mockResolvedValueOnce([ // replied (+avg currentStep)
        { sequenceId: "seq-1", _count: { _all: 4 }, _avg: { currentStep: 2.5 } },
      ] as any)
      .mockResolvedValueOnce([ // meetings
        { sequenceId: "seq-1", _count: { _all: 2 } },
      ] as any)
      .mockResolvedValueOnce([] as any) // stepDist
      .mockResolvedValueOnce([] as any) // activeStepDist (E5)
      .mockResolvedValueOnce([] as any) // ownerTotals
      .mockResolvedValueOnce([] as any) // ownerReplied
      .mockResolvedValueOnce([] as any) // ownerMeetings
    vi.mocked(prisma.sequenceEnrollment.count).mockResolvedValue(7)
    vi.mocked(prisma.salesSequence.findMany).mockResolvedValue([] as any)

    const res = await GET_ANALYTICS(req("http://localhost/api/v1/sequences/analytics"))
    expect(res.status).toBe(200)
    const { data } = await res.json()

    const seq1 = data.sequences.find((s: any) => s.sequenceId === "seq-1")
    expect(seq1.replyRate).toBe(40)
    expect(seq1.meetings).toBe(2)
    expect(seq1.avgTouchesToReply).toBe(2.5)
    const seq2 = data.sequences.find((s: any) => s.sequenceId === "seq-2")
    expect(seq2.replyRate).toBe(0)
    expect(seq2.avgTouchesToReply).toBeNull()

    expect(data.org.activeEnrollments).toBe(7)
    expect(data.org.total).toBe(14)
    expect(data.org.replied).toBe(4)
    expect(data.org.replyRate).toBe(29) // 4/14
    expect(data.org.avgTouchesToReply).toBe(2.5)
  })

  it("builds a monotonic step funnel (reached = enrollments that executed the step)", async () => {
    vi.mocked(prisma.sequenceEnrollment.groupBy)
      .mockResolvedValueOnce([{ sequenceId: "seq-1", _count: { _all: 5 } }] as any) // totals
      .mockResolvedValueOnce([] as any) // replied
      .mockResolvedValueOnce([] as any) // meetings
      // stepDist: currentStep distribution. currentStep=k ⇒ executed steps 0..k-1.
      // 2 at step0, 1 at step1, 2 at step3 (3-step sequence).
      .mockResolvedValueOnce([
        { sequenceId: "seq-1", currentStep: 0, _count: { _all: 2 } },
        { sequenceId: "seq-1", currentStep: 1, _count: { _all: 1 } },
        { sequenceId: "seq-1", currentStep: 3, _count: { _all: 2 } },
      ] as any)
      // E5 activeStepDist: ACTIVE-only current step. 1 active at step0, 2 at step1.
      .mockResolvedValueOnce([
        { sequenceId: "seq-1", currentStep: 0, _count: { _all: 1 } },
        { sequenceId: "seq-1", currentStep: 1, _count: { _all: 2 } },
      ] as any)
      .mockResolvedValueOnce([] as any) // ownerTotals
      .mockResolvedValueOnce([] as any) // ownerReplied
      .mockResolvedValueOnce([] as any) // ownerMeetings
    vi.mocked(prisma.sequenceEnrollment.count).mockResolvedValue(0)
    vi.mocked(prisma.salesSequence.findMany).mockResolvedValue([
      {
        id: "seq-1", name: "Onboarding",
        steps: [
          { stepOrder: 1, type: "email", subject: "Hi" },
          { stepOrder: 2, type: "call", subject: null },
          { stepOrder: 3, type: "task", subject: null },
        ],
      },
    ] as any)

    const res = await GET_ANALYTICS(req("http://localhost/api/v1/sequences/analytics"))
    const { data } = await res.json()
    const f = data.funnel.find((x: any) => x.sequenceId === "seq-1")
    expect(f).toBeTruthy()
    // step0 executed by currentStep>0 → 1+2=3; step1 by currentStep>1 → 2; step2 by currentStep>2 → 2
    expect(f.steps.map((s: any) => s.reached)).toEqual([3, 2, 2])
    // entered = ALL enrolled for the sequence (totals=5), incl. the 2 still at step 0
    expect(f.entered).toBe(5)
    // monotonic non-increasing
    const reached = f.steps.map((s: any) => s.reached)
    expect(reached.every((v: number, i: number) => i === 0 || v <= reached[i - 1])).toBe(true)
    // E5 — active enrollments waiting AT each step right now
    expect(f.steps.map((s: any) => s.activeHere)).toEqual([1, 2, 0])
  })

  it("ranks a rep leaderboard by enrollments and resolves owner names", async () => {
    vi.mocked(prisma.sequenceEnrollment.groupBy)
      .mockResolvedValueOnce([] as any) // totals
      .mockResolvedValueOnce([] as any) // replied
      .mockResolvedValueOnce([] as any) // meetings
      .mockResolvedValueOnce([] as any) // stepDist
      .mockResolvedValueOnce([] as any) // activeStepDist (E5)
      .mockResolvedValueOnce([ // ownerTotals
        { ownerId: "u-1", _count: { _all: 3 } },
        { ownerId: "u-2", _count: { _all: 8 } },
        { ownerId: null, _count: { _all: 2 } },
      ] as any)
      .mockResolvedValueOnce([ // ownerReplied
        { ownerId: "u-2", _count: { _all: 4 } },
      ] as any)
      .mockResolvedValueOnce([ // ownerMeetings
        { ownerId: "u-2", _count: { _all: 1 } },
      ] as any)
    vi.mocked(prisma.sequenceEnrollment.count).mockResolvedValue(0)
    vi.mocked(prisma.salesSequence.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u-1", name: "Alice" },
      { id: "u-2", name: "Bob" },
    ] as any)

    const res = await GET_ANALYTICS(req("http://localhost/api/v1/sequences/analytics"))
    const { data } = await res.json()
    // busiest first, unassigned (null) sinks to the end
    expect(data.leaderboard.map((r: any) => r.ownerId)).toEqual(["u-2", "u-1", null])
    const bob = data.leaderboard[0]
    expect(bob.ownerName).toBe("Bob")
    expect(bob.replyRate).toBe(50) // 4/8
    expect(bob.meetings).toBe(1)
    const unassigned = data.leaderboard.find((r: any) => r.ownerId === null)
    expect(unassigned.ownerName).toBeNull()
  })
})

// ── POST send-email (email step actually sends) ──────────────────────────────
describe("POST send-email", () => {
  const emailEnrollment = {
    id: "enr-1", organizationId: "org-1", status: "active", currentStep: 1, // step 2 = email (last)
    entityType: "contact", entityId: "ct-1",
    sequence: { name: "Outbound", steps: STEPS },
  }
  beforeEach(() => {
    vi.mocked(prisma.sequenceEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1", email: "n@x.az" } as any)
  })

  it("sends, logs Activity, advances (completes on last step)", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m1" } as any)

    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "<p>Hi</p>" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({ to: "n@x.az", subject: "Hi", transactional: true, organizationId: "org-1" })
    expect(vi.mocked(prisma.activity.create)).toHaveBeenCalled()
    const claim = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: "enr-1", status: "active", currentStep: 1 })
    expect(claim.data.status).toBe("completed")
    expect(claim.data.lastOutcome).toBe("done")
  })

  // ── E1 email threading ──
  it("first email starts the thread: our Message-ID stamped, threading persisted", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({ ...emailEnrollment, threading: null } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m1" } as any)

    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Intro", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    const sent = vi.mocked(sendEmail).mock.calls[0][0] as any
    expect(sent.subject).toBe("Intro")
    expect(sent.headers["Message-ID"]).toMatch(/^<seq\./)
    expect(sent.headers["In-Reply-To"]).toBeUndefined()
    const claim = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0] as any
    expect(claim.data.threading).toEqual({ rootSubject: "Intro", messageIds: [sent.headers["Message-ID"]] })
    // no thread state yet → no inbound-reply lookup
    expect(vi.mocked(prisma.emailLog.findFirst)).not.toHaveBeenCalled()
  })

  it("follow-up rides the thread: In-Reply-To/References + «Re: root», composer subject overridden", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      ...emailEnrollment,
      threading: { rootSubject: "Intro", messageIds: ["<seq.a@x>"] },
    } as any)
    vi.mocked(prisma.emailLog.findFirst).mockResolvedValue(null as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m2" } as any)

    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "whatever", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    const sent = vi.mocked(sendEmail).mock.calls[0][0] as any
    expect(sent.subject).toBe("Re: Intro")
    expect(sent.headers["In-Reply-To"]).toBe("<seq.a@x>")
    expect(sent.headers["References"]).toContain("<seq.a@x>")
    const body = await res.json()
    expect(body.threaded).toBe(true)
    expect(body.subject).toBe("Re: Intro")
  })

  it("threads from the recipient's own reply when one exists", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      ...emailEnrollment,
      threading: { rootSubject: "Intro", messageIds: ["<seq.a@x>"] },
    } as any)
    vi.mocked(prisma.emailLog.findFirst).mockResolvedValue({ messageId: "<their@gmail>" } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m3" } as any)

    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "s", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    const sent = vi.mocked(sendEmail).mock.calls[0][0] as any
    expect(sent.headers["In-Reply-To"]).toBe("<their@gmail>")
    // the reply lookup is scoped to org+contact+our thread ids
    const q = vi.mocked(prisma.emailLog.findFirst).mock.calls[0][0] as any
    expect(q.where).toMatchObject({ organizationId: "org-1", contactId: "ct-1", direction: "inbound", inReplyTo: { in: ["<seq.a@x>"] } })
  })

  it("step with threadMode=new starts a fresh thread even mid-enrollment", async () => {
    const stepsNewMode = STEPS.map((s: any, i: number) => (i === 1 ? { ...s, threadMode: "new" } : s))
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      ...emailEnrollment,
      sequence: { name: "Outbound", steps: stepsNewMode },
      threading: { rootSubject: "Intro", messageIds: ["<seq.a@x>"] },
    } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m4" } as any)

    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "New topic", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    const sent = vi.mocked(sendEmail).mock.calls[0][0] as any
    expect(sent.subject).toBe("New topic")
    expect(sent.headers["In-Reply-To"]).toBeUndefined()
    const claim = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0] as any
    expect(claim.data.threading.rootSubject).toBe("New topic")
  })

  // ── E3 unsubscribe ──
  it("suppressed recipient → 422, enrollment stopped (opted_out), sendEmail NOT called", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(prisma.surveyUnsubscribe.findFirst).mockResolvedValue({ id: "u1" } as any)
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(422)
    expect((await res.json()).optedOut).toBe(true)
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
    const upd = vi.mocked(prisma.sequenceEnrollment.updateMany).mock.calls[0][0] as any
    expect(upd.data).toMatchObject({ status: "stopped", exitReason: "opted_out" })
  })

  // ── E4 daily send limit ──
  it("tags the EmailLog with sequenceId (daily-count + step stats)", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({ ...emailEnrollment, sequenceId: "seq-1" } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m1" } as any)
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "<p>Hi</p>" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    expect((vi.mocked(sendEmail).mock.calls[0][0] as any).sequenceId).toBe("seq-1")
  })

  it("daily limit reached → 429, does NOT send and does NOT advance", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceDailyEmailLimit: 5 } } as any)
    vi.mocked(prisma.emailLog.count).mockResolvedValue(5 as any) // already at the cap
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(429)
    expect((await res.json()).limitReached).toBe(true)
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).not.toHaveBeenCalled()
  })

  it("under the cap → sends normally", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceDailyEmailLimit: 5 } } as any)
    vi.mocked(prisma.emailLog.count).mockResolvedValue(4 as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m1" } as any)
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(sendEmail)).toHaveBeenCalled()
  })

  it("outgoing sequence email carries the unsubscribe footer + RFC 8058 headers", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m1" } as any)
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "<p>Hi</p>" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(200)
    const sent = vi.mocked(sendEmail).mock.calls[0][0] as any
    expect(sent.html).toContain("/unsubscribe?o=org-1")
    expect(sent.headers["List-Unsubscribe"]).toContain("/api/v1/public/sequence-unsubscribe?")
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
    expect(sent.headers["Message-ID"]).toMatch(/^<seq\./) // threading headers survive
  })

  it("SMTP down → 502, does NOT advance and logs nothing", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: "SMTP not configured" } as any)

    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(502)
    expect(vi.mocked(prisma.sequenceEnrollment.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.activity.create)).not.toHaveBeenCalled()
  })

  it("400 when the current step is not an email step", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({ ...emailEnrollment, currentStep: 0 } as any)
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(400)
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it("422 when the contact has no email on record", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(emailEnrollment as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1", email: null } as any)
    const res = await POST_SEND_EMAIL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ subject: "Hi", body: "x" }) }),
      params("enr-1"),
    )
    expect(res.status).toBe(422)
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })
})

// ── auto-enroll by lead source (web-to-lead) ─────────────────────────────────
describe("autoEnrollLeadIntoSequences", () => {
  it("enrolls the lead into every active sequence watching its source", async () => {
    vi.mocked(prisma.salesSequence.findMany).mockResolvedValue([
      { id: "seq-1", steps: [{ delayDays: 0 }] },
      { id: "seq-2", steps: [{ delayDays: 1 }] },
      { id: "seq-3", steps: [] }, // no steps → skipped
    ] as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ assignedTo: "owner-1" } as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.sequenceEnrollment.create).mockImplementation(async (a: any) => ({ id: "e", ...a.data }))

    const n = await autoEnrollLeadIntoSequences({ organizationId: "org-1", userId: null, leadId: "lead-1", source: "web_form" })
    expect(n).toBe(2)
    const where = vi.mocked(prisma.salesSequence.findMany).mock.calls[0][0].where
    expect(where).toMatchObject({ organizationId: "org-1", isActive: true, autoEnrollSources: { has: "web_form" } })
    // owner comes from the lead's assignee even with a null user
    expect(vi.mocked(prisma.sequenceEnrollment.create).mock.calls[0][0].data.ownerId).toBe("owner-1")
    expect(vi.mocked(prisma.sequenceEnrollment.create).mock.calls[0][0].data.enrolledBy).toBeNull()
  })

  it("no source → no query, returns 0", async () => {
    const n = await autoEnrollLeadIntoSequences({ organizationId: "org-1", userId: null, leadId: "lead-1", source: null })
    expect(n).toBe(0)
    expect(vi.mocked(prisma.salesSequence.findMany)).not.toHaveBeenCalled()
  })

  it("never throws on DB error", async () => {
    vi.mocked(prisma.salesSequence.findMany).mockRejectedValue(new Error("boom"))
    expect(await autoEnrollLeadIntoSequences({ organizationId: "org-1", userId: null, leadId: "l", source: "web_form" })).toBe(0)
  })
})

// ── PATCH enrollment: status + snooze ────────────────────────────────────────
describe("PATCH /sequences/[id]/enrollments/[enrollmentId]", () => {
  const seqEnrParams = (id: string, enrollmentId: string) => ({ params: Promise.resolve({ id, enrollmentId }) })

  it("snooze pushes nextStepAt out by N days and marks lastOutcome=snoozed", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "e1", sequenceId: "seq-1", organizationId: "org-1", status: "active",
      nextStepAt: new Date("2026-07-09T09:00:00Z"), // overdue (before NOW)
    } as any)
    vi.mocked(prisma.sequenceEnrollment.update).mockImplementation(async (a: any) => a)

    const res = await PATCH_ENROLLMENT(
      req("http://localhost/x", { method: "PATCH", body: JSON.stringify({ snoozeDays: 1 }) }),
      seqEnrParams("seq-1", "e1"),
    )
    expect(res.status).toBe(200)
    const upd = vi.mocked(prisma.sequenceEnrollment.update).mock.calls[0][0]
    // overdue → base is NOW (10:00), + 1 day
    expect(new Date(upd.data.nextStepAt).toISOString()).toBe("2026-07-10T10:00:00.000Z")
    expect(upd.data.lastOutcome).toBe("snoozed")
  })

  it("snooze on a non-active enrollment is 409", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "e1", sequenceId: "seq-1", organizationId: "org-1", status: "completed", nextStepAt: null,
    } as any)
    const res = await PATCH_ENROLLMENT(
      req("http://localhost/x", { method: "PATCH", body: JSON.stringify({ snoozeDays: 1 }) }),
      seqEnrParams("seq-1", "e1"),
    )
    expect(res.status).toBe(409)
  })

  it("stop stamps exitReason=manual", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "e1", sequenceId: "seq-1", organizationId: "org-1", status: "active", nextStepAt: new Date(),
    } as any)
    vi.mocked(prisma.sequenceEnrollment.update).mockImplementation(async (a: any) => a)
    const res = await PATCH_ENROLLMENT(
      req("http://localhost/x", { method: "PATCH", body: JSON.stringify({ status: "stopped" }) }),
      seqEnrParams("seq-1", "e1"),
    )
    expect(res.status).toBe(200)
    const upd = vi.mocked(prisma.sequenceEnrollment.update).mock.calls[0][0]
    expect(upd.data.status).toBe("stopped")
    expect(upd.data.exitReason).toBe("manual")
    expect(upd.data.nextStepAt).toBeNull()
  })

  it("rejects a body with neither status nor snoozeDays", async () => {
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({
      id: "e1", sequenceId: "seq-1", organizationId: "org-1", status: "active", nextStepAt: null,
    } as any)
    const res = await PATCH_ENROLLMENT(
      req("http://localhost/x", { method: "PATCH", body: JSON.stringify({ foo: 1 }) }),
      seqEnrParams("seq-1", "e1"),
    )
    expect(res.status).toBe(400)
  })
})

// ── GET /sequences/[id]/enrollments (Participants tab) ───────────────────────
describe("GET /api/v1/sequences/[id]/enrollments — participants", () => {
  it("resolves entity + owner names, step/status, and href", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue({
      id: "seq-1", organizationId: "org-1", steps: STEPS,
    } as any)
    vi.mocked(prisma.sequenceEnrollment.findMany).mockResolvedValue([
      { id: "e1", entityType: "lead", entityId: "lead-1", ownerId: "user-9", currentStep: 1,
        status: "active", nextStepAt: new Date(), lastOutcome: "no_answer", exitReason: null,
        repliedAt: null, meetingBookedAt: null, createdAt: new Date() },
      { id: "e2", entityType: "contact", entityId: "ct-1", ownerId: null, currentStep: 2,
        status: "stopped", nextStepAt: null, lastOutcome: null, exitReason: "replied",
        repliedAt: new Date(), meetingBookedAt: null, createdAt: new Date() },
    ] as any)
    vi.mocked(prisma.lead.findMany).mockResolvedValue([{ id: "lead-1", contactName: "Elvin", companyName: "ATL" }] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "ct-1", fullName: "Nigar", company: { name: "Bakcell" } }] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-9", name: "Rəşad" }] as any)

    const res = await GET_PARTICIPANTS(req("http://localhost/api/v1/sequences/seq-1/enrollments"), seqParams("seq-1"))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(2)
    const [a, b] = data
    expect(a.entityName).toBe("Elvin")
    expect(a.ownerName).toBe("Rəşad")
    expect(a.stepNumber).toBe(2) // currentStep 1 → step 2/2
    expect(a.stepCount).toBe(2)
    expect(a.entityHref).toBe("/leads/lead-1")
    expect(b.entityName).toBe("Nigar")
    expect(b.ownerName).toBeNull()
    expect(b.replied).toBe(true)
    expect(b.status).toBe("stopped")
  })

  it("404 for a sequence of another org", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue(null)
    const res = await GET_PARTICIPANTS(req("http://localhost/api/v1/sequences/seq-x/enrollments"), seqParams("seq-x"))
    expect(res.status).toBe(404)
  })
})

// ── enroll: ownerId resolution ───────────────────────────────────────────────
describe("POST /sequences/[id]/enroll — ownerId", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue({
      id: "seq-1", organizationId: "org-1", isActive: true,
      steps: [STEPS[0]],
    } as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.sequenceEnrollment.create).mockImplementation(async (args: any) => ({ id: "enr-new", ...args.data }))
  })

  it("lead enrollment takes the lead's assignee as owner", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ assignedTo: "owner-9" } as any)
    const res = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "lead", entityId: "lead-1" }) }),
      seqParams("seq-1"),
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.sequenceEnrollment.create).mock.calls[0][0].data.ownerId).toBe("owner-9")
  })

  it("unassigned lead falls back to the enroller; missing lead 404s", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ assignedTo: null } as any)
    const ok = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "lead", entityId: "lead-1" }) }),
      seqParams("seq-1"),
    )
    expect(ok.status).toBe(201)
    expect(vi.mocked(prisma.sequenceEnrollment.create).mock.calls[0][0].data.ownerId).toBe("user-1")

    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null)
    const missing = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "lead", entityId: "ghost" }) }),
      seqParams("seq-1"),
    )
    expect(missing.status).toBe(404)
  })

  // ── E6 single active enrollment ──
  it("blocks enrolling into a 2nd sequence when single-active is ON (→ 409)", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceSingleActiveEnrollment: true } } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1" } as any)
    // no existing row in THIS sequence, but an active enrollment elsewhere
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue({ id: "other", sequenceId: "seq-2", sequence: { name: "Other" } } as any)
    const res = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "contact", entityId: "ct-1" }) }),
      seqParams("seq-1"),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).blockedByOtherSequence).toBe(true)
    expect(vi.mocked(prisma.sequenceEnrollment.create)).not.toHaveBeenCalled()
    // the "other active sequence" lookup excludes THIS sequence
    const q = vi.mocked(prisma.sequenceEnrollment.findFirst).mock.calls.at(-1)?.[0] as any
    expect(q.where).toMatchObject({ organizationId: "org-1", entityType: "contact", entityId: "ct-1", sequenceId: { not: "seq-1" } })
    expect(q.where.status).toEqual({ in: ["active", "paused"] })
  })

  it("allows enrolling when single-active is ON but the person is in no other sequence", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceSingleActiveEnrollment: true } } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1" } as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.sequenceEnrollment.findFirst).mockResolvedValue(null)
    const res = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "contact", entityId: "ct-1" }) }),
      seqParams("seq-1"),
    )
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.sequenceEnrollment.create)).toHaveBeenCalled()
  })

  it("contact enrollment: owner = enroller; missing contact 404s", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1" } as any)
    const ok = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "contact", entityId: "ct-1" }) }),
      seqParams("seq-1"),
    )
    expect(ok.status).toBe(201)
    expect(vi.mocked(prisma.sequenceEnrollment.create).mock.calls[0][0].data.ownerId).toBe("user-1")

    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)
    const missing = await POST_ENROLL(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "contact", entityId: "ghost" }) }),
      seqParams("seq-1"),
    )
    expect(missing.status).toBe(404)
  })
})

describe("POST /sequences/[id]/enroll-bulk", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue({
      id: "seq-1", organizationId: "org-1", isActive: true, steps: [STEPS[0]],
    } as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.sequenceEnrollment.create).mockImplementation(async (args: any) => ({ id: "enr-new", ...args.data }))
  })

  it("enrolls many leads and returns an outcome summary (deduped)", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ assignedTo: null } as any)
    const res = await POST_ENROLL_BULK(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "lead", entityIds: ["l1", "l2", "l2", "l3"] }) }),
      seqParams("seq-1"),
    )
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.created).toBe(3) // "l2" deduped
    expect(vi.mocked(prisma.sequenceEnrollment.create)).toHaveBeenCalledTimes(3)
  })

  it("counts already-enrolled and not-found per item", async () => {
    // l1 active (already), l2 missing (not_found)
    vi.mocked(prisma.lead.findFirst)
      .mockResolvedValueOnce({ assignedTo: null } as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(prisma.sequenceEnrollment.findUnique).mockResolvedValueOnce({ id: "x", status: "active" } as any)
    const res = await POST_ENROLL_BULK(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "lead", entityIds: ["l1", "l2"] }) }),
      seqParams("seq-1"),
    )
    const { data } = await res.json()
    expect(data.already_enrolled).toBe(1)
    expect(data.not_found).toBe(1)
    expect(data.created).toBe(0)
  })

  it("422 when the sequence has no active steps", async () => {
    vi.mocked(prisma.salesSequence.findFirst).mockResolvedValue({ id: "seq-1", organizationId: "org-1", isActive: true, steps: [] } as any)
    const res = await POST_ENROLL_BULK(
      req("http://localhost/x", { method: "POST", body: JSON.stringify({ entityType: "lead", entityIds: ["l1"] }) }),
      seqParams("seq-1"),
    )
    expect(res.status).toBe(422)
  })
})
