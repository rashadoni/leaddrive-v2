/**
 * POST /api/cron/post-resolution-survey
 *
 * Catch-up cron for B9 CSAT/NPS auto-surveys — re-sends survey invites for
 * tickets resolved in the last 24h whose primary `triggerSurveysOnTicketResolved`
 * call failed (SMTP outage, WhatsApp 5xx, etc.). Suppresses contacts who
 * already received a survey from this org in the last 30 days.
 *
 * Should be wired to external cron hourly:
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/post-resolution-survey \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Part of B9 (Phase 2 roadmap slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runPostResolutionSurveyScan, type EligibleSurveyTarget } from "@/lib/queue/jobs/post-resolution-survey"
import { sendSurveyInvite, pickInviteChannel } from "@/lib/survey-triggers"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const result = await runPostResolutionSurveyScan(
      prisma,
      async (target: EligibleSurveyTarget, contact) => {
        // Closed-loop channel routing via the shared helper —
        // single source of truth with `triggerSurveysOnTicketResolved`.
        // Catch-up skips the whatsapp-merge optimisation (message window
        // is past), so we just pick the first usable channel.
        const picked = pickInviteChannel({
          source: target.source,
          sourceMeta: target.sourceMeta,
          contact,
        })
        if (!picked) return false

        const r = await sendSurveyInvite({
          surveyId: target.surveyId,
          organizationId: target.organizationId,
          email: contact.email,
          phone: contact.phone,
          contactId: target.contactId,
          ticketId: target.ticketId,
          channel: picked.channel,
          webChatSessionId: picked.webChatSessionId,
        })
        return !!r.ok
      }
    )

    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error("[cron/post-resolution-survey]", e)
    return NextResponse.json({ error: "Scan failed" }, { status: 500 })
  }
  })
}
