/**
 * 24h-silence auto-follow-up cron for TikTok (Chatwoot bridge) conversations.
 *
 * POST /api/cron/inbox-followup
 *
 * Schedule: hourly (the daytime 09:00–21:00 AZT gate lives in runInboxFollowups, so an
 * off-hours run is a cheap no-op — no need to encode the window in the crontab).
 *
 *   0 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" \
 *        -X POST http://localhost:3001/api/cron/inbox-followup > /dev/null 2>&1
 *
 * Opt-in per org via the `inboxFollowUp` feature flag; nudge text overridable per channel
 * via ChannelConfig(chatwoot).settings.followUpMessage. See src/lib/inbox/followup-cron.ts.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { runInboxFollowups } from "@/lib/inbox/followup-cron"
import { sendChatwootMessage } from "@/lib/chatwoot"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    try {
      const result = await runInboxFollowups(prisma, {
        now: new Date(),
        send: (p) => sendChatwootMessage(p).then((r) =>
          r.success ? true : r.deliveryUnknown ? "unknown" : false,
        ),
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e) {
      console.error("[inbox-followup cron]", e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
