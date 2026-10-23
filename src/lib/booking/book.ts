/**
 * Online booking on the server: the public page's data, a booking, a
 * cancellation.
 *
 * A booking is decided once, inside a transaction that holds a per-host
 * advisory lock: the slot is recomputed there from the host's confirmed
 * bookings, so two customers pressing «Book» on the same time get one meeting
 * and one «someone has just taken this time». The partial unique index
 * (host, start) WHERE confirmed is the last guard behind the lock.
 *
 * Everything after the commit — the lead, the host's task, the notice, the
 * Google Calendar event, the customer's e-mail — is best effort: the meeting
 * exists whether or not a side channel answered.
 */
import { createHash, randomBytes } from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { createNotification } from "@/lib/notifications"
import { sendEmail } from "@/lib/email"
import { createCalendarEvent, deleteCalendarEvent, listBusyIntervals } from "@/lib/google-calendar"
import { formatInTimezone, isValidTimezone } from "@/lib/timezone"
import type { AdAttribution } from "@/lib/ad-conversions/attribution"
import {
  computeSlots,
  defaultWeeklyHours,
  findSlot,
  parseWeeklyHours,
  type BookingRules,
  type BusyInterval,
  type DaySlots,
} from "./availability"

export const DEFAULT_BOOKING_TIMEZONE = "Asia/Baku"

type PageRow = NonNullable<Awaited<ReturnType<typeof prisma.bookingPage.findFirst>>>

export function hashBookingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")
}

export function bookingPageUrl(slug: string): string {
  return `${appBaseUrl()}/book/${encodeURIComponent(slug)}`
}

export function bookingCancelUrl(token: string): string {
  return `${appBaseUrl()}/book/cancel/${encodeURIComponent(token)}`
}

/** The organization and page behind a public link; inactive pages are not found. */
export async function findBookingPageBySlug(slug: string): Promise<{ orgId: string; pageId: string } | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null
  const row = await runWithRlsBypass(() =>
    prisma.bookingPage.findUnique({ where: { slug }, select: { id: true, organizationId: true, isActive: true } }),
  )
  return row?.isActive ? { orgId: row.organizationId, pageId: row.id } : null
}

export async function findBookingByToken(token: string): Promise<{ orgId: string; bookingId: string } | null> {
  if (!token || token.length > 100) return null
  const row = await runWithRlsBypass(() =>
    prisma.booking.findUnique({ where: { cancelTokenHash: hashBookingToken(token) }, select: { id: true, organizationId: true } }),
  )
  return row ? { orgId: row.organizationId, bookingId: row.id } : null
}

async function orgContext(orgId: string): Promise<{ name: string; timezone: string }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, settings: true } })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  const invoice = (settings.invoice ?? {}) as Record<string, unknown>
  const timezone = organizationTimezone(org?.settings)
  return {
    name: (typeof invoice.companyName === "string" && invoice.companyName.trim()) || org?.name || "",
    timezone: timezone && isValidTimezone(timezone) ? timezone : DEFAULT_BOOKING_TIMEZONE,
  }
}

function rulesOf(page: PageRow, timezone: string): BookingRules {
  return {
    timezone,
    durationMinutes: page.durationMinutes,
    bufferMinutes: page.bufferMinutes,
    minNoticeMinutes: page.minNoticeMinutes,
    maxDaysAhead: page.maxDaysAhead,
    weekly: parseWeeklyHours(page.weekly) ?? defaultWeeklyHours(),
  }
}

/** Hosts that are still active users of the organization, in the page's order. */
async function activeHosts(orgId: string, hostIds: string[]): Promise<{ id: string; name: string; email: string }[]> {
  if (hostIds.length === 0) return []
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, id: { in: hostIds }, isActive: true },
    select: { id: true, name: true, email: true },
  })
  type Host = { id: string; name: string; email: string }
  return hostIds
    .map((id) => (users as Host[]).find((user) => user.id === id))
    .filter((user): user is Host => Boolean(user))
}

/**
 * Busy time of each host: their confirmed bookings (from any page) and, when
 * connected, their Google Calendar. A calendar that fails to answer counts as
 * free — the CRM's own bookings still protect against double booking.
 */
