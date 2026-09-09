import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { withRls } from "@/lib/with-rls"

const createPlanRequestSchema = z.object({
  requestedPlan: z.string().min(1).max(50),
  contactName: z.string().min(1).max(200),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(50).optional(),
  message: z.string().max(2000).optional(),
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createPlanRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, plan: true },
    })

    const planRequest = await prisma.planRequest.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
      },
    })

    logAudit(orgId, "create", "planRequest", planRequest.id, `Plan request: ${parsed.data.requestedPlan}`)

    // Send email notification to admin
    const planNames: Record<string, string> = {
      // New user-tier plans
      "tier-5": "Up to 5 Users (550 AZN/mo)",
      "tier-10": "Up to 10 Users (990 AZN/mo)",
      "tier-25": "Up to 25 Users (2,200 AZN/mo)",
      "tier-50": "Up to 50 Users (3,850 AZN/mo)",
      "enterprise": "Enterprise (Custom)",
      // Add-ons
      "addon:ai": "Add-on: Da Vinci AI",
      "addon:channels": "Add-on: Channels",
      // Separate subscriptions
      "sub:finance": "Subscription: Finance Suite",
      "sub:mtm": "Subscription: Field Teams (MTM)",
      // Legacy plans
      starter: "Starter (9 AZN/mo)",
      business: "Business (29 AZN/mo)",
      professional: "Professional (59 AZN/mo)",
    }

    const requestLabel = planNames[parsed.data.requestedPlan] || parsed.data.requestedPlan

    await sendEmail({
      to: "rashadrahimsoy@gmail.com",
      subject: `[LeadDrive] New plan request: ${requestLabel}`,
      html: `
        <h2>New Plan Subscription Request</h2>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
          <tr><td style="padding:8px;font-weight:bold;">Organization:</td><td style="padding:8px;">${org?.name || "Unknown"}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Current Plan:</td><td style="padding:8px;">${org?.plan || "N/A"}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Requested Plan:</td><td style="padding:8px;">${requestLabel}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Contact Name:</td><td style="padding:8px;">${parsed.data.contactName}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Contact Email:</td><td style="padding:8px;">${parsed.data.contactEmail}</td></tr>
          ${parsed.data.contactPhone ? `<tr><td style="padding:8px;font-weight:bold;">Phone:</td><td style="padding:8px;">${parsed.data.contactPhone}</td></tr>` : ""}
          ${parsed.data.message ? `<tr><td style="padding:8px;font-weight:bold;">Message:</td><td style="padding:8px;">${parsed.data.message}</td></tr>` : ""}
        </table>
        <p style="margin-top:20px;color:#666;">This request was sent from LeadDrive CRM billing page.</p>
      `,
      organizationId: orgId,
    })

    return NextResponse.json({ success: true, data: planRequest }, { status: 201 })
  } catch (e) {
    console.error("Plan request error:", e)
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const requests = await prisma.planRequest.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ success: true, data: requests })
  } catch (e) {
    console.error("Plan requests GET error:", e)
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
