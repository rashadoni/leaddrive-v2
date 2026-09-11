import { isIgLogin } from "@/lib/social/tenant-meta-app"
import { sanitizeLog } from "@/lib/sanitize"

/**
 * Which ChannelConfig row receives an inbound Meta DM when more than one claims the same pageId.
 *
 * `pageId` (a FB Page id or an IG business-account id) is PUBLIC and NOT unique across tenants: two
 * organizations can each hold an ACTIVE ChannelConfig for the same one. Confirmed on prod 2026-08-26 —
 * IG business account `17841410801241198` is claimed by BOTH `leaddrive` (channelType=instagram) and
 * `brandprotection` (channelType=instagram, settings.igLogin=true); on 2026-09-11 Fanumsec made it three.
 * On the shared-LeadDrive-app path (no `?t=`) the webhook's lookup is un-scoped by design — the shared app
 * is the signer and the payload names no org — so WHICH claimant receives the DM is a tenant-isolation
 * decision. It must not be left to an unordered scan (no ORDER BY → the planner returns whatever row it
 * reaches first, which can flip on a VACUUM, an index build, or a plan change).
 *
 * This module is the ONE place that order lives. Both Meta webhooks route by it, and the channel settings
 * screen asks it "would a DM for this row actually land here?" (`lib/channels/inbound-claim.ts`). A copy of
 * the order anywhere else would let the screen and the transport disagree — which is exactly how a card
 * came to say «Подключено» over a channel whose DMs were going to another workspace.
 *
 * The ranking is a TOTAL order, so the winner never depends on scan order:
 *  1. The row's login surface. Each webhook serves one Meta app:
 *       - `webhooks/facebook` (Facebook Login) puts non-IG-Login rows first;
 *       - `webhooks/instagram` (Instagram Login, "Path B") puts `settings.igLogin=true` rows first.
 *     De-preferred rather than excluded: a pageId claimed ONLY by the other surface's row still ingests
 *     instead of silently dropping the message.
 *  2. `channelType` matching the payload surface (object:instagram → instagram rows), so an IG DM doesn't
 *     land on a facebook row (and its Page token) while an instagram row for the same id exists.
 *  3. Oldest `createdAt` first — the FIRST org to connect the page wins. Deliberately NOT newest-first:
 *     pageId is typed by hand into the channel form (no OAuth proof of ownership), so "newest claim wins"
 *     would let tenant B capture tenant A's inbound DMs by pasting A's public Page ID. A later claimant
 *     cannot back-date a row.
 *  4. `id` as the final tiebreak, so rows created in the same millisecond still order.
 */

export type MetaSurface = "facebook" | "instagram"

/** Which webhook is resolving — it decides which login surface ranks first (step 1 above). */
export type InboundEndpoint = "facebookLogin" | "instagramLogin"

/** The columns the order reads. Webhooks pass full ChannelConfig rows; the settings screen a narrow select. */
export type RankableChannel = {
  id: string
  organizationId: string
  channelType: string
  settings: unknown
  createdAt: Date | string | null
}

function inboundRank(
  row: RankableChannel,
  platform: MetaSurface,
  endpoint: InboundEndpoint,
): [number, number, number, string] {
  const onOwnSurface = endpoint === "instagramLogin" ? isIgLogin(row.settings) : !isIgLogin(row.settings)
  return [
    onOwnSurface ? 0 : 1,
    row.channelType === platform ? 0 : 1,
    row.createdAt ? new Date(row.createdAt).getTime() : 0,
    row.id ?? "",
  ]
}

/** Claimants of one pageId, best first. `ranked[0]` is the row the webhook writes the DM into. */
export function rankInboundChannels<T extends RankableChannel>(
  rows: T[],
  platform: MetaSurface,
  endpoint: InboundEndpoint = "facebookLogin",
): T[] {
  return [...rows].sort((a, b) => {
    const ra = inboundRank(a, platform, endpoint)
    const rb = inboundRank(b, platform, endpoint)
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] < rb[i]) return -1
      if (ra[i] > rb[i]) return 1
    }
    return 0
  })
}

/**
 * Make a contested pageId LOUD in the logs. Ambiguity here is a cross-tenant routing hazard, and the old
 * `findFirst` resolved it silently — the wrong tenant could have been reading another's DMs for months with
 * nothing in the logs. Names every claimant (org + config + surface) and the winner. Ids only, never tokens.
 * This line is for the operator; the tenant sees only a boolean (`lib/channels/inbound-claim.ts`).
 */
export function reportInboundAmbiguity(
  tag: string,
  pageId: string,
  platform: MetaSurface,
  ranked: RankableChannel[],
  endpoint: InboundEndpoint = "facebookLogin",
): void {
  const safePageId = sanitizeLog(String(pageId))
  const ownSurface = endpoint === "instagramLogin" ? "igLogin" : "non-igLogin"
  if (ranked.length > 1) {
    const orgs = new Set(ranked.map((r) => r.organizationId))
    const claims = ranked
      .map((r) => `org=${r.organizationId} config=${r.id} type=${r.channelType}${isIgLogin(r.settings) ? " igLogin" : ""}`)
      .join(" | ")
    console.warn(
      `${tag} AMBIGUOUS pageId=${safePageId} (${platform}) — ${ranked.length} active channel configs across ${orgs.size} org(s) claim it: ${claims}. ` +
        `Routed to org=${ranked[0].organizationId} config=${ranked[0].id} by deterministic order (${ownSurface} → channelType=${platform} → oldest createdAt → id). ` +
        `${orgs.size > 1 ? "CROSS-TENANT: only one of these orgs owns this page — deactivate the stale claim." : "Same-org duplicate — deactivate the unused config."}`,
    )
    return
  }
  if (endpoint === "facebookLogin" && ranked.length === 1 && isIgLogin(ranked[0].settings)) {
    console.warn(
      `${tag} pageId=${safePageId} (${platform}) is claimed ONLY by an Instagram-Login row ` +
        `(org=${ranked[0].organizationId} config=${ranked[0].id}) — that surface delivers to /api/v1/webhooks/instagram. Ingesting anyway; check the connection.`,
    )
  }
}
