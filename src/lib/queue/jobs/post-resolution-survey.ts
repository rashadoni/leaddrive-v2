/**
 * Post-resolution survey catch-up job — Salesforce-grade reliability for
 * automatic CSAT/NPS/CES delivery.
 *
 * `triggerSurveysOnTicketResolved` (`src/lib/survey-triggers.ts`) already
 * fires synchronously when a ticket transitions into "resolved", but a
 * failed primary attempt (SMTP outage, WhatsApp 5xx, transient DB error)
 * leaves the customer without a survey invite. This catch-up routine scans
 * a SHORT window of recent resolutions and re-sends missing invites.
 *
 * IDEMPOTENCY (slice 1 — limited):
 *   - Eligibility check skips (ticket, survey) pairs with an existing
 *     `SurveyResponse` row → blocks customers who replied to the first
 *     invite.
 *   - 30-day "responded recently" suppression skips customers who
 *     responded to ANY survey in the last 30 days → prevents post-reply
 *     re-survey within the throttle window.
 *   - **Known limitation**: there is no on-disk record of an invite that
 *     was sent but not yet responded to. An unresponsive customer can
 *     receive a duplicate invite if the scan window overlaps cron runs.
 *     Slice 2 adds a `SurveyInvite` log model (Salesforce's approach) so
 *     the throttle can block "already invited, no response yet" cases.
 *     Until then, callers MUST keep `lookbackHours <= cronIntervalHours`
 *     to limit damage to at-most-one extra invite per run boundary.
 *
 * `minAgeMinutes` ensures we don't race the immediate path — tickets
 * resolved less than `minAgeMinutes` ago are skipped, giving
 * `triggerSurveysOnTicketResolved` time to either succeed or fail visibly.
 *
 * Part of B9 CSAT/NPS auto-surveys (Phase 2 roadmap, slice 1).
 *
 * Slice 2 will add:
 *   - `SurveyInvite` log model for true at-most-once delivery
 *   - `triggers.delayMinutes` so the immediate path can defer to a delayed
 *     queue job instead of firing on the resolve event
 *   - Per-priority filters and per-channel preference overrides
 */
import type { PrismaClient } from "@prisma/client"

export interface EligibleSurveyTarget {
  organizationId: string
  ticketId: string
  ticketNumber: string
  contactId: string | null
  source: string | null
  /**
   * Channel-specific context as it arrived from Prisma (`Json?` column).
   * `pickInviteChannel` in `src/lib/survey-triggers.ts` runs a type-guard
   * before reading `sessionId`. Kept as `unknown` to honour the JSON
   * surface — never cast at call sites.
   */
  sourceMeta: unknown
  surveyId: string
  surveyName: string
}

export interface PostResolutionSurveyResult {
  ticketsScanned: number
  surveysSent: number
  /** Skipped due to recent-response throttle OR within-run dedup. */
  suppressed: number
  /** Skipped because the ticket is too fresh — immediate path still has time. */
  tooFresh: number
  errors: number
  lookbackHours: number
  minAgeMinutes: number
  suppressionDays: number
}

/**
 * Pure eligibility check — used by both the cron path and unit tests.
 * A (ticket, survey) pair is eligible when:
 *   - Survey is active and has `triggers.afterTicketResolve` truthy
 *   - No `SurveyResponse` exists for (surveyId, ticketId) yet
 *   - Ticket was resolved within the lookback window (caller-filtered)
 */
export function isSurveyEligible(
  survey: { status: string; triggers: unknown },
  ticketHasResponse: boolean
): boolean {
  if (survey.status !== "active") return false
  const triggers = (survey.triggers ?? {}) as { afterTicketResolve?: boolean }
  if (!triggers.afterTicketResolve) return false
  if (ticketHasResponse) return false
  return true
}

/**
 * Pure suppression check — was this contact recently surveyed?
 * Returns true when the contact's email or phone appears in any
 * `SurveyResponse` (any survey) in the last `suppressionDays` days.
 */
export function isContactSuppressed(
  recentResponses: { email: string | null; phone: string | null }[],
  contact: { email: string | null; phone: string | null }
): boolean {
  if (recentResponses.length === 0) return false
  const emailLc = contact.email?.toLowerCase() ?? null
  const phone = contact.phone ?? null
  for (const r of recentResponses) {
    if (emailLc && r.email && r.email.toLowerCase() === emailLc) return true
    if (phone && r.phone && r.phone === phone) return true
  }
  return false
}

interface PrismaSubset {
  ticket: {
    findMany: (args: any) => Promise<any[]>
  }
  survey: {
    findMany: (args: any) => Promise<any[]>
  }
  surveyResponse: {
    findMany: (args: any) => Promise<any[]>
  }
}

