/**
 * C2 (Creatio 10X roadmap) — web-tracking identity stitching.
 *
 * When an anonymous visitor (first-party `_ldv` cookie → WebSession.visitorId)
 * reveals who they are — submits a tracked form, or clicks a per-recipient
 * email/SMS/ad link — we bind that visitorId to the Contact and backfill up to
 * `STITCH_WINDOW_DAYS` of their prior sessions onto the contact. That link is
 * what C3 renders on the contact card, and the retention cron keeps stitched
 * sessions (`contactId != null`) instead of reaping them.
 *
 * Pure over an injected Prisma client (no HTTP/auth/env) so it is unit-testable
 * and callable from either an ingest route (`runWithTenant`) or a cron backfill
 * (`runWithRlsBypass`). Callers own the RLS scope.
 *
 * Idempotency + attribution rule: only sessions still anonymous (`contactId:
 * null`) are claimed. A session already attributed to a contact is never
 * re-pointed, so re-identifying on a shared browser attributes only NEW
 * sessions to the newer contact — old history stays with whoever owned it.
 */
import type { PrismaClient } from "@prisma/client"
import { STITCH_WINDOW_DAYS, SESSION_IDLE_MINUTES, parseUtm, appendIdentityToken } from "./web-tracking"

type StitchClient = Pick<PrismaClient, "webSession">

export interface StitchArgs {
  organizationId: string
  visitorId: string
  contactId: string
  /**
   * Page URL the identification happened on (snippet's location.href) — stamps
   * the stub session created when the identify beacon wins the race against
   * the first pageview batch (see below).
   */
  url?: string | null
  /** Injected for testability; defaults to now. */
  now?: Date
  /** Override the 30-day backfill window (tests). */
  windowDays?: number
}

export interface StitchResult {
  /** Sessions newly attributed to the contact by this call. */
  stitchedSessions: number
}

export async function stitchVisitorToContact(
  client: StitchClient,
  args: StitchArgs,
): Promise<StitchResult> {
  const { organizationId, visitorId, contactId } = args
  if (!organizationId || !visitorId || !contactId) return { stitchedSessions: 0 }

  const now = args.now ?? new Date()
  const windowDays = args.windowDays ?? STITCH_WINDOW_DAYS
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  // Claim every still-anonymous session of this visitor seen inside the window.
  // `lastSeenAt >= cutoff` uses the (organizationId, visitorId, lastSeenAt)
  // index; `contactId: null` makes the write idempotent and non-clobbering.
  const claimed = await client.webSession.updateMany({
    where: {
      organizationId,
      visitorId,
      contactId: null,
      lastSeenAt: { gte: cutoff },
    },
    data: { contactId },
  })

  // First-visit race: the snippet's identify beacon fires immediately on
  // landing, but the pageview that CREATES the session sits in the client's
  // 5-second flush batch. If the visitor has no live session (stitched or
  // not) inside the ingest's idle window, pre-create one already bound to the
  // contact — the ingest's find-or-create then attaches the landing pageview
  // to it instead of minting a new anonymous session that nothing would ever
  // claim. Same accepted two-writer race as the ingest's own find-or-create.
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MINUTES * 60 * 1000)
  const live = await client.webSession.findFirst({
    where: { organizationId, visitorId, lastSeenAt: { gte: idleCutoff } },
    select: { id: true },
  })
  if (!live) {
    const url = args.url ?? null
    await client.webSession.create({
      data: {
        organizationId,
        visitorId,
        contactId,
        startedAt: now,
        lastSeenAt: now,
        entryUrl: url,
        ...parseUtm(url),
      },
      select: { id: true },
    })
    return { stitchedSessions: claimed.count + 1 }
  }

  // Interleave guard: the claim saw 0 rows but a live session exists NOW —
  // the ingest created it between the two statements (first-visit landing:
  // pageview batch and identify race server-side). Re-claim once; still
  // idempotent, still non-clobbering.
  if (claimed.count === 0) {
    const reclaimed = await client.webSession.updateMany({
      where: { organizationId, visitorId, contactId: null, lastSeenAt: { gte: cutoff } },
      data: { contactId },
    })
    return { stitchedSessions: reclaimed.count }
  }

  return { stitchedSessions: claimed.count }
}

/**
 * Email → contact → stitch, shared by the identify endpoint and the public
 * form submit route so the matching rule cannot drift between the two stitch
 * surfaces. Matching is case-insensitive: Contact.email is stored as typed,
 * while identify callers normalise to lowercase — a `=` match would silently
 * skip any contact whose stored email carries uppercase.
 *
 * `email` must already be normalised (see normalizeEmail in
 * activity-capture/matcher). No contact match → no-op: never signalled to the
 * caller's HTTP response, so the endpoint stays enumeration-proof.
 */
export async function stitchByEmail(
  client: Pick<PrismaClient, "webSession" | "contact">,
  args: Omit<StitchArgs, "contactId"> & { email: string },
): Promise<StitchResult> {
  const { organizationId, email, ...rest } = args
  if (!organizationId || !email) return { stitchedSessions: 0 }
  const contact = await client.contact.findFirst({
    where: { organizationId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  })
  if (!contact) return { stitchedSessions: 0 }
  return stitchVisitorToContact(client, { organizationId, contactId: contact.id, ...rest })
}

/**
 * Shared gate for the tracking redirect routes (click / sms-click / ad-click):
 * when the org runs web tracking, append a signed `_ldi` identity token to the
 * redirect URL so the landing page's snippet can stitch the visitor to the
 * click's contact. Returns the URL unchanged when tracking is off/absent.
 */
export async function maybeAppendIdentityToken(
  client: Pick<PrismaClient, "webTrackingConfig">,
  organizationId: string,
  contactId: string,
  url: string,
): Promise<string> {
  const cfg = await client.webTrackingConfig.findUnique({
    where: { organizationId },
    select: { enabled: true },
  })
  return cfg?.enabled ? appendIdentityToken(url, organizationId, contactId) : url
}
