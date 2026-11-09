/**
 * Which advertisement brought this conversation.
 *
 * When someone taps a Click-to-WhatsApp ad, Meta puts a `referral` object on
 * the FIRST message of that conversation — the ad's id, its headline, the
 * creative, and `ctwa_clid`, the click id Meta's Conversions API later wants
 * back. We were throwing all of it away, so the one question the owner who
 * pays for ads actually asks — «which ad brought these chats» — had no answer
 * anywhere in the product.
 *
 * Two rules decide what we keep:
 *
 * 1. **First touch wins.** A customer who taps a second ad a week later does
 *    not retroactively change where the conversation came from; a report that
 *    rewrites last month's numbers is worse than no report. The later click is
 *    still recorded on its own message row by the webhook's own payload log.
 * 2. **Everything here is attacker-controlled text.** It arrives from the
 *    outside and is rendered in the inbox, so every field is length-capped and
 *    typed here, once, rather than trusted at each screen.
 */

/** What a screen may show and a report may group by. */
export interface AdReferral {
  /** "ad" or "post" — Meta sends both through the same field. */
  sourceType: string
  /** The ad or post id. Null when Meta omits it, which happens on old posts. */
  sourceId: string | null
  /** The ad's headline — the only part a human recognises. */
  headline: string | null
  /** The ad's body text. */
  body: string | null
  /** Where the tap came from. */
  sourceUrl: string | null
  /** Meta's click id, kept for the Conversions API. Never shown. */
  ctwaClid: string | null
}

const CAP = { sourceType: 24, sourceId: 64, headline: 200, body: 400, sourceUrl: 500, ctwaClid: 256 } as const

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const clean = value.trim().slice(0, max)
  return clean || null
}

/**
 * Read Meta's `referral` off an inbound message. Returns null for anything
 * that is not a usable referral — an empty object, a referral with no source
 * at all, or a message that simply carries none.
 */
export function readAdReferral(message: unknown): AdReferral | null {
  if (!message || typeof message !== "object") return null
  const raw = (message as { referral?: unknown }).referral
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const sourceType = text(row.source_type, CAP.sourceType)
  const sourceId = text(row.source_id, CAP.sourceId)
  const headline = text(row.headline, CAP.headline)
  const sourceUrl = text(row.source_url, CAP.sourceUrl)
  const ctwaClid = text(row.ctwa_clid, CAP.ctwaClid)
  // A referral that names neither the ad nor where it came from tells nobody
  // anything; storing it would only put an empty badge on the conversation.
  if (!sourceId && !sourceUrl && !ctwaClid) return null
  return {
    sourceType: sourceType ?? "ad",
    sourceId,
    headline,
    body: text(row.body, CAP.body),
    sourceUrl,
    ctwaClid,
  }
}

/**
 * Put the ad on the conversation, once.
 *
 * Conditional on `adReferralAt IS NULL`, so two webhook deliveries of the same
 * first message — or a second ad tapped later — cannot move it. The columns
 * are what a report groups by; the rest of the payload goes to
 * `metadata.adReferral`, where `ctwa_clid` waits for the Conversions API.
 *
 * Returns true when this call is the one that recorded it.
 */
export async function recordAdReferral(input: {
  orgId: string
  conversationId: string
  referral: AdReferral
  now?: Date
}): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma")
  const payload = JSON.stringify({
    sourceType: input.referral.sourceType,
    sourceId: input.referral.sourceId,
    headline: input.referral.headline,
    body: input.referral.body,
    sourceUrl: input.referral.sourceUrl,
    ctwaClid: input.referral.ctwaClid,
  })
  const changed = await prisma.$executeRaw`
    UPDATE social_conversations
    SET "adSourceType" = ${input.referral.sourceType},
        "adSourceId" = ${input.referral.sourceId},
        "adHeadline" = ${input.referral.headline},
        "adReferralAt" = ${input.now ?? new Date()},
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{adReferral}', ${payload}::jsonb, true)
    WHERE id = ${input.conversationId}
      AND "organizationId" = ${input.orgId}
      AND "adReferralAt" IS NULL`
  return changed > 0
}

/** What the badge says when the ad has no headline of its own. */
export function adReferralLabel(referral: { headline: string | null; sourceId: string | null }): string | null {
  return referral.headline ?? (referral.sourceId ? `#${referral.sourceId}` : null)
}
