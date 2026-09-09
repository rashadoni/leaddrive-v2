/**
 * C9 Marketing Attribution — touchpoint recorder (Phase 2).
 *
 * Single idempotent entry point for deriving CampaignTouchpoint rows from
 * real marketing events (email opens/clicks, event registrations, deal↔
 * campaign links). Used by both the live hooks and the backfill script.
 *
 * Idempotency: every derived touchpoint carries a deterministic `sourceKey`
 * (e.g. "email:<emailLogId>:opened"). Writes go through
 * createMany({ skipDuplicates: true }) → Postgres INSERT … ON CONFLICT DO
 * NOTHING against the partial UNIQUE (organizationId, sourceKey) index. That
 * never issues an UPDATE, so the append-only trigger on campaign_touchpoints
 * is never tripped, and re-running a backfill (or a retried webhook) is a
 * no-op for already-recorded touchpoints.
 *
 * Coherence: rows without both contactId and campaignId are dropped here —
 * the DB coherence trigger would reject NULLs anyway, and an attribution
 * touchpoint is meaningless without a contact + campaign.
 */
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import type { TouchpointChannel } from "./types"

export interface TouchpointInput {
  /** Contact the interaction belongs to. Falsy → row dropped. */
  contactId: string | null | undefined
  /** Campaign the interaction is attributed to. Falsy → row dropped. */
  campaignId: string | null | undefined
  channel: TouchpointChannel
  touchpointType: string
  occurredAt: Date
  /** Optional explicit deal link (else the aggregator infers by contact). */
  dealId?: string | null
  /** Deterministic idempotency key — REQUIRED so re-runs are no-ops. */
  sourceKey: string
  metadata?: Record<string, unknown>
}

/** Minimal structural type satisfied by both `prisma` and a `$transaction` tx. */
type TouchpointWriter = {
  campaignTouchpoint: {
    createMany: (args: {
      data: Prisma.CampaignTouchpointCreateManyInput[]
      skipDuplicates?: boolean
    }) => Promise<{ count: number }>
  }
}

/**
 * Idempotently persist derived touchpoints. Returns the number of rows
 * actually inserted (0 when all were duplicates or all dropped). Throws on
 * DB error — callers on a hot/best-effort path should use
 * {@link recordTouchpointsSafe} instead.
 */
export async function recordTouchpoints(
  orgId: string,
  rows: TouchpointInput[],
  client: TouchpointWriter = prisma,
): Promise<number> {
  const data: Prisma.CampaignTouchpointCreateManyInput[] = []
  for (const r of rows) {
    if (!r.contactId || !r.campaignId) continue
    data.push({
      organizationId: orgId,
      contactId: r.contactId,
      campaignId: r.campaignId,
      dealId: r.dealId ?? null,
      channel: r.channel,
      touchpointType: r.touchpointType,
      occurredAt: r.occurredAt,
      sourceKey: r.sourceKey,
      metadata: (r.metadata ?? {}) as Prisma.InputJsonValue,
    })
  }
  if (data.length === 0) return 0
  const res = await client.campaignTouchpoint.createMany({ data, skipDuplicates: true })
  return res.count
}

/**
 * Best-effort variant for live hooks: never throws, logs + swallows so a
 * touchpoint failure can't break the user-facing path (email pixel, event
 * registration, deal create). Returns rows inserted, or 0 on error.
 */
export async function recordTouchpointsSafe(
  orgId: string,
  rows: TouchpointInput[],
  client: TouchpointWriter = prisma,
): Promise<number> {
  try {
    return await recordTouchpoints(orgId, rows, client)
  } catch (e) {
    console.error("[attribution] recordTouchpoints failed:", e)
    return 0
  }
}

/* ── deterministic sourceKey builders (shared by hooks + backfill) ──────── */

export const touchpointSourceKey = {
  emailSent: (emailLogId: string) => `email:${emailLogId}:sent`,
  emailOpened: (emailLogId: string) => `email:${emailLogId}:opened`,
  emailClicked: (emailLogId: string) => `email:${emailLogId}:clicked`,
  eventRegistered: (participantId: string) => `event:${participantId}:registered`,
  eventAttended: (participantId: string) => `event:${participantId}:attended`,
  dealCampaignLink: (dealId: string) => `deal:${dealId}:campaign_link`,
  formSubmitted: (submissionId: string) => `form:${submissionId}:submitted`,
  smsSent: (campaignId: string, contactId: string) => `sms:${campaignId}:${contactId}:sent`,
  smsClicked: (campaignId: string, contactId: string) => `sms:${campaignId}:${contactId}:clicked`,
  adClick: (campaignId: string, contactId: string) => `ad:${campaignId}:${contactId}:click`,
} as const
