/**
 * C5 Account Engagement — Phase 2: derive AccountIntentSignals from the CRM's
 * ContactEvent stream.
 *
 * A subset of the contact-level event types tracked via `lib/contact-events.ts`
 * map onto ABM intent SignalKinds. When the event's contact belongs to a
 * company that is a tracked MarketingAccount, we record an AccountIntentSignal
 * so the account accrues 30-day intent (and, in Phase 3, an engagement score).
 *
 * Events with no marketing meaning — billing, e-sign envelope lifecycle,
 * internal notes, outbound `email_sent`, etc. — map to null and are skipped
 * BEFORE any DB work, so the live hook adds zero queries for the common case.
 *
 * Injectable Prisma client (mirrors `config-loader.ts`) → unit-testable with a
 * mock and usable inside a caller-managed transaction.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"
import { classifySignal } from "./intent-signal-classifier"
import type { SignalKind } from "./types"

/**
 * CRM `ContactEvent.eventType` → ABM `SignalKind`. Anything absent here is not
 * an intent signal and is skipped. Kept intentionally conservative: only
 * inbound, buyer-initiated touches map (outbound `email_sent`, sales-logged
 * calls, deal/ticket/note events, and all billing/e-sign events are excluded).
 */
const EVENT_TYPE_TO_SIGNAL_KIND: Readonly<Record<string, SignalKind>> = {
  email_opened: "email_engagement",
  email_clicked: "email_engagement",
  email_replied: "email_engagement",
  form_submitted: "form_submission",
  page_visited: "page_view_research",
  meeting_scheduled: "event_attendance",
}

export function mapEventTypeToSignalKind(eventType: string): SignalKind | null {
  return EVENT_TYPE_TO_SIGNAL_KIND[eventType] ?? null
}

/** Distinct signal kinds Phase-2 ingestion can produce (docs / tests). */
export const INGESTED_SIGNAL_KINDS: readonly SignalKind[] = Object.freeze(
  Array.from(new Set(Object.values(EVENT_TYPE_TO_SIGNAL_KIND))),
)

/** CRM event types that map to a signal — lets the backfill filter at the DB. */
export const INTENT_EVENT_TYPES: readonly string[] = Object.freeze(
  Object.keys(EVENT_TYPE_TO_SIGNAL_KIND),
)

/** Minimal Prisma surface — satisfied by the global client or a tx client. */
export type SignalClient = {
  contact: {
    findFirst(args: {
      where: { id: string; organizationId: string }
      select: { companyId: true }
    }): Promise<{ companyId: string | null } | null>
  }
  marketingAccount: {
    findFirst(args: {
      where: { organizationId: string; companyId: string }
      select: { id: true }
    }): Promise<{ id: string } | null>
    update(args: {
      where: { id: string }
      data: { lastSignalAt: Date }
    }): Promise<unknown>
  }
  accountIntentSignal: {
    findFirst(args: {
      where: {
        organizationId: string
        marketingAccountId: string
        signalKind: string
        occurredAt: Date
        contactId: string | null
      }
      select: { id: true }
    }): Promise<{ id: string } | null>
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
}

export interface RecordSignalInput {
  organizationId: string
  contactId: string
  eventType: string
  occurredAt: Date
  resourceRef?: string | null
  /**
   * Explicit signal kind — bypasses the eventType→kind map. Used by callers
   * that classify the kind themselves (e.g. the web-tracking pixel deriving
   * page_view_high_intent vs page_view_research from the URL). When set,
   * eventType is kept only as metadata/provenance.
   */
  signalKind?: SignalKind
}

export type RecordSignalResult =
  | {
      recorded: true
      signalId: string
      signalKind: SignalKind
      marketingAccountId: string
    }
  | {
      recorded: false
      reason: "not_intent" | "no_company" | "not_tracked" | "duplicate"
    }

/**
 * Resolve a ContactEvent to its MarketingAccount and record an
 * AccountIntentSignal. Idempotent: a signal with the same
 * (account, kind, occurredAt, contact) is not duplicated — so a backfill can be
 * re-run safely. Returns a structured reason when it records nothing, so
 * callers / the backfill can tally outcomes.
 */
export async function recordAccountIntentSignal(
  input: RecordSignalInput,
  client: SignalClient = defaultPrisma as unknown as SignalClient,
): Promise<RecordSignalResult> {
  const signalKind = input.signalKind ?? mapEventTypeToSignalKind(input.eventType)
  if (!signalKind) return { recorded: false, reason: "not_intent" }

  const contact = await client.contact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
    select: { companyId: true },
  })
  if (!contact?.companyId) return { recorded: false, reason: "no_company" }

  const account = await client.marketingAccount.findFirst({
    where: { organizationId: input.organizationId, companyId: contact.companyId },
    select: { id: true },
  })
  if (!account) return { recorded: false, reason: "not_tracked" }

  // Idempotency guard — same account+kind+time+contact is the same signal.
  const dup = await client.accountIntentSignal.findFirst({
    where: {
      organizationId: input.organizationId,
      marketingAccountId: account.id,
      signalKind,
      occurredAt: input.occurredAt,
      contactId: input.contactId,
    },
    select: { id: true },
  })
  if (dup) return { recorded: false, reason: "duplicate" }

  const classified = classifySignal({
    signalKind,
    resourceRef: input.resourceRef ?? null,
  })
  const weight = classified.ok ? classified.classification.defaultWeight : 5

  const signal = await client.accountIntentSignal.create({
    data: {
      organizationId: input.organizationId,
      marketingAccountId: account.id,
      signalKind,
      weight,
      contactId: input.contactId,
      resourceRef: input.resourceRef ?? null,
      occurredAt: input.occurredAt,
      metadata: { sourceEventType: input.eventType },
    },
  })

  // Keep the account's "last signal" fresh (cheap; full recompute is Phase 3).
  await client.marketingAccount.update({
    where: { id: account.id },
    data: { lastSignalAt: input.occurredAt },
  })

  return {
    recorded: true,
    signalId: signal.id,
    signalKind,
    marketingAccountId: account.id,
  }
}