export async function loadBusyByHost(orgId: string, hostIds: string[], from: Date, to: Date): Promise<Map<string, BusyInterval[]>> {
  const busy = new Map<string, BusyInterval[]>(hostIds.map((id) => [id, []]))
  const bookings = await prisma.booking.findMany({
    where: { organizationId: orgId, hostUserId: { in: hostIds }, status: "confirmed", endsAt: { gt: from }, startsAt: { lt: to } },
    select: { hostUserId: true, startsAt: true, endsAt: true },
  })
  for (const booking of bookings) busy.get(booking.hostUserId)?.push({ start: booking.startsAt, end: booking.endsAt })
  await Promise.all(hostIds.map(async (hostId) => {
    try {
      const calendar = await listBusyIntervals(hostId, from.toISOString(), to.toISOString())
      if (calendar) busy.get(hostId)?.push(...calendar)
    } catch (error) {
      console.warn("[booking] Google Calendar free/busy failed", { hostId, error: error instanceof Error ? error.message : error })
    }
  }))
  return busy
}

function windowOf(rules: BookingRules, now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + (rules.maxDaysAhead + 2) * 24 * 3600_000) }
}

/** What the public page shows. Runs under the page's tenant scope. */
export async function publicBookingView(orgId: string, pageId: string, now = new Date()) {
  const page = await prisma.bookingPage.findFirst({ where: { id: pageId, organizationId: orgId, isActive: true } })
  if (!page) return null
  const org = await orgContext(orgId)
  const rules = rulesOf(page, org.timezone)
  const hosts = await activeHosts(orgId, page.hostIds)
  const { from, to } = windowOf(rules, now)
  const busy = await loadBusyByHost(orgId, hosts.map((host) => host.id), from, to)
  const days: DaySlots[] = computeSlots({ rules, hostIds: hosts.map((host) => host.id), busyByHost: busy, now })
  return {
    page: {
      orgName: org.name,
      title: page.title,
      description: page.description,
      durationMinutes: page.durationMinutes,
      locationType: page.locationType as "office" | "phone" | "online",
      locationText: page.locationText,
      hostNames: hosts.map((host) => host.name),
      timezone: org.timezone,
    },
    // Which host is free is the server's business, not the customer's.
    days: days.map((day) => ({ date: day.date, slots: day.slots.map(({ startsAt, endsAt }) => ({ startsAt, endsAt, hostIds: [] })) })),
  }
}

export interface BookingInput {
  startsAt: string
  name: string
  phone: string
  email?: string | null
  note?: string | null
  /** Where the customer came from (src/lib/ad-conversions/attribution.ts). */
  attribution?: AdAttribution | null
}

export type CreateBookingResult =
  | { ok: true; booking: { id: string; startsAt: string; endsAt: string; hostName: string; cancelUrl: string } }
  | { ok: false; reason: "not_found" | "taken" }

class SlotTaken extends Error {}

