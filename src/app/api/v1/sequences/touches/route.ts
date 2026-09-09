import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

interface StepRow {
  type: string
  subject: string | null
  body: string | null
  delayDays: number
}
interface EnrollmentRow {
  id: string
  sequenceId: string
  entityType: string
  entityId: string
  currentStep: number
  nextStepAt: Date | null
  sequence: { name: string; steps: StepRow[] }
}
interface LeadRow {
  id: string
  contactName: string
  companyName: string | null
  phone: string | null
  phoneWhatsApp: string | null
  email: string | null
}
interface ContactRow {
  id: string
  fullName: string
  phone: string | null
  email: string | null
  company: { name: string } | null
}

/**
 * GET /api/v1/sequences/touches — the manager's touch queue.
 *
 * Active enrollments of active sequences whose next step is due by the end of
 * today (UTC), resolved to "who to touch, in which sequence, doing what".
 * ?owner=me (default) | all | <userId>. Sorted most-overdue first.
 */
export const GET = withRlsAuth(undefined, undefined, async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const ownerParam = searchParams.get("owner") ?? "me"
  // Viewer's UTC offset in minutes, as returned by JS Date.getTimezoneOffset()
  // (UTC+4 → -240). Day boundaries are computed in the VIEWER's day, not UTC's —
  // otherwise "due today"/"overdue" is wrong for any non-UTC org.
  const tzOffsetMin = Number.parseInt(searchParams.get("tzOffset") ?? "0", 10) || 0
  const offsetMs = tzOffsetMin * 60_000

  const now = new Date()
  const local = new Date(now.getTime() - offsetMs)
  const startLocal = new Date(local)
  startLocal.setUTCHours(0, 0, 0, 0)
  const endLocal = new Date(local)
  endLocal.setUTCHours(23, 59, 59, 999)
  const startOfDay = new Date(startLocal.getTime() + offsetMs)
  const endOfDay = new Date(endLocal.getTime() + offsetMs)

  const dueWhere = {
    organizationId: auth.orgId,
    status: "active",
    nextStepAt: { lte: endOfDay },
    ...(ownerParam === "all" ? {} : { ownerId: ownerParam === "me" ? auth.userId : ownerParam }),
    sequence: { isActive: true },
  }

  const [enrollments, dueTotal, overdueTotal]: [EnrollmentRow[], number, number] = await Promise.all([
    prisma.sequenceEnrollment.findMany({
      where: dueWhere,
      include: {
        sequence: {
          include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
        },
      },
      orderBy: { nextStepAt: "asc" },
      take: 100,
    }),
    // True totals from the DB — the page above is capped at 100 rows.
    prisma.sequenceEnrollment.count({ where: dueWhere }),
    prisma.sequenceEnrollment.count({
      where: { ...dueWhere, nextStepAt: { lt: startOfDay } },
    }),
  ])

  // Batch-resolve the enrolled people (display name + company)
  const leadIds = [...new Set(enrollments.filter((e) => e.entityType === "lead").map((e) => e.entityId))]
  const contactIds = [...new Set(enrollments.filter((e) => e.entityType === "contact").map((e) => e.entityId))]
  const [leads, contacts]: [LeadRow[], ContactRow[]] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({
          where: { organizationId: auth.orgId, id: { in: leadIds } },
          select: { id: true, contactName: true, companyName: true, phone: true, phoneWhatsApp: true, email: true },
        })
      : Promise.resolve([]),
    contactIds.length
      ? prisma.contact.findMany({
          where: { organizationId: auth.orgId, id: { in: contactIds } },
          select: { id: true, fullName: true, phone: true, email: true, company: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ])
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const contactById = new Map(contacts.map((c) => [c.id, c]))

  const touches = enrollments.flatMap((e) => {
    const steps = e.sequence.steps
    // currentStep counts steps already executed (cron semantics); steps[currentStep]
    // is the touch that is due now. Out-of-range = cron will complete it; not a touch.
    const step = steps[e.currentStep]
    if (!step) return []
    const entity =
      e.entityType === "lead"
        ? (() => {
            const l = leadById.get(e.entityId)
            // For a call step prefer the primary phone; fall back to the WhatsApp number.
            return l ? { name: l.contactName, company: l.companyName ?? null, phone: l.phone ?? l.phoneWhatsApp ?? null, email: l.email ?? null } : null
          })()
        : (() => {
            const c = contactById.get(e.entityId)
            return c ? { name: c.fullName, company: c.company?.name ?? null, phone: c.phone ?? null, email: c.email ?? null } : null
          })()
    if (!entity) return [] // enrolled entity was deleted — nothing actionable
    return [{
      enrollmentId: e.id,
      entityType: e.entityType,
      entityId: e.entityId,
      entityName: entity.name,
      entityCompany: entity.company,
      entityPhone: entity.phone,
      entityEmail: entity.email,
      // Deep link to the person's record so the manager works the touch without hunting.
      entityHref: e.entityType === "lead" ? `/leads/${e.entityId}` : `/contacts/${e.entityId}`,
      sequenceId: e.sequenceId,
      sequenceName: e.sequence.name,
      stepNumber: e.currentStep + 1,
      stepCount: steps.length,
      stepType: step.type,
      stepSubject: step.subject,
      stepBody: step.body,
      dueAt: e.nextStepAt,
      overdue: e.nextStepAt != null && e.nextStepAt < startOfDay,
    }]
  })

  return NextResponse.json({
    success: true,
    data: {
      touches,
      dueTotal,
      overdueTotal,
      truncated: dueTotal > enrollments.length,
    },
  })
})
