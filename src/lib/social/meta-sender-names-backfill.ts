import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { resolveMetaSenderName } from "@/lib/social/meta-sender-profile"
import { isIgLogin } from "@/lib/social/tenant-meta-app"

/**
 * Names the Messenger / Instagram conversations that still show the sender's numeric id.
 *
 * Live messages get a name from the webhook (lib/social/meta-sender-profile) — and since #1111 from the
 * conversation's participants when Meta refuses the profile. A conversation whose customer does not write
 * again keeps its digits for ever: LeadDrive's own «1431458576943213» from 2026-09-21 is one, its sender now
 * writes to a page another workspace claimed first. This asks Meta once for each such conversation, through
 * the channel that received it, with the same resolver the webhook uses.
 *
 * A dry run asks Meta too (a read) but writes nothing; it answers how many would be named. A row is only ever
 * changed from digits to a name — a name already set, a lookup that fails, a channel without a token: untouched.
 * The report carries counts only.
 */
export type MetaSenderNamesReport = {
  dryRun: boolean
  scanned: number
  named: number
  stillDigits: number
  noChannel: number
  byPlatform: Record<string, { named: number; stillDigits: number }>
  hasMore: boolean
}

const DIGITS = /^\d+$/
const SCAN_PAGE = 500

export async function backfillMetaSenderNames(opts: { dryRun: boolean; limit: number }): Promise<MetaSenderNamesReport> {
  const report: MetaSenderNamesReport = {
    dryRun: opts.dryRun, scanned: 0, named: 0, stillDigits: 0, noChannel: 0, byPlatform: {}, hasMore: false,
  }

  // Cross-tenant discovery (which rows still carry digits) runs under bypass; each lookup and write below runs
  // in its own tenant's scope.
  const candidates = await runWithRlsBypass(async () => {
    const rows = await prisma.socialConversation.findMany({
      where: { platform: { in: ["facebook", "instagram"] }, deletedAt: null },
      select: { id: true, organizationId: true, platform: true, externalId: true, contactName: true, channelConfigId: true },
      orderBy: { lastMessageAt: "desc" },
      take: SCAN_PAGE * 4,
    })
    return rows.filter((row) => {
      const name = row.contactName?.trim() ?? ""
      return !name || (DIGITS.test(name) && name === row.externalId)
    })
  })
  const batch = candidates.slice(0, opts.limit)
  report.hasMore = candidates.length > batch.length

  for (const row of batch) {
    report.scanned += 1
    const platform = row.platform as "facebook" | "instagram"
    const tally = (report.byPlatform[platform] ??= { named: 0, stillDigits: 0 })
    await runWithTenant(row.organizationId, async () => {
      const channel = row.channelConfigId
        ? await prisma.channelConfig.findFirst({
            where: { id: row.channelConfigId, organizationId: row.organizationId },
            select: { apiKey: true, pageId: true, settings: true },
          })
        : null
      if (!channel?.apiKey) {
        report.noChannel += 1
        tally.stillDigits += 1
        report.stillDigits += 1
        return
      }
      const name = await resolveMetaSenderName({
        organizationId: row.organizationId,
        platform,
        senderId: row.externalId,
        token: channel.apiKey,
        igLogin: isIgLogin(channel.settings),
        accountId: channel.pageId,
      })
      if (!name || name === row.externalId || DIGITS.test(name)) {
        tally.stillDigits += 1
        report.stillDigits += 1
        return
      }
      tally.named += 1
      report.named += 1
      if (!opts.dryRun) {
        // Only digits are replaced: a webhook that named the row meanwhile wins.
        await prisma.socialConversation.updateMany({
          where: { id: row.id, organizationId: row.organizationId, contactName: row.contactName },
          data: { contactName: name },
        })
      }
    })
  }
  return report
}
