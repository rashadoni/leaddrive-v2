import { prisma } from "@/lib/prisma"
import { recordAccountIntentSignal } from "@/lib/account-engagement/contact-event-signal"

const SCORE_WEIGHTS: Record<string, number> = {
  email_sent: 1,
  email_opened: 3,
  email_clicked: 5,
  email_replied: 5,
  form_submitted: 8,
  meeting_scheduled: 10,
  call_logged: 5,
  deal_created: 15,
  ticket_created: 3,
  page_visited: 1,
  note_added: 2,
}

export async function trackContactEvent(
  orgId: string,
  contactId: string,
  eventType: string,
  eventData?: Record<string, any>,
  source?: string
): Promise<void> {
  const score = SCORE_WEIGHTS[eventType] ?? 1

  try {
    await prisma.contactEvent.create({
      data: {
        organizationId: orgId,
        contactId,
        eventType,
        eventData: eventData ?? {},
        source: source ?? "system",
        score,
      },
    })

    // Increment score but cap at 100
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { engagementScore: true },
    })
    const currentScore = contact?.engagementScore ?? 0
    const newScore = Math.min(100, currentScore + score)

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        engagementScore: newScore,
        lastActivityAt: new Date(),
      },
    })

    // Phase 2 — mirror marketing-relevant events into account-level intent
    // signals (best-effort, isolated). Non-intent eventTypes return before any
    // query, so this adds no DB cost for billing / e-sign / internal events.
    try {
      await recordAccountIntentSignal({
        organizationId: orgId,
        contactId,
        eventType,
        occurredAt: new Date(),
        resourceRef:
          typeof eventData?.url === "string"
            ? eventData.url
            : typeof eventData?.resourceRef === "string"
              ? eventData.resourceRef
              : null,
      })
    } catch (e) {
      console.error("[ContactEvents] account intent signal failed:", e)
    }
  } catch (error) {
    console.error("[ContactEvents] Failed to track event:", error)
  }
}

export async function recalculateEngagementScore(contactId: string): Promise<number> {
  const now = Date.now()
  const thirtyDaysAgo = new Date(now - 30 * 86400000)
  const sixtyDaysAgo = new Date(now - 60 * 86400000)
  const ninetyDaysAgo = new Date(now - 90 * 86400000)

  const events = await prisma.contactEvent.findMany({
    where: { contactId, createdAt: { gte: ninetyDaysAgo } },
    select: { eventType: true, score: true, createdAt: true },
  })

  let totalScore = 0
  for (const event of events) {
    const eventScore = event.score || (SCORE_WEIGHTS[event.eventType] ?? 1)
    const age = now - event.createdAt.getTime()

    if (age < 30 * 86400000) {
      totalScore += eventScore // Full weight for 0-30 days
    } else if (age < 60 * 86400000) {
      totalScore += Math.floor(eventScore * 0.5) // 50% for 30-60 days
    } else {
      totalScore += Math.floor(eventScore * 0.25) // 25% for 60-90 days
    }
  }

  // Cap at 100
  totalScore = Math.min(100, totalScore)

  await prisma.contact.update({
    where: { id: contactId },
    data: { engagementScore: totalScore },
  })

  return totalScore
}
