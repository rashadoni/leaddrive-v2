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
 * Related CRM records and external deliveries are durable effect intents;
 * the meeting is visible independently of their completion.
 */
import { createHash } from "crypto"
import { hasModule, moduleRecordFromOrgFields } from "@/lib/modules"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { listBusyIntervals } from "@/lib/google-calendar"
import { BookingCommandError } from "./command-error"
import { bookingHostWhere } from "./access"
import { isValidTimezone } from "@/lib/timezone"
import type { AdAttribution } from "@/lib/ad-conversions/attribution"
import {
  computeSlots,
  defaultWeeklyHours,
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
    prisma.bookingPage.findUnique({ where: { slug }, select: { id: true, organizationId: true, isActive: true, organization: { select: { isActive: true, plan: true, addons: true, modules: true, features: true } } } }),
  )
  return row?.isActive && row.organization.isActive && hasModule({ plan: row.organization.plan, addons: Array.isArray(row.organization.addons) ? row.organization.addons.filter((value): value is string => typeof value === "string") : [], modules: moduleRecordFromOrgFields(row.organization) }, "sales") ? { orgId: row.organizationId, pageId: row.id } : null
}

export async function findBookingByToken(token: string): Promise<{ orgId: string; bookingId: string } | null> {
  if (!token || token.length > 100) return null
  const row = await runWithRlsBypass(() =>
    prisma.booking.findUnique({ where: { cancelTokenHash: hashBookingToken(token) }, select: { id: true, organizationId: true } }),
  )
  return row ? { orgId: row.organizationId, bookingId: row.id } : null
}

export async function orgContext(orgId: string): Promise<{ name: string; timezone: string }> {
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
export async function activeHosts(orgId: string, hostIds: string[]): Promise<{ id: string; name: string; email: string }[]> {
  if (hostIds.length === 0) return []
  const users = await prisma.user.findMany({
    where: bookingHostWhere(orgId, hostIds),
    select: { id: true, name: true, email: true },
  })
  type Host = { id: string; name: string; email: string }
  return hostIds
    .map((id) => (users as Host[]).find((user) => user.id === id))
    .filter((user): user is Host => Boolean(user))
}

/**
 * Busy time of each host: their confirmed bookings (from any page) and, when
 * connected, their Google Calendar. An unavailable connected calendar blocks
 * automatic reservations for that host until its availability can be checked.
 */
export async function loadBusyByHost(orgId: string, hostIds: string[], from: Date, to: Date): Promise<Map<string, BusyInterval[]> & { unavailableHostIds: Set<string> }> {
  const busy = Object.assign(new Map<string, BusyInterval[]>(hostIds.map((id) => [id, []])), { unavailableHostIds: new Set<string>() })
  const bookings = await prisma.booking.findMany({
    where: { organizationId: orgId, hostUserId: { in: hostIds }, status: "confirmed", endsAt: { gt: new Date(from.getTime() - 240 * 60_000) }, startsAt: { lt: new Date(to.getTime() + 240 * 60_000) } },
    select: { hostUserId: true, startsAt: true, endsAt: true, bufferBefore: true, bufferAfter: true },
  })
  for (const booking of bookings) busy.get(booking.hostUserId)?.push({ start: booking.startsAt, end: booking.endsAt, bufferBeforeMinutes: booking.bufferBefore, bufferAfterMinutes: booking.bufferAfter })
  await Promise.all(hostIds.map(async (hostId) => {
    try {
      const calendar = await listBusyIntervals(hostId, from.toISOString(), to.toISOString())
      if (calendar) busy.get(hostId)?.push(...calendar)
    } catch {
      busy.unavailableHostIds.add(hostId)
      busy.get(hostId)?.push({ start: from, end: to })
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
  if (!days.length && busy.unavailableHostIds.size) throw new BookingCommandError("CALENDAR_UNAVAILABLE", 503)
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
  locale?: "az" | "ru" | "en"
  idempotencyKey?: string
  recoverySecret?: string
  hostUserId?: string
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

/** All writers share the transactional command boundary. */
export async function createBooking(orgId: string, pageId: string, input: BookingInput, now = new Date()): Promise<CreateBookingResult> {
  const { createStoredBooking } = await import("./create")
  return createStoredBooking(orgId, pageId, input, now)
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
  const { cancelStoredBooking } = await import("./commands")
  return cancelStoredBooking(orgId, bookingId)
}
