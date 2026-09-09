import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Engagement Score Decay Cron
 * Called weekly. Recalculates scores with time-decay using batch operations.
 * - Full weight for events 0-30 days old
 * - 50% weight for events 30-60 days old
 * - 25% weight for events 60-90 days old
 * - Events older than 90 days are ignored
 * - Score capped at 100
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const now = Date.now()
    const thirtyDaysAgo = new Date(now - 30 * 86400000)
    const sixtyDaysAgo = new Date(now - 60 * 86400000)
    const ninetyDaysAgo = new Date(now - 90 * 86400000)

    // Get all contacts with score > 0 in batches of 500
    const BATCH_SIZE = 500
    let skip = 0
    let totalRecalculated = 0
    let totalDecayed = 0

    while (true) {
      const contacts = await prisma.contact.findMany({
        where: { engagementScore: { gt: 0 } },
        select: { id: true, engagementScore: true },
        take: BATCH_SIZE,
        skip,
        orderBy: { id: "asc" },
      })

      if (contacts.length === 0) break

      // Get all events for this batch of contacts in one query
      const contactIds = contacts.map((c: any) => c.id)
      const events = await prisma.contactEvent.findMany({
        where: {
          contactId: { in: contactIds },
          createdAt: { gte: ninetyDaysAgo },
        },
        select: { contactId: true, eventType: true, score: true, createdAt: true },
      })

      // Group events by contactId
      const eventsByContact = new Map<string, typeof events>()
      for (const event of events) {
        const existing = eventsByContact.get(event.contactId) || []
        existing.push(event)
        eventsByContact.set(event.contactId, existing)
      }

      // Calculate new scores and batch update
      const updates: Array<{ id: string; newScore: number }> = []

      for (const contact of contacts) {
        const contactEvents = eventsByContact.get(contact.id) || []
        let newScore = 0

        for (const event of contactEvents) {
          const eventScore = event.score || 1
          const age = now - event.createdAt.getTime()

          if (age < 30 * 86400000) {
            newScore += eventScore
          } else if (age < 60 * 86400000) {
            newScore += Math.floor(eventScore * 0.5)
          } else {
            newScore += Math.floor(eventScore * 0.25)
          }
        }

        newScore = Math.min(100, newScore)

        if (newScore !== contact.engagementScore) {
          updates.push({ id: contact.id, newScore })
          if (newScore < contact.engagementScore) totalDecayed++
        }
        totalRecalculated++
      }

      // Batch update using transaction
      if (updates.length > 0) {
        await prisma.$transaction(
          updates.map(u => prisma.contact.update({
            where: { id: u.id },
            data: { engagementScore: u.newScore },
          }))
        )
      }

      skip += BATCH_SIZE
      if (contacts.length < BATCH_SIZE) break
    }

    return NextResponse.json({
      success: true,
      data: { recalculated: totalRecalculated, decayed: totalDecayed },
    })
  } catch (error) {
    console.error("[Cron] Engagement decay error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
