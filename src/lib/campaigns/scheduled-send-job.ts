import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { createNotification } from "@/lib/notifications"
import { sendCampaign } from "@/lib/campaigns/send-campaign"

/**
 * Sends campaigns whose planned time has come (status «scheduled»,
 * scheduledAt ≤ now). Until 2026-09 nothing did: the Compose tab set the
 * status and the date, and the campaign waited for a manual click forever.
 *
 * These are real messages to customers' contacts, so the one property that
 * matters is that a campaign goes out AT MOST ONCE:
 *
 * - Each campaign is claimed with one conditional write
 *   (`status='scheduled' AND scheduledAt<=now` → `sending`). Two overlapping
 *   runs, or a run racing a manual «Send Campaign» (which claims the same way),
 *   both issue it; the database lets exactly one of them flip the row, and only
 *   that one sends.
 * - Nothing here ever moves a campaign back to «scheduled». A campaign refused
 *   before anything went out (channel not configured, no recipients) becomes a
 *   draft with a notification — retrying every minute would send it hours late
 *   the moment someone fixes the channel. A throw WHILE sending leaves it in
 *   «sending»: some recipients may already have the message, so it waits for a
 *   person, never for the next tick.
 *
 * Discovery runs across tenants (bypass scope); the claim and the send run
 * inside `runWithTenant` for the campaign's own organization, and every write
 * carries that organizationId explicitly.
 */

/** Campaigns handled per tick. The rest wait a minute; order is oldest-due first. */
export const SCHEDULED_SEND_BATCH = 5

export type ScheduledSendSummary = {
  due: number
  sent: number
  refused: number
  failed: number
  /** Claimed by someone else between discovery and claim. */
  skipped: number
}

export async function runScheduledCampaignSends(now: Date = new Date()): Promise<ScheduledSendSummary> {
  const due = await runWithRlsBypass(() =>
    prisma.campaign.findMany({
      where: { status: "scheduled", scheduledAt: { lte: now } },
      select: { id: true, organizationId: true },
      orderBy: { scheduledAt: "asc" },
      take: SCHEDULED_SEND_BATCH,
    }),
  )

  const summary: ScheduledSendSummary = { due: due.length, sent: 0, refused: 0, failed: 0, skipped: 0 }

  for (const row of due) {
    const outcome = await runWithTenant(row.organizationId, () => sendOneScheduled(row.id, row.organizationId, now))
    summary[outcome]++
  }
  return summary
}

async function sendOneScheduled(
  id: string,
  orgId: string,
  now: Date,
): Promise<"sent" | "refused" | "failed" | "skipped"> {
  const claim = await prisma.campaign.updateMany({
    where: { id, organizationId: orgId, status: "scheduled", scheduledAt: { lte: now } },
    data: { status: "sending" },
  })
  if (claim.count !== 1) return "skipped"

  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
  if (!campaign) return "skipped"

  try {
    const outcome = await sendCampaign(campaign, orgId)
    if (outcome.reachedSend) return "sent"

    const reason = typeof outcome.body.error === "string" ? outcome.body.error : `HTTP ${outcome.status}`
    await prisma.campaign.updateMany({
      where: { id, organizationId: orgId, status: "sending" },
      data: { status: "draft" },
    })
    await createNotification({
      organizationId: orgId,
      userId: "",
      type: "warning",
      title: `Scheduled campaign not sent: ${campaign.name}`,
      message: `${reason}. The campaign is back in drafts; fix the cause and send it manually.`,
      entityType: "campaign",
      entityId: campaign.id,
    }).catch(() => {})
    return "refused"
  } catch (e) {
    console.error(`[campaigns/scheduled-send] campaign ${id} failed while sending:`, e)
    await createNotification({
      organizationId: orgId,
      userId: "",
      type: "error",
      title: `Scheduled campaign interrupted: ${campaign.name}`,
      message: "Sending stopped partway. Some recipients may already have the message — check before sending again.",
      entityType: "campaign",
      entityId: campaign.id,
    }).catch(() => {})
    return "failed"
  }
}
