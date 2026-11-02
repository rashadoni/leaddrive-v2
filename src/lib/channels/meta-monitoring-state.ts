import { prisma } from "@/lib/prisma"

/**
 * Whether Brand Monitoring collects a connected Facebook Page / Instagram account — shown on the page's row
 * in Settings → Channels, so one row says everything the connection does (owner, 2026-10-27: «нужна чтоб
 * один канал был»).
 *
 * The inbox row (ChannelConfig) and the monitoring account (SocialAccount, handle = the Page / IG account id)
 * are two records. Monitoring polls only SocialAccount tokens (lib/social/facebook-poller,
 * lib/social/monitoring-collector), and today only the monitoring Meta app (FACEBOOK_APP_ID) mints them: the
 * approved Messenger app behind the catalog card has no permission to read posts or comments yet. So:
 *  - "on": an active SocialAccount holds a token;
 *  - "off": it exists but is switched off or lost its token — disconnecting the channel does that
 *    (api/v1/channels/[id] DELETE), and a later reconnect through the Messenger app does not bring it back.
 *    Found on prod 2026-10-27: the LeadDrive Page went back to the inbox, its monitoring stayed off unseen;
 *  - "awaiting_meta": none ever existed — the page was only ever connected through the Messenger app, and its
 *    monitoring waits for Meta to approve the read permissions on that app.
 */
export type MetaMonitoringState = {
  state: "on" | "off" | "awaiting_meta"
  lastPolledAt: string | null
}

export const META_MONITORED_CHANNEL_TYPES: ReadonlySet<string> = new Set(["facebook", "instagram"])

type MonitoredRow = { id: string; channelType: string; pageId?: string | null }

/** State per channel row id; rows that are not a Facebook/Instagram page are left out. */
export async function metaMonitoringStates(
  organizationId: string,
  channels: readonly MonitoredRow[],
): Promise<Map<string, MetaMonitoringState>> {
  const rows = channels.filter((row) => META_MONITORED_CHANNEL_TYPES.has(row.channelType) && row.pageId)
  const states = new Map<string, MetaMonitoringState>()
  if (rows.length === 0) return states

  const accounts = await prisma.socialAccount.findMany({
    where: {
      organizationId,
      platform: { in: [...META_MONITORED_CHANNEL_TYPES] },
      handle: { in: rows.map((row) => row.pageId as string) },
    },
    select: { platform: true, handle: true, isActive: true, accessToken: true, lastPolledAt: true },
  })
  for (const row of rows) {
    const account = accounts.find((item: { platform: string; handle: string }) =>
      item.platform === row.channelType && item.handle === row.pageId)
    if (!account) {
      states.set(row.id, { state: "awaiting_meta", lastPolledAt: null })
      continue
    }
    states.set(row.id, {
      state: account.isActive && account.accessToken ? "on" : "off",
      lastPolledAt: account.lastPolledAt ? new Date(account.lastPolledAt).toISOString() : null,
    })
  }
  return states
}
