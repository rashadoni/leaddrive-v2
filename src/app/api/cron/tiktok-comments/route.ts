import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { requireCronAuth } from "@/lib/cron-auth"
import { ingestTikTokAccountComments, type TikTokIngestAccount } from "@/lib/inbox/tiktok-comment-ingest"

/**
 * Comments under owned TikTok videos, for every connected account.
 *
 * Runs across all tenants, hence the bypass scope for finding the accounts; every read and write
 * then happens inside the account's own organization. One account's failure — a dead token, a
 * refusal from TikTok — is counted and does not stop the rest.
 */
export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const accounts = await runWithRlsBypass(() => prisma.socialAccount.findMany({
    where: { platform: "tiktok", isActive: true, accessToken: { not: null } },
    select: { id: true, organizationId: true, handle: true, displayName: true, accessToken: true, tokenExpiresAt: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  }))

  const total = { accounts: accounts.length, videos: 0, stored: 0, updated: 0, replies: 0, removed: 0, skipped: 0, failed: 0 }
  for (const row of accounts) {
    const account: TikTokIngestAccount = {
      id: row.id,
      organizationId: row.organizationId,
      handle: row.handle,
      displayName: row.displayName,
      accessToken: row.accessToken,
      tokenExpiresAt: row.tokenExpiresAt,
    }
    const counts = await runWithTenant(row.organizationId, () => ingestTikTokAccountComments(account))
    total.videos += counts.videos
    total.stored += counts.stored
    total.updated += counts.updated
    total.replies += counts.replies
    total.removed += counts.removed
    total.skipped += counts.skipped
    total.failed += counts.failed
  }

  return NextResponse.json({ ok: true, ...total })
}
