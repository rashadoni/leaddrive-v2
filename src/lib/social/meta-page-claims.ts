import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Which of these Facebook Page ids some LeadDrive organisation relies on: an
 * active Facebook or Instagram inbox channel on that Page id, or an active
 * Social Monitoring account whose handle is it.
 *
 * A Page's subscription to our Meta app is one per Page and app, shared by
 * every organisation that uses the Page through that app. So whatever the demo
 * undoes at Meta, it undoes only for Pages nobody else claims. The lookup
 * mirrors the inbound webhook's own (src/app/api/v1/webhooks/facebook/route.ts,
 * `resolveInboundChannel`): by public Page id, across every organisation, so
 * under RLS bypass — under any tenant's context, or none, the tables would
 * answer «nobody» and the demo would unsubscribe a customer's Page.
 *
 * Returns ids only, never rows: the caller learns that a Page is claimed, not
 * by whom.
 */
export async function claimedMetaPageIds(pageIds: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(pageIds.filter((id) => typeof id === "string" && id.length > 0))]
  if (wanted.length === 0) return []
  const [channels, accounts] = await runWithRlsBypass(() =>
    Promise.all([
      prisma.channelConfig.findMany({
        where: { pageId: { in: wanted }, channelType: { in: ["facebook", "instagram"] }, isActive: true },
        select: { pageId: true },
      }),
      prisma.socialAccount.findMany({
        where: { handle: { in: wanted }, platform: { in: ["facebook", "instagram"] }, isActive: true },
        select: { handle: true },
      }),
    ]),
  )
  const claimed = new Set<string>()
  for (const row of channels) if (row.pageId) claimed.add(row.pageId)
  for (const row of accounts) claimed.add(row.handle)
  return wanted.filter((id) => claimed.has(id))
}
