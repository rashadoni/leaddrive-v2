/**
 * 24h-silence auto-follow-up for TikTok (Chatwoot bridge) conversations.
 *
 * Sends ONE gentle nudge to a customer who went silent for ≥24h AFTER our last
 * reply — recovering leads that asked, got an answer, then drifted off. Guarantees:
 *   • idempotent — one follow-up per conversation, ever, via an ATOMIC claim on the
 *     dedicated `followUpSentAt` column (a conditional `updateMany WHERE followUpSentAt
 *     IS NULL` flips null→now; Postgres serializes it, so two overlapping cron ticks can
 *     never both win → no double-send). A customer who re-engages then goes silent AGAIN
 *     is NOT re-nudged — one nudge ever, by design;
 *   • only when WE spoke last (last message outbound). If the customer wrote last we owe
 *     THEM a reply — a "still interested?" nudge there would be wrong;
 *   • daytime only — 09:00–21:00 Azerbaijan time (UTC+4, DST abolished 2016), so a
 *     thread that crosses 24h at 03:00 waits for the next daytime run;
 *   • opt-in per org via the `inboxFollowUp` feature flag;
 *   • text overridable per channel via ChannelConfig(chatwoot).settings.followUpMessage —
 *     resolved from the config the CONVERSATION arrived on, so an org running two
 *     Chatwoot accounts does not nudge with the other account's wording.
 *
 * We deliberately do NOT bump `lastMessageAt` on send: an automated nudge must not reset
 * the thread's silence age in the inbox aging analytics (the customer is still the one who
 * owes a reply). Idempotency rides the dedicated column, not lastMessageAt.
 *
 * The route (src/app/api/cron/inbox-followup) is a thin wrapper; this is the testable core.
 */
import type { PrismaClient } from "@prisma/client"

/** Org opts into 24h silent-customer follow-ups via this feature flag. */
export const FOLLOWUP_FLAG = "inboxFollowUp"

const SILENCE_MS = 24 * 60 * 60 * 1000 // nudge after 24h of silence
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // ...but never resurrect a thread older than 7d
const PER_ORG_CAP = 200 // safety cap per run

// Azerbaijan is UTC+4 year-round (no DST since 2016). Send only inside the local day window.
const AZ_OFFSET_HOURS = 4
const DAY_START = 9 // 09:00 AZT
const DAY_END = 21 // 21:00 AZT (exclusive)

/** Default nudge (Azerbaijani). Overridable per channel via settings.followUpMessage. */
export const DEFAULT_FOLLOWUP =
  "Salam! 👋 Maraqlandığınız sual hələ də aktualdırsa, kömək etməyə şadıq 😊 İstəsəniz, " +
  "ölçülərinizə uyğun dəqiq qiymət hesablaya və ya nümunə şəkillər göndərə bilərik — sadəcə yazın."

/** True when `now` falls inside the 09:00–21:00 Azerbaijan daytime send window. */
export function isDaytimeAZ(now: Date): boolean {
  const h = (now.getUTCHours() + AZ_OFFSET_HOURS) % 24
  return h >= DAY_START && h < DAY_END
}

type Db = Pick<PrismaClient, "organization" | "socialConversation" | "channelMessage" | "channelConfig">
type FollowupSendResult = true | false | "unknown"
/**
 * `channelConfigId` is the config the conversation arrived on. It is not
 * optional decoration: the Chatwoot sender otherwise resolves "any active
 * chatwoot config for this org", so an org with two of them nudges the
 * customer from the wrong Chatwoot account.
 */
type SendFn = (p: {
  conversationId: string
  content: string
  organizationId: string
  channelConfigId: string | null
}) => Promise<FollowupSendResult>

export interface FollowupResult {
  skipped?: string
  orgs: number
  sent: number
}

