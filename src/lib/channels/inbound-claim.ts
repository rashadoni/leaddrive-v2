import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isIgLogin } from "@/lib/social/tenant-meta-app"
import {
  rankInboundChannels,
  type InboundEndpoint,
  type MetaSurface,
  type RankableChannel,
} from "@/lib/social/inbound-channel-ranking"

/**
 * "Would an inbound DM for this channel actually land in THIS workspace?" — for Facebook/Instagram rows.
 *
 * A pageId is public and can be claimed by several organizations at once. The webhooks route a contested
 * pageId to the OLDEST claim (`lib/social/inbound-channel-ranking.ts`) — deliberately, so a later tenant
 * cannot hijack DMs by pasting someone's public Page id. The losing tenant, though, saw a green
 * «Подключено» and nothing else; the only signal was an `AMBIGUOUS` line in the server log. On 2026-09-11
 * Fanumsec connected @leaddrive.az, which LeadDrive Inc. had claimed in June, and the owner lost time
 * believing the connection was broken.
 *
 * This answers with the SAME order the webhooks use (never a copy of it), and returns only row ids of this
 * organization. The cross-tenant rows it reads under RLS bypass never leave this function: the caller learns
 * "claimed elsewhere, and you are not the routing winner", not by whom. Anything more — the other
 * workspace's name, id, config or dates — would be a cross-tenant leak to whoever can open Settings.
 *
 * Which webhook a row is judged by:
 *  - `settings.igLogin=true` rows receive through /api/v1/webhooks/instagram (Instagram Login app), which
 *    considers only `instagram` rows and ranks IG-Login rows first;
 *  - every other Facebook/Instagram row receives through /api/v1/webhooks/facebook, which considers both
 *    types and ranks non-IG-Login rows first. The payload surface there matches the row's own type.
 *
 * Not flagged, because the webhook would not route it elsewhere either:
 *  - the winner is another row of this same organization (a same-org duplicate is a tidiness problem,
 *    not a delivery one);
 *  - the other claim is switched off (`isActive=false` rows are invisible to both resolvers);
 *  - this organization runs its OWN Meta app for that surface ("Model B"): its app calls back with
 *    `?t=<slug>`, and both webhooks then scope the lookup to this organization alone. Same discriminator
 *    as `resolveTenantFacebookConfig` / `resolveTenantInstagramLoginConfig` — an active row carrying both
 *    appSecret and verifyToken, with igLogin telling the two apps apart.
 *
 * The row itself is ranked as if it were on, so a switched-off row that would lose once switched back on is
 * still reported; the UI shows `paused` first for it anyway.
 *
 * Fails soft: if a lookup errors, nothing is flagged and the error is logged. This is advice on a settings
 * screen, not a gate — and a false "your messages go elsewhere" would send a working tenant to support.
 */

const META_TYPES: MetaSurface[] = ["facebook", "instagram"]

/** A row as the channel routes read it — always this organization's, so `organizationId` is not required. */
export type InboundClaimInput = Omit<RankableChannel, "organizationId"> & {
  pageId?: string | null
}

type InboundClaimRow = RankableChannel & { pageId: string | null }

function endpointFor(row: InboundClaimRow): InboundEndpoint {
  return isIgLogin(row.settings) ? "instagramLogin" : "facebookLogin"
}

/** Channel types the webhook for `endpoint` looks a pageId up among (mirrors each route's `where`). */
function typesFor(endpoint: InboundEndpoint): string[] {
  return endpoint === "instagramLogin" ? ["instagram"] : META_TYPES
}

/**
 * Ids of `rows` — this organization's own channels, read in its tenant scope — whose pageId is also claimed
 * by an ACTIVE channel in another organization that the webhook ranks above every claim this one holds.
 */
export async function channelIdsClaimedElsewhere(
  organizationId: string,
  rows: InboundClaimInput[],
): Promise<Set<string>> {
  const flagged = new Set<string>()
  if (!organizationId) return flagged
  const candidates: InboundClaimRow[] = rows
    .filter((row) => META_TYPES.includes(row.channelType as MetaSurface) && row.pageId)
    .map((row) => ({ ...row, organizationId, pageId: row.pageId ?? null }))
  if (candidates.length === 0) return flagged

  try {
    const pageIds = [...new Set(candidates.map((row) => row.pageId as string))]
    // RLS: the one cross-tenant read — every active claim on these public ids, whoever holds it. Mirrors the
    // webhooks' own org-resolution lookup, which is also bypassed. Only the ranking columns are selected.
    const claims: InboundClaimRow[] = await runWithRlsBypass(() =>
      prisma.channelConfig.findMany({
        where: { pageId: { in: pageIds }, channelType: { in: META_TYPES }, isActive: true },
        select: { id: true, organizationId: true, channelType: true, pageId: true, settings: true, createdAt: true },
      }),
    )
    if (!Array.isArray(claims) || !claims.some((claim) => claim.organizationId !== organizationId)) return flagged

    // This organization's own Meta-app rows, read in the caller's tenant scope.
    const ownApps: Array<{ channelType: string; settings: unknown }> = await prisma.channelConfig.findMany({
      where: {
        organizationId,
        channelType: { in: META_TYPES },
        isActive: true,
        appSecret: { not: null },
        verifyToken: { not: null },
      },
      select: { channelType: true, settings: true },
    })
    const hasOwnApp: Record<InboundEndpoint, boolean> = {
      facebookLogin: ownApps.some((app) => !isIgLogin(app.settings)),
      instagramLogin: ownApps.some((app) => app.channelType === "instagram" && isIgLogin(app.settings)),
    }

    for (const row of candidates) {
      const endpoint = endpointFor(row)
      if (hasOwnApp[endpoint]) continue
      const types = typesFor(endpoint)
      if (!types.includes(row.channelType)) continue
      const rivals = claims.filter(
        (claim) => claim.pageId === row.pageId && claim.id !== row.id && types.includes(claim.channelType),
      )
      if (!rivals.some((claim) => claim.organizationId !== organizationId)) continue
      const winner = rankInboundChannels([row, ...rivals], row.channelType as MetaSurface, endpoint)[0]
      if (winner && winner.organizationId !== organizationId) flagged.add(row.id)
    }
  } catch (error) {
    console.error("[inbound-claim] could not check for claims in other workspaces", error)
    return new Set<string>()
  }
  return flagged
}
