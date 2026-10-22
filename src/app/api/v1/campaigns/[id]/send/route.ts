import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { sendCampaign } from "@/lib/campaigns/send-campaign"

export const POST = withRlsAuth("campaigns", "write", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 })

    if (!["draft", "scheduled"].includes(campaign.status)) {
      return NextResponse.json({ error: "This campaign has already started. Duplicate it to send a new campaign." }, { status: 409 })
    }
    // Claim drafts as well as scheduled campaigns: double-clicks race on this same write.
    const originalStatus = campaign.status
    const claim = await prisma.campaign.updateMany({
      where: { id, organizationId: orgId, status: originalStatus }, data: { status: "sending" },
    })
    if (claim.count !== 1) return NextResponse.json({ error: "Campaign is already being sent" }, { status: 409 })

    const outcome = await sendCampaign(campaign, orgId)
    if (!outcome.reachedSend) {
      // Refused before anything went out: give the campaign back its plan.
      await prisma.campaign.updateMany({
        where: { id, organizationId: orgId, status: "sending" },
        data: { status: originalStatus },
      })
    }
    return NextResponse.json(outcome.body, { status: outcome.status })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
