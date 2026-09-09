import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { pollChatwootTikTokInbounds } from "@/lib/inbox/chatwoot-polling"
import { withJobLease } from "@/lib/cron/job-lease"

const CHATWOOT_INBOUND_POLL_LEASE_MS = 120_000

export async function POST(req: NextRequest) {
  const authError = requireCronAuth(req)
  if (authError) return authError

  return runWithRlsBypass(async () => {
    try {
      const lease = await withJobLease(
        { name: "chatwoot-inbound-poll", ttlMs: CHATWOOT_INBOUND_POLL_LEASE_MS },
        () => pollChatwootTikTokInbounds(prisma),
      )
      if (lease.status === "skipped") {
        return NextResponse.json({ ok: true, skipped: lease.reason })
      }
      return NextResponse.json({ ok: true, ...lease.value })
    } catch (error) {
      console.error(
        "[chatwoot-inbound-poll cron]",
        error instanceof Error ? error.message : error,
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