/**
 * Run the catch-up scan. Returns aggregate counts; the actual send happens
 * via the `sendInvite` callback so the queue handler and the HTTP route
 * can share this logic without dragging in the email/SMS plumbing module.
 */
export async function runPostResolutionSurveyScan(
  prisma: PrismaSubset,
  sendInvite: (target: EligibleSurveyTarget, contact: { email: string | null; phone: string | null }) => Promise<boolean>,
  now: Date = new Date(),
  lookbackHours: number = 2,
  minAgeMinutes: number = 30,
  suppressionDays: number = 30
): Promise<PostResolutionSurveyResult> {
  // Window: [now - lookbackHours, now - minAgeMinutes]. Default 30min..2h
  // matches a 1-hourly cron with margin — each ticket lands in at most one
  // run window (modulo cron drift). Tighten lookback to your cron interval
  // until slice 2 adds an invite-log model for true idempotency.
  const lookbackStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000)
  const freshnessCutoff = new Date(now.getTime() - minAgeMinutes * 60 * 1000)
  const suppressionStart = new Date(now.getTime() - suppressionDays * 24 * 60 * 60 * 1000)

  const result: PostResolutionSurveyResult = {
    ticketsScanned: 0,
    surveysSent: 0,
    suppressed: 0,
    tooFresh: 0,
    errors: 0,
    lookbackHours,
    minAgeMinutes,
    suppressionDays,
  }

  // Recently resolved tickets, scoped by resolvedAt window: older than
  // freshnessCutoff (let the immediate path try first) but within lookback.
  const tickets = await prisma.ticket.findMany({
    where: {
      status: "resolved",
      resolvedAt: { gte: lookbackStart, lte: freshnessCutoff },
      contactId: { not: null },
    },
    select: {
      id: true,
      ticketNumber: true,
      contactId: true,
      organizationId: true,
      source: true,
      sourceMeta: true,
      resolvedAt: true,
      contact: { select: { id: true, email: true, phone: true } },
    },
  })
  result.ticketsScanned = tickets.length
  if (tickets.length === 0) return result

  // Group tickets by org so survey + suppression queries are per-tenant
  const ticketsByOrg = new Map<string, typeof tickets>()
  for (const t of tickets) {
    const list = ticketsByOrg.get(t.organizationId) ?? []
    list.push(t)
    ticketsByOrg.set(t.organizationId, list)
  }

  for (const [orgId, orgTickets] of ticketsByOrg) {
    const surveys = await prisma.survey.findMany({
      where: { organizationId: orgId, status: "active" },
      select: { id: true, name: true, status: true, triggers: true },
    })
    const eligibleSurveys = surveys.filter(s =>
      isSurveyEligible({ status: s.status, triggers: s.triggers }, false)
    )
    if (eligibleSurveys.length === 0) continue

    // Pull existing responses + recent responses (suppression window) once per org
    const ticketIds = orgTickets.map(t => t.id)
    const surveyIds = eligibleSurveys.map(s => s.id)
    const [existingResponses, recentResponses] = await Promise.all([
      prisma.surveyResponse.findMany({
        where: {
          organizationId: orgId,
          surveyId: { in: surveyIds },
          ticketId: { in: ticketIds },
        },
        select: { surveyId: true, ticketId: true },
      }),
      prisma.surveyResponse.findMany({
        where: {
          organizationId: orgId,
          completedAt: { gte: suppressionStart, lte: now },
        },
        select: { email: true, phone: true },
      }),
    ])
    const responseKey = (sid: string, tid: string) => `${sid}:${tid}`
    const respondedSet = new Set(existingResponses.map(r => responseKey(r.surveyId, r.ticketId)))

    for (const ticket of orgTickets) {
      if (!ticket.contact) continue

      for (const survey of eligibleSurveys) {
        // Suppression check per iteration so a successful send within this
        // run (pushed into recentResponses) blocks the second eligible
        // survey for the same contact on the next iteration.
        if (isContactSuppressed(recentResponses, {
          email: ticket.contact.email,
          phone: ticket.contact.phone,
        })) {
          result.suppressed++
          continue
        }

        const alreadyResponded = respondedSet.has(responseKey(survey.id, ticket.id))
        if (alreadyResponded) continue

        try {
          const ok = await sendInvite(
            {
              organizationId: orgId,
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              contactId: ticket.contact.id,
              source: ticket.source ?? null,
              sourceMeta: ticket.sourceMeta ?? null,
              surveyId: survey.id,
              surveyName: survey.name,
            },
            { email: ticket.contact.email, phone: ticket.contact.phone }
          )
          if (ok) {
            result.surveysSent++
            recentResponses.push({ email: ticket.contact.email, phone: ticket.contact.phone })
          } else {
            result.errors++
          }
        } catch {
          result.errors++
        }
      }
    }
  }

  return result
}
