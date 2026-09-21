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

    // «sending» means another send — the scheduled-send cron or a parallel
    // click — owns this campaign right now. Sending it again would deliver
    // every message twice.
    if (campaign.status === "sending") {
      return NextResponse.json({ error: "Campaign is already being sent" }, { status: 409 })
    }

    // A scheduled campaign is also picked up by the cron at its time, so the
    // manual send takes it the same way the cron does: one conditional write,
    // and only the side that flipped it to «sending» sends.
    let claimedScheduled = false
    if (campaign.status === "scheduled") {
      const claim = await prisma.campaign.updateMany({
        where: { id, organizationId: orgId, status: "scheduled" },
        data: { status: "sending" },
      })
      if (claim.count !== 1) {
        return NextResponse.json({ error: "Campaign is already being sent" }, { status: 409 })
      }
      claimedScheduled = true
    }

    const outcome = await sendCampaign(campaign, orgId)
    if (claimedScheduled && !outcome.reachedSend) {
      // Refused before anything went out: give the campaign back its plan.
      await prisma.campaign.updateMany({
        where: { id, organizationId: orgId, status: "sending" },
        data: { status: "scheduled" },
      })
    }
    return NextResponse.json(outcome.body, { status: outcome.status })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