/** Book a slot. Runs under the page's tenant scope. */
export async function createBooking(orgId: string, pageId: string, input: BookingInput, now = new Date()): Promise<CreateBookingResult> {
  const page = await prisma.bookingPage.findFirst({ where: { id: pageId, organizationId: orgId, isActive: true } })
  if (!page) return { ok: false, reason: "not_found" }
  const org = await orgContext(orgId)
  const rules = rulesOf(page, org.timezone)
  const hosts = await activeHosts(orgId, page.hostIds)
  const hostIds = hosts.map((host) => host.id)
  const { from, to } = windowOf(rules, now)

  // Outside the lock: is this a slot the page offers at all, and who is free
  // for it by their calendars? The CRM's own bookings are checked again below.
  const busy = await loadBusyByHost(orgId, hostIds, from, to)
  const slot = findSlot(computeSlots({ rules, hostIds, busyByHost: busy, now }), input.startsAt)
  if (!slot) return { ok: false, reason: "taken" }

  // Fewest upcoming meetings first; the page's order breaks ties.
  const load = await prisma.booking.groupBy({
    by: ["hostUserId"],
    where: { organizationId: orgId, hostUserId: { in: slot.hostIds }, status: "confirmed", startsAt: { gte: now } },
    _count: { _all: true },
  })
  const count = (hostId: string) => load.find((row: { hostUserId: string }) => row.hostUserId === hostId)?._count._all ?? 0
  const candidates = [...slot.hostIds].sort((a, b) => count(a) - count(b) || hostIds.indexOf(a) - hostIds.indexOf(b))

  const token = randomBytes(24).toString("base64url")
  const startsAt = new Date(slot.startsAt)
  const endsAt = new Date(slot.endsAt)
  const buffer = page.bufferMinutes * 60_000

  for (const hostUserId of candidates) {
    try {
      const booking = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${orgId}:${hostUserId}`}))`
        const clash = await tx.booking.findFirst({
          where: {
            organizationId: orgId,
            hostUserId,
            status: "confirmed",
            startsAt: { lt: new Date(endsAt.getTime() + buffer) },
            endsAt: { gt: new Date(startsAt.getTime() - buffer) },
          },
          select: { id: true },
        })
        if (clash) throw new SlotTaken()
        return tx.booking.create({
          data: {
            organizationId: orgId,
            bookingPageId: page.id,
            hostUserId,
            startsAt,
            endsAt,
            name: input.name,
            phone: input.phone,
            email: input.email || null,
            note: input.note || null,
            cancelTokenHash: hashBookingToken(token),
          },
        })
      })
      const host = hosts.find((item) => item.id === hostUserId)!
      await afterBooking(orgId, page, booking.id, host, input, startsAt, endsAt, org, token)
      return {
        ok: true,
        booking: {
          id: booking.id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          hostName: host.name,
          cancelUrl: bookingCancelUrl(token),
        },
      }
    } catch (error) {
      const unique = (error as { code?: string })?.code === "P2002"
      if (error instanceof SlotTaken || unique) continue
      throw error
    }
  }
  return { ok: false, reason: "taken" }
}