export async function runInboxFollowups(db: Db, opts: { now: Date; send: SendFn }): Promise<FollowupResult> {
  const { now, send } = opts

  // Daytime gate first — the crontab fires hourly; outside the window this is a cheap no-op.
  if (!isDaytimeAZ(now)) return { skipped: "outside-daytime-window", orgs: 0, sent: 0 }

  const allOrgs = await db.organization.findMany({
    where: { isActive: true },
    select: { id: true, features: true },
  })
  // features is JSON (array) — filter in code (no scalar-list `has` operator available).
  const orgs = allOrgs.filter(
    (o) => Array.isArray(o.features) && (o.features as unknown[]).includes(FOLLOWUP_FLAG),
  )
  if (orgs.length === 0) return { orgs: 0, sent: 0 }

  const cutoff = new Date(now.getTime() - SILENCE_MS)
  const floor = new Date(now.getTime() - MAX_AGE_MS)
  let sent = 0

  for (const org of orgs) {
    const candidates = await db.socialConversation.findMany({
      where: {
        organizationId: org.id,
        platform: "tiktok",
        status: "open",
        followUpSentAt: null, // not yet nudged (the dedicated idempotency column)
        lastMessageAt: { lte: cutoff, gte: floor },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
      },
      select: { id: true, externalId: true, channelConfigId: true },
      orderBy: { lastMessageAt: "asc" },
      take: PER_ORG_CAP,
    })

    // Per-channel override for the nudge text, resolved per CONVERSATION. An org can
    // run two Chatwoot accounts, each carrying its own settings.followUpMessage; one
    // `findFirst` per org (no id, no orderBy) picked whichever active config the
    // database happened to return first and nudged EVERY customer with it, so half of
    // them read the other account's wording. The send is routed now, which makes the
    // mismatch worse rather than better: the account named here really does deliver a
    // message written for the other one.
    //
    // ONE batched query for the whole candidate set — not one per conversation. The
    // `organizationId` predicate is load-bearing, not defensive tidiness: this cron
    // runs under runWithRlsBypass (see the route), so it is the ONLY tenant boundary
    // on this read, and a conversation pointing at a foreign config id would
    // otherwise resolve it and put another org's wording in front of the customer.
    // `channelType`/`isActive` are carried over from the query this replaces: a
    // deactivated config, or one that is not the Chatwoot bridge, falls back to
    // DEFAULT_FOLLOWUP rather than to some other account's custom text.
    const configIds = [...new Set(candidates.map((c) => c.channelConfigId).filter((id): id is string => !!id))]
    const configs = configIds.length
      ? await db.channelConfig.findMany({
          where: { id: { in: configIds }, organizationId: org.id, channelType: "chatwoot", isActive: true },
          select: { id: true, settings: true },
        })
      : []
    const overrideByConfigId = new Map<string, string>()
    for (const cfg of configs) {
      const custom = (cfg.settings as { followUpMessage?: string } | null)?.followUpMessage
      // Unchanged rule: truthiness is tested on the TRIMMED value, and the trimmed
      // value is what ships — a whitespace-only override is not an override.
      const trimmed = typeof custom === "string" && custom.trim()
      if (trimmed) overrideByConfigId.set(cfg.id, trimmed)
    }

    for (const conv of candidates) {
      try {
        // The wording belongs to the Chatwoot account this conversation arrived on.
        const text = (conv.channelConfigId && overrideByConfigId.get(conv.channelConfigId)) || DEFAULT_FOLLOWUP

        // Only nudge a customer who went silent AFTER our reply (last message outbound).
        const last = await db.channelMessage.findFirst({
          where: { conversationId: conv.id, channelType: "tiktok" },
          orderBy: { createdAt: "desc" },
          select: { direction: true },
        })
        if (last?.direction !== "outbound") continue

        // ATOMIC CLAIM before sending: only one of N concurrent runs can flip
        // followUpSentAt null→now (Postgres serializes the conditional UPDATE), so a
        // customer can never get two nudges even if two cron ticks overlap. count 0 = lost.
        const claim = await db.socialConversation.updateMany({
          where: { id: conv.id, followUpSentAt: null },
          data: { followUpSentAt: now },
        })
        if (claim.count !== 1) continue

        const sendResult = await send({
          conversationId: conv.externalId,
          content: text,
          organizationId: org.id,
          channelConfigId: conv.channelConfigId,
        })
        if (sendResult === "unknown") {
          // Ambiguous transport outcomes are terminal for automatic retries:
          // Chatwoot may have accepted the POST. Keep the atomic claim and
          // leave an operator-visible audit row without asserting delivery.
          await db.channelMessage
            .create({
              data: {
                organizationId: org.id,
                channelConfigId: conv.channelConfigId,
                channelType: "tiktok",
                direction: "outbound",
                from: "chatwoot",
                to: conv.externalId,
                body: text,
                status: "failed",
                messageType: "text",
                conversationId: conv.id,
                metadata: { autoReply: true, followUp: true, deliveryUnknown: true },
              },
            })
            .catch(() => {})
          continue
        }
        if (!sendResult) {
          // Release the claim so a later run retries (best-effort).
          await db.socialConversation.update({ where: { id: conv.id }, data: { followUpSentAt: null } }).catch(() => {})
          continue
        }

        // Mirror the sent nudge into the inbox (chatwoot re-emits outgoing as a webhook we
        // intentionally skip, so the record must be written here). lastMessageAt is NOT
        // bumped — see the file header.
        await db.channelMessage
          .create({
            data: {
              organizationId: org.id,
              channelConfigId: conv.channelConfigId,
              channelType: "tiktok",
              direction: "outbound",
              from: "chatwoot",
              to: conv.externalId,
              body: text,
              status: "delivered",
              messageType: "text",
              conversationId: conv.id,
              metadata: { autoReply: true, followUp: true },
            },
          })
          .catch(() => {})

        sent++
      } catch (e) {
        // One bad conversation must never abort the whole sweep.
        console.error("[inbox-followup] conversation failed", conv.id, e)
      }
    }
  }

  return { orgs: orgs.length, sent }
}
