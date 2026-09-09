/**
 * POST /api/cron/activity-capture-calendar
 *
 * Sync the last 24h of Google Calendar events into CRM Activity rows for
 * every org user with a connected calendar. Wire to external cron hourly.
 *
 *   curl -X POST https://app.leaddrivecrm.org/api/cron/activity-capture-calendar \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Part of A6 Einstein Activity Capture (Phase 3 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { listCalendarEvents } from "@/lib/google-calendar"
import { syncCalendarActivities } from "@/lib/activity-capture/engine"
import type { CalendarEventInput } from "@/lib/activity-capture/types"
import { runWithRlsBypass } from "@/lib/rls-context"

interface GoogleCalendarEvent {
  id?: string | null
  status?: string | null
  summary?: string | null
  description?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  organizer?: { email?: string | null } | null
  attendees?: Array<{ email?: string | null }> | null
  location?: string | null
}

/**
 * Map Google's calendar_v3 Event payload onto our `CalendarEventInput`.
 * Caller-side normalisation lives in the route so the engine stays
 * provider-agnostic — slice 2's Outlook integration plugs in here.
 */
function mapGoogleEvent(raw: GoogleCalendarEvent): CalendarEventInput | null {
  if (!raw.id) return null
  return {
    id: raw.id,
    source: "google_calendar:primary",
    summary: raw.summary ?? null,
    description: raw.description ?? null,
    startIso: raw.start?.dateTime ?? raw.start?.date ?? null,
    endIso: raw.end?.dateTime ?? raw.end?.date ?? null,
    organizerEmail: raw.organizer?.email ?? null,
    attendeeEmails: (raw.attendees ?? [])
      .map(a => a.email)
      .filter((e): e is string => typeof e === "string"),
    location: raw.location ?? null,
    cancelled: raw.status === "cancelled",
  }
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    // Find every user with a connected Google Calendar account, grouped by org.
    type AccountRow = {
      userId: string
      user: { id: string; email: string; organizationId: string }
    }
    // Skip deactivated users — their tokens linger in the Account table but
    // we shouldn't run calendar pulls (or surface their activity in CRM).
    const connectedAccounts: AccountRow[] = await prisma.account.findMany({
      where: {
        provider: { in: ["google-calendar", "google"] },
        access_token: { not: null },
        user: { isActive: true },
      },
      select: {
        userId: true,
        user: { select: { id: true, email: true, organizationId: true } },
      },
      distinct: ["userId"],
    })

    if (connectedAccounts.length === 0) {
      return NextResponse.json({ success: true, message: "No connected calendars", totals: { eventsScanned: 0 } })
    }

    const now = new Date()
    const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const timeMax = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

    // Per-org user-email exclude list — never log activity for internal staff.
    type UserRow = { email: string; organizationId: string }
    const orgIds = [...new Set(connectedAccounts.map(a => a.user.organizationId))]
    const allOrgUsers: UserRow[] = await prisma.user.findMany({
      where: { organizationId: { in: orgIds }, isActive: true },
      select: { email: true, organizationId: true },
    })
    const usersByOrg = new Map<string, string[]>()
    for (const u of allOrgUsers) {
      const list = usersByOrg.get(u.organizationId) ?? []
      list.push(u.email)
      usersByOrg.set(u.organizationId, list)
    }

    let totalScanned = 0
    let totalCreated = 0
    let totalSkipped = 0
    let totalUnmatched = 0
    let totalErrors = 0
    const perUserResults: { userId: string; orgId: string; result: { eventsScanned: number; activitiesCreated: number; activitiesSkipped: number; attendeesUnmatched: number; errors: number } | null; error?: string }[] = []

    for (const account of connectedAccounts) {
      try {
        const r = await syncCalendarActivities(prisma, {
          organizationId: account.user.organizationId,
          excludeEmails: usersByOrg.get(account.user.organizationId) ?? [],
          createdBy: account.userId,
          fetchEvents: async () => {
            const raw = await listCalendarEvents(account.userId, timeMin, timeMax)
            return (raw as unknown as GoogleCalendarEvent[])
              .map(mapGoogleEvent)
              .filter((e): e is CalendarEventInput => e !== null)
          },
          now,
        })
        totalScanned += r.eventsScanned
        totalCreated += r.activitiesCreated
        totalSkipped += r.activitiesSkipped
        totalUnmatched += r.attendeesUnmatched
        totalErrors += r.errors
        perUserResults.push({ userId: account.userId, orgId: account.user.organizationId, result: r })
      } catch (e) {
        totalErrors++
        perUserResults.push({
          userId: account.userId,
          orgId: account.user.organizationId,
          result: null,
          error: e instanceof Error ? e.message : "unknown",
        })
      }
    }

    return NextResponse.json({
      success: true,
      totals: {
        eventsScanned: totalScanned,
        activitiesCreated: totalCreated,
        activitiesSkipped: totalSkipped,
        attendeesUnmatched: totalUnmatched,
        errors: totalErrors,
      },
      users: perUserResults,
    })
  } catch (e) {
    console.error("[cron/activity-capture-calendar]", e)
    return NextResponse.json({ error: "Sync failed" }, { status: 500 })
  }
  })
}
