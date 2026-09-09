import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

interface EnrollmentRow {
  id: string
  entityType: string
  entityId: string
  ownerId: string | null
  currentStep: number
  status: string
  nextStepAt: Date | null
  lastOutcome: string | null
  exitReason: string | null
  repliedAt: Date | null
  meetingBookedAt: Date | null
  createdAt: Date
}

/**
 * GET /api/v1/sequences/[id]/enrollments — participants of a sequence.
 *
 * Returns each enrollment resolved to a display name + owner name + step/status,
 * for the "Participants" tab. ?status= / ?entityType= filter.
 */
export const GET = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: sequenceId } = await params

  const sequence = await prisma.salesSequence.findFirst({
    where: { id: sequenceId, organizationId: orgId as string },
    include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
  })
  if (!sequence) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const entityType = searchParams.get("entityType")

  const enrollments: EnrollmentRow[] = await prisma.sequenceEnrollment.findMany({
    where: {
      sequenceId,
      organizationId: orgId as string,
      ...(status ? { status } : {}),
      ...(entityType ? { entityType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  // Batch-resolve names (entities + owners) — one query each, RLS-scoped.
  const leadIds = [...new Set(enrollments.filter((e) => e.entityType === "lead").map((e) => e.entityId))]
  const contactIds = [...new Set(enrollments.filter((e) => e.entityType === "contact").map((e) => e.entityId))]
  const ownerIds = [...new Set(enrollments.map((e) => e.ownerId).filter((v): v is string => !!v))]
  const [leads, contacts, owners]: [
    { id: string; contactName: string; companyName: string | null }[],
    { id: string; fullName: string; company: { name: string } | null }[],
    { id: string; name: string | null }[],
  ] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({ where: { organizationId: orgId as string, id: { in: leadIds } }, select: { id: true, contactName: true, companyName: true } })
      : Promise.resolve([]),
    contactIds.length
      ? prisma.contact.findMany({ where: { organizationId: orgId as string, id: { in: contactIds } }, select: { id: true, fullName: true, company: { select: { name: true } } } })
      : Promise.resolve([]),
    ownerIds.length
      ? prisma.user.findMany({ where: { organizationId: orgId as string, id: { in: ownerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ])
  const leadById = new Map(leads.map((l) => [l.id, l]))
  const contactById = new Map(contacts.map((c) => [c.id, c]))
  const ownerById = new Map(owners.map((u) => [u.id, u.name]))

  const stepCount = sequence.steps.length
  const rows = enrollments.map((e) => {
    const name = e.entityType === "lead"
      ? leadById.get(e.entityId)?.contactName ?? null
      : contactById.get(e.entityId)?.fullName ?? null
    const company = e.entityType === "lead"
      ? leadById.get(e.entityId)?.companyName ?? null
      : contactById.get(e.entityId)?.company?.name ?? null
    return {
      id: e.id,
      entityType: e.entityType,
      entityId: e.entityId,
      entityName: name,
      entityCompany: company,
      entityHref: e.entityType === "lead" ? `/leads/${e.entityId}` : `/contacts/${e.entityId}`,
      ownerName: e.ownerId ? ownerById.get(e.ownerId) ?? null : null,
      stepNumber: Math.min(e.currentStep + 1, stepCount || 1),
      stepCount,
      status: e.status,
      nextStepAt: e.nextStepAt,
      lastOutcome: e.lastOutcome,
      exitReason: e.exitReason,
      replied: e.repliedAt != null,
      meetingBooked: e.meetingBookedAt != null,
      createdAt: e.createdAt,
    }
  })

  return NextResponse.json({ success: true, data: rows })
})
