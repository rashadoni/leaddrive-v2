import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { createNotification } from "@/lib/notifications"
import { sendEmail, renderTemplate } from "@/lib/email"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * A/B Test Winner Selection Cron
 * Called every 15 minutes by external cron
 * Selects winners for A/B test campaigns where test duration has elapsed
 * Then sends the winner variant to the holdout group
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const campaigns = await prisma.campaign.findMany({
      where: {
        isAbTest: true,
        status: "ab_testing",
        winnerSelectedAt: null,
        sentAt: { not: null },
      },
      include: { variants: true },
    })

    let processed = 0

    for (const campaign of campaigns) {
      if (!campaign.sentAt || campaign.variants.length < 2) continue

      // Check if test duration has elapsed
      const durationMs = (campaign.testDurationHours ?? 4) * 3600 * 1000
      const elapsed = Date.now() - campaign.sentAt.getTime()
      if (elapsed < durationMs) continue

      // Select winner based on criteria
      const criteria = campaign.winnerCriteria ?? "open_rate"

      const variantStats = campaign.variants.map((v: any) => ({
        ...v,
        openRate: v.totalSent > 0 ? v.totalOpened / v.totalSent : 0,
        clickRate: v.totalSent > 0 ? v.totalClicked / v.totalSent : 0,
      }))

      const sorted = variantStats.sort((a: any, b: any) =>
        criteria === "click_rate"
          ? b.clickRate - a.clickRate
          : b.openRate - a.openRate
      )

      const winner = sorted[0]

      // Mark winner
      await prisma.campaignVariant.update({
        where: { id: winner.id },
        data: { isWinner: true },
      })

      // Send winner content to holdout group
      let holdoutSent = 0
      const holdoutIds = campaign.holdoutIds as string[] | null
      if (holdoutIds && holdoutIds.length > 0) {
        // Load holdout contacts
        const contacts = await prisma.contact.findMany({
          where: { id: { in: holdoutIds }, email: { not: null } },
          select: { id: true, email: true, fullName: true },
        })

        // Load winner template
        let winnerHtml = ""
        if (winner.htmlBody) {
          winnerHtml = winner.htmlBody
        } else if (winner.templateId) {
          const tmpl = await prisma.emailTemplate.findFirst({ where: { id: winner.templateId } })
          if (tmpl?.htmlBody) winnerHtml = tmpl.htmlBody
        } else if (campaign.templateId) {
          const tmpl = await prisma.emailTemplate.findFirst({ where: { id: campaign.templateId } })
          if (tmpl?.htmlBody) winnerHtml = tmpl.htmlBody
        }
        if (!winnerHtml) winnerHtml = `<p>${campaign.subject || campaign.name}</p>`

        for (const contact of contacts) {
          if (!contact.email) continue
          const rendered = renderTemplate(winnerHtml, {
            client_name: contact.fullName,
            manager_name: "LeadDrive Team",
          })
          const result = await sendEmail({
            to: contact.email,
            subject: winner.subject ?? campaign.subject ?? campaign.name,
            html: rendered,
            organizationId: campaign.organizationId,
            campaignId: campaign.id,
            templateId: winner.templateId ?? campaign.templateId ?? undefined,
            contactId: contact.id,
            variantId: winner.id,
          })
          if (result.success) holdoutSent++
        }
      }

      // Update campaign
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          winnerSelectedAt: new Date(),
          status: "sent",
          totalSent: { increment: holdoutSent },
        },
      })

      // Update winner variant sent count
      if (holdoutSent > 0) {
        await prisma.campaignVariant.update({
          where: { id: winner.id },
          data: { totalSent: { increment: holdoutSent } },
        })
      }

      // Notify campaign creator
      if (campaign.createdBy) {
        await createNotification({
          organizationId: campaign.organizationId,
          userId: campaign.createdBy,
          type: "success",
          title: "A/B Test Winner Selected",
          message: `Campaign "${campaign.name}": ${winner.name} won with ${criteria === "click_rate" ? `${(winner.clickRate * 100).toFixed(1)}% CTR` : `${(winner.openRate * 100).toFixed(1)}% open rate`}. Sent to ${holdoutSent} remaining contacts.`,
          entityType: "campaign",
          entityId: campaign.id,
        }).catch(() => {})
      }

      processed++
    }

    return NextResponse.json({ success: true, processed })
  } catch (error) {
    console.error("[Cron] A/B test winner selection error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
