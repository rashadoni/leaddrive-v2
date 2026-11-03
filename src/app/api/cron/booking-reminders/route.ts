import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { requireCronAuth } from "@/lib/cron-auth"
import { REMINDER_WINDOWS, sendReminder, type ReminderKind } from "@/lib/booking/whatsapp-reminders"
import { readWhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"

/**
 * Reminders before a visit: the day before, and two hours before.
 *
 * Runs across all tenants, hence the bypass scope; every send then happens
 * inside the meeting's own organization. A booking is marked as reminded only
 * when the message actually went out, so a run that could not deliver (no
 * approved template outside Meta's 24-hour window, a provider hiccup) leaves
 * it for the next run instead of swallowing it silently.
 */
const BATCH_SIZE = 100

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied
  const now = new Date()
  const counted = { sent: 0, templateMissing: 0, failed: 0, skipped: 0 }

  const organizations = await runWithRlsBypass(() => prisma.organization.findMany({
    where: { settings: { path: ["bookingWhatsApp", "mode"], equals: "book" } },
    select: { id: true, settings: true },
  }))

  for (const organization of organizations) {
    const setting = readWhatsAppBookingSetting(organization.settings)
    if (setting.mode !== "book") continue
    for (const kind of ["day", "hour"] as ReminderKind[]) {
      const { leadMinutes, openMinutes } = REMINDER_WINDOWS[kind]
      // The window is «this far ahead, give or take», so a late run still
      // reminds rather than skipping the meeting entirely.
      const from = new Date(now.getTime() + (leadMinutes - openMinutes) * 60_000)
      const to = new Date(now.getTime() + leadMinutes * 60_000)
      const due = await runWithTenant(organization.id, () => prisma.booking.findMany({
        where: {
          organizationId: organization.id, status: "confirmed",
          startsAt: { gt: from, lte: to },
          ...(kind === "day" ? { remindedDayAt: null } : { remindedHourAt: null }),
          // A client who already said they are coming does not need the second
          // reminder; the day-before one has already done its work.
          ...(kind === "hour" ? { clientConfirmedAt: null } : {}),
        },
        orderBy: { startsAt: "asc" },
        take: BATCH_SIZE,
        select: { id: true, startsAt: true, phone: true, name: true, snapshot: true, bookingPageId: true },
      }))
      for (const booking of due) {
        if (!booking.phone) { counted.skipped += 1; continue }
        const outcome = await runWithTenant(organization.id, () => sendReminder({ organizationId: organization.id, booking, kind, now }))
        if (outcome === "sent") {
          counted.sent += 1
          await runWithTenant(organization.id, () => prisma.booking.updateMany({
            where: { id: booking.id, organizationId: organization.id },
            data: kind === "day" ? { remindedDayAt: now } : { remindedHourAt: now },
          }))
        } else if (outcome === "template_missing") {
          counted.templateMissing += 1
        } else {
          counted.failed += 1
        }
      }
    }
  }

  return NextResponse.json({ ok: true, ...counted })
}
