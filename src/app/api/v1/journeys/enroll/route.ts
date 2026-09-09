import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { processEnrollmentStep } from "@/lib/journey-engine"

const enrollmentRequestSchema = z.object({
  journeyId: z.string().trim().min(1).max(128),
  leadId: z.string().trim().min(1).max(128).optional(),
  contactId: z.string().trim().min(1).max(128).optional(),
}).strict().superRefine((value, ctx) => {
  if (Number(Boolean(value.leadId)) + Number(Boolean(value.contactId)) !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["leadId"],
      message: "Exactly one of leadId or contactId is required",
    })
  }
})

export const POST = withRlsAuth("journeys", "write", async (req, { orgId }) => {
  const parsed = enrollmentRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid enrollment request" }, { status: 400 })
  }
  const { journeyId, leadId, contactId } = parsed.data

  try {
    // Both the journey and its target must belong to the authenticated tenant.
    // JourneyEnrollment intentionally has no FK that can enforce this coherence,
    // so every writer must establish it before persisting the IDs.
    const [journey, target] = await Promise.all([
      prisma.journey.findFirst({
        where: { id: journeyId, organizationId: orgId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      }),
      leadId
        ? prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, select: { id: true } })
        : prisma.contact.findFirst({ where: { id: contactId!, organizationId: orgId }, select: { id: true } }),
    ])

    if (!journey) {
      return NextResponse.json({ error: "Journey not found" }, { status: 404 })
    }
    if (!target) {
      return NextResponse.json({ error: "Enrollment target not found" }, { status: 404 })
    }

    if (journey.steps.length === 0) {
      return NextResponse.json({ error: "Journey has no steps" }, { status: 400 })
    }

    // Check if already enrolled
    const existing = await prisma.journeyEnrollment.findFirst({
      where: {
        organizationId: orgId,
        journeyId,
        ...(leadId ? { leadId } : { contactId }),
        status: { in: ["active", "paused"] },
      },
    })

    if (existing) {
      return NextResponse.json({ error: "Already enrolled in this journey" }, { status: 409 })
    }

    const firstStep = journey.steps[0]

    // Create enrollment
    const enrollment = await prisma.journeyEnrollment.create({
      data: {
        organizationId: orgId,
        journeyId,
        leadId: leadId || null,
        contactId: contactId || null,
        currentStepId: firstStep.id,
        status: "active",
        nextActionAt: new Date(),
      },
    })

    // Increment journey entry count
    await prisma.journey.updateMany({
      where: { id: journeyId, organizationId: orgId },
      data: {
        entryCount: { increment: 1 },
        activeCount: { increment: 1 },
      },
    })

    // Increment step stats
    await prisma.journeyStep.update({
      where: { id: firstStep.id },
      data: { statsEntered: { increment: 1 } },
    })

    // Process the first step immediately
    const result = await processEnrollmentStep(enrollment.id, orgId)

    return NextResponse.json({
      success: true,
      data: {
        enrollment,
        stepResult: result,
      },
    }, { status: 201 })
  } catch (e: any) {
    // The pre-read keeps the common response fast, while PostgreSQL partial
    // unique indexes are the authority for parallel enroll requests.
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "Already enrolled in this journey" }, { status: 409 })
    }
    console.error("[Journey Enroll Error]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// GET — list enrollments for a journey
export const GET = withRlsAuth("journeys", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const journeyId = searchParams.get("journeyId")

  const where: any = { organizationId: orgId }
  if (journeyId) where.journeyId = journeyId

  const enrollments = await prisma.journeyEnrollment.findMany({
    where,
    orderBy: { enrolledAt: "desc" },
    take: 100,
  })

  return NextResponse.json({ success: true, data: enrollments })
})