async function afterBooking(
  orgId: string,
  page: PageRow,
  bookingId: string,
  host: { id: string; name: string; email: string },
  input: BookingInput,
  startsAt: Date,
  endsAt: Date,
  org: { name: string; timezone: string },
  token: string,
): Promise<void> {
  const when = `${formatInTimezone(startsAt, org.timezone, { day: "2-digit", month: "2-digit", year: "numeric" }, "ru-RU")} ${formatInTimezone(startsAt, org.timezone, { hour: "2-digit", minute: "2-digit", hour12: false }, "ru-RU")}`
  const details = [
    `${input.name} · ${input.phone}${input.email ? ` · ${input.email}` : ""}`,
    input.note ? `\n${input.note}` : "",
  ].join("")
  const links: { leadId?: string; taskId?: string; googleEventId?: string } = {}

  try {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        contactName: input.name,
        email: input.email || null,
        phone: input.phone,
        source: `booking:${page.slug}`,
        sourceDetail: page.title,
        status: "new",
        assignedTo: host.id,
        notes: input.note || null,
        adAttribution: input.attribution ? (input.attribution as Prisma.InputJsonValue) : undefined,
      },
    })
    links.leadId = lead.id
  } catch (error) {
    console.error("[booking] lead create failed", { bookingId, error })
  }

  try {
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        title: `${page.title} — ${input.name}`,
        description: details,
        dueDate: startsAt,
        assignedTo: host.id,
        priority: "high",
        ...(links.leadId ? { relatedType: "lead", relatedId: links.leadId } : {}),
      },
    })
    links.taskId = task.id
  } catch (error) {
    console.error("[booking] task create failed", { bookingId, error })
  }

  try {
    const event = await createCalendarEvent(host.id, {
      summary: `${page.title} — ${input.name}`,
      description: details,
      startTime: startsAt.toISOString(),
      endTime: endsAt.toISOString(),
      attendees: input.email ? [input.email] : undefined,
    })
    if (event?.id) links.googleEventId = event.id
  } catch {
    // No calendar connected, or it refused: the CRM task carries the meeting.
  }

  if (Object.keys(links).length > 0) {
    await prisma.booking.updateMany({ where: { id: bookingId, organizationId: orgId }, data: links }).catch((error: unknown) =>
      console.error("[booking] link update failed", { bookingId, error }))
  }

  await createNotification({
    organizationId: orgId,
    userId: host.id,
    type: "info",
    title: `${page.title}: ${when}`,
    message: details,
    entityType: links.taskId ? "task" : "lead",
    entityId: links.taskId ?? links.leadId,
    kind: "booking.created",
    push: true,
    email: true,
  }).catch((error: unknown) => console.error("[booking] host notice failed", { bookingId, error }))

  if (input.email) {
    const cancelUrl = bookingCancelUrl(token)
    await sendEmail({
      to: input.email,
      subject: `${page.title} — ${when}`,
      html: `<p>${escapeHtml(input.name)},</p><p><strong>${escapeHtml(page.title)}</strong><br>${escapeHtml(when)} (${escapeHtml(org.timezone)})<br>${escapeHtml(host.name)} · ${escapeHtml(org.name)}</p>${page.locationText ? `<p>${escapeHtml(page.locationText)}</p>` : ""}<p><a href="${escapeHtml(cancelUrl)}">${escapeHtml(cancelUrl)}</a></p>`,
      organizationId: orgId,
      transactional: true,
    }).catch((error: unknown) => console.error("[booking] confirmation e-mail failed", { bookingId, error }))
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** What the cancel page shows. Runs under the booking's tenant scope. */
export async function bookingCancelView(orgId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: orgId },
    include: { bookingPage: { select: { title: true, slug: true, locationType: true, locationText: true, durationMinutes: true, description: true } } },
  })
  if (!booking) return null
  const org = await orgContext(orgId)
  const host = await prisma.user.findFirst({ where: { id: booking.hostUserId, organizationId: orgId }, select: { name: true } })
  return {
    status: booking.status as "confirmed" | "cancelled",
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    hostName: host?.name ?? "",
    past: booking.startsAt.getTime() <= Date.now(),
    bookAgainUrl: bookingPageUrl(booking.bookingPage.slug),
    page: {
      orgName: org.name,
      title: booking.bookingPage.title,
      description: booking.bookingPage.description,
      durationMinutes: booking.bookingPage.durationMinutes,
      locationType: booking.bookingPage.locationType as "office" | "phone" | "online",
      locationText: booking.bookingPage.locationText,
      hostNames: host ? [host.name] : [],
      timezone: org.timezone,
    },
  }
}

/** Cancel by the customer's link. Idempotent; a past meeting is not cancelled. */
export async function cancelBooking(orgId: string, bookingId: string): Promise<"cancelled" | "already" | "past" | "not_found"> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: orgId },
    include: { bookingPage: { select: { title: true } } },
  })
  if (!booking) return "not_found"
  if (booking.status === "cancelled") return "already"
  if (booking.startsAt.getTime() <= Date.now()) return "past"
  const changed = await prisma.booking.updateMany({
    where: { id: bookingId, organizationId: orgId, status: "confirmed" },
    data: { status: "cancelled", cancelledAt: new Date() },
  })
  if (changed.count !== 1) return "already"

  if (booking.taskId) {
    await prisma.task.updateMany({ where: { id: booking.taskId, organizationId: orgId }, data: { status: "cancelled" } })
      .catch((error: unknown) => console.error("[booking] task cancel failed", { bookingId, error }))
  }
  if (booking.googleEventId) {
    await deleteCalendarEvent(booking.hostUserId, booking.googleEventId)
      .catch((error: unknown) => console.warn("[booking] calendar delete failed", { bookingId, error }))
  }
  const org = await orgContext(orgId)
  const when = formatInTimezone(booking.startsAt, org.timezone, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }, "ru-RU")
  await createNotification({
    organizationId: orgId,
    userId: booking.hostUserId,
    type: "warning",
    title: `${booking.bookingPage.title}: ${when} ✕`,
    message: `${booking.name} · ${booking.phone}`,
    entityType: booking.taskId ? "task" : undefined,
    entityId: booking.taskId ?? undefined,
    kind: "booking.cancelled",
    push: true,
  }).catch((error: unknown) => console.error("[booking] cancel notice failed", { bookingId, error }))
  return "cancelled"
}
