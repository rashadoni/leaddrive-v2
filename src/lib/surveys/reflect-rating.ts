import { prisma } from "@/lib/prisma"

/**
 * The ticket CSAT widget renders a 1–5 star scale, but a survey can be NPS (0–10) or CES (1–7). Scale
 * the raw survey score down to 1–5 so the widget shows a meaningful star count instead of a value off
 * its scale (an NPS 6 was previously stored as "6", rendering as a full 5/5 and losing the meaning).
 * CSAT/rating surveys are already 1–5 → passed through (clamped for safety). The RAW score is still
 * kept verbatim on survey_responses; only the ticket-widget mirror is scaled.
 */
export function toFiveStar(surveyType: string, score: number): number {
  const max = surveyType === "nps" ? 10 : surveyType === "ces" ? 7 : 5
  const stars = max <= 5 ? Math.round(score) : Math.round((score / max) * 5)
  return Math.min(5, Math.max(1, stars))
}

/**
 * Reflect a survey rating onto its linked ticket so the agent's ticket CSAT widget shows it. The
 * survey link carries `?t=ticketId` (see survey-triggers); on submit we copy the (scaled) score +
 * comment onto `ticket.satisfactionRating`/`satisfactionComment`.
 *
 * Uses `updateMany` with an explicit org guard so a tampered or cross-org `ticketId` (it arrives
 * from a PUBLIC link) is a no-op (count 0) instead of touching another tenant's ticket. Best-effort
 * — a failure here must never break the survey submit.
 */
export async function reflectSurveyRatingOnTicket(opts: {
  orgId: string
  ticketId: string
  score: number
  surveyType: string
  comment?: string | null
}): Promise<void> {
  await prisma.ticket
    .updateMany({
      where: { id: opts.ticketId, organizationId: opts.orgId },
      data: { satisfactionRating: toFiveStar(opts.surveyType, opts.score), satisfactionComment: opts.comment ?? null },
    })
    .catch((err: unknown) => console.error("[survey] reflect rating onto ticket failed:", err))
}
