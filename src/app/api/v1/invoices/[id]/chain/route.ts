import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getOrCreateInvoiceChainJourney } from "@/lib/invoice-chain-template"
import { processEnrollmentStep } from "@/lib/journey-engine"

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/v1/invoices/[id]/chain
// Returns the chain journey (with steps) and active enrollment (if any)
export const GET = withRlsAuth("invoices", "read", async (_req, { orgId }, { params }: RouteContext) => {
  const { id } = await params

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { chainJourneyId: true },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }
    if (!invoice.chainJourneyId) {
      return NextResponse.json({ success: true, data: null })
    }

    const journey = await prisma.journey.findFirst({
      where: { id: invoice.chainJourneyId, organizationId: orgId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    })
    if (!journey) {
      return NextResponse.json({ success: true, data: null })
    }

    const enrollment = await prisma.journeyEnrollment.findFirst({
      where: {
        invoiceId: id,
        journeyId: journey.id,
        organizationId: orgId,
        status: "active",
      },
    })

    return NextResponse.json({ success: true, data: { journey, enrollment: enrollment || null } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// POST /api/v1/invoices/[id]/chain
// action: "setup" — create/get the chain journey
// action: "start"  — start the chain (create enrollment)
export const POST = withRlsAuth("invoices", "write", async (req, { orgId }, { params }: RouteContext) => {
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const action = body.action || "setup"

  try {
    // Resolve the invoice under the authenticated tenant before setup can
    // create a Journey or start an enrollment. The template helper repeats
    // this check so it is safe if another caller is added later.
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { chainJourneyId: true, contactId: true },
    })
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    if (action === "setup") {
      const journeyId = await getOrCreateInvoiceChainJourney(id, orgId)
      const journey = await prisma.journey.findFirst({
        where: { id: journeyId, organizationId: orgId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      })
      if (!journey) {
        return NextResponse.json({ error: "Journey not found" }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: { journey, enrollment: null } })
    }

    if (action === "start") {
      // Prevent duplicate active chains
      const existing = await prisma.journeyEnrollment.findFirst({
        where: {
          invoiceId: id,
          organizationId: orgId,
          ...(invoice.chainJourneyId ? { journeyId: invoice.chainJourneyId } : {}),
          status: "active",
        },
      })
      if (existing) {
        return NextResponse.json({ error: "Chain already active" }, { status: 409 })
      }

      if (!invoice.chainJourneyId) {
        return NextResponse.json({ error: "Chain not set up" }, { status: 400 })
      }

      const journey = await prisma.journey.findFirst({
        where: { id: invoice.chainJourneyId, organizationId: orgId },
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      })
      if (!journey || journey.steps.length === 0) {
        return NextResponse.json({ error: "Journey has no steps" }, { status: 400 })
      }

      const firstStep = journey.steps[0]

      const enrollment = await prisma.journeyEnrollment.create({
        data: {
          organizationId: orgId,
          journeyId: invoice.chainJourneyId,
          invoiceId: id,
          contactId: invoice.contactId ?? null,
          currentStepId: firstStep.id,
          status: "active",
          nextActionAt: new Date(),
        },
      })

      await prisma.journey.updateMany({
        where: { id: invoice.chainJourneyId, organizationId: orgId },
        data: { entryCount: { increment: 1 }, activeCount: { increment: 1 } },
      })
      await prisma.journeyStep.updateMany({
        where: {
          id: firstStep.id,
          journeyId: journey.id,
          journey: { organizationId: orgId },
        },
        data: { statsEntered: { increment: 1 } },
      })

      // Process the first step immediately (usually a "wait" that sets nextActionAt)
      const stepResult = await processEnrollmentStep(enrollment.id, orgId)

      // Reload enrollment with updated nextActionAt
      const updatedEnrollment = await prisma.journeyEnrollment.findFirst({
        where: { id: enrollment.id, invoiceId: id, organizationId: orgId },
      })

      return NextResponse.json({
        success: true,
        data: { enrollment: updatedEnrollment, stepResult },
      })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (e) {
    if (action === "start" && (e as { code?: unknown })?.code === "P2002") {
      return NextResponse.json({ error: "Chain already active" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// DELETE /api/v1/invoices/[id]/chain
// Stops the active chain enrollment
export const DELETE = withRlsAuth("invoices", "write", async (_req, { orgId }, { params }: RouteContext) => {
  const { id } = await params

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    const enrollment = await prisma.journeyEnrollment.findFirst({
      where: { invoiceId: id, organizationId: orgId, status: "active" },
    })
    if (!enrollment) {
      return NextResponse.json({ error: "No active chain" }, { status: 404 })
    }

    const cancelled = await prisma.journeyEnrollment.updateMany({
      where: {
        id: enrollment.id,
        invoiceId: id,
        organizationId: orgId,
        status: "active",
      },
      data: { status: "cancelled", completedAt: new Date() },
    })
    if (cancelled.count !== 1) {
      return NextResponse.json({ error: "No active chain" }, { status: 404 })
    }

    await prisma.journey.updateMany({
      where: { id: enrollment.journeyId, organizationId: orgId, activeCount: { gt: 0 } },
      data: { activeCount: { decrement: 1 } },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
