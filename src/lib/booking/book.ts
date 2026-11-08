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
import { bookingDb as prisma } from "./db"
import { runWithRlsBypass } from "@/lib/rls-context"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { connectedCalendars } from "@/lib/calendar/accounts"
import { calendarBusy } from "@/lib/calendar/events"
import { connectedCalendarKey } from "@/lib/calendar/providers"
import { BookingCommandError } from "./command-error"
import { addOnTotals, parseAddOns, selectedAddOns } from "./add-ons"
import { closedDateSet, readClosedDates } from "./closed-dates"
import { isGroupService, seatsByStart, seatsLeft, serviceCapacity } from "./group-service"
import { asksDeposit, depositDue, depositPolicy } from "./deposit"
import { depositCheckoutView } from "./deposit-checkout"
import { hasHostVariants, hostService, servicePriceSpan } from "./host-variants"
import { bookingHostWhere } from "./access"
import { isValidTimezone } from "@/lib/timezone"
import type { AdAttribution } from "@/lib/ad-conversions/attribution"
import {
  computeSlots,
  defaultWeeklyHours,
  offHoursIntervals,
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
export async function findBookingPageBySlug(slug: string, includeInactive = false): Promise<{ orgId: string; pageId: string } | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null
  const row = await runWithRlsBypass(() =>
    prisma.bookingPage.findUnique({ where: { slug }, select: { id: true, organizationId: true, isActive: true, organization: { select: { isActive: true, plan: true, addons: true, modules: true, features: true } } } }),
  )
  return row && (row.isActive || includeInactive) && row.organization.isActive && hasModule({ plan: row.organization.plan, addons: Array.isArray(row.organization.addons) ? row.organization.addons.filter((value): value is string => typeof value === "string") : [], modules: moduleRecordFromOrgFields(row.organization) }, "sales") ? { orgId: row.organizationId, pageId: row.id } : null
}

export async function findBookingByToken(token: string): Promise<{ orgId: string; bookingId: string } | null> {
  if (!token || token.length > 100) return null
  const row = await runWithRlsBypass(() =>
    prisma.booking.findUnique({ where: { cancelTokenHash: hashBookingToken(token) }, select: { id: true, organizationId: true } }),
  )
  return row ? { orgId: row.organizationId, bookingId: row.id } : null
}

export async function orgContext(orgId: string): Promise<{ name: string; timezone: string; closedDates: string[] }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, settings: true } })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  const invoice = (settings.invoice ?? {}) as Record<string, unknown>
  const timezone = organizationTimezone(org?.settings)
  return {
    name: (typeof invoice.companyName === "string" && invoice.companyName.trim()) || org?.name || "",
    timezone: timezone && isValidTimezone(timezone) ? timezone : DEFAULT_BOOKING_TIMEZONE,
    // The days the salon does not work. They belong to the organization, so
    // they travel with its name and its clock rather than with each service.
    closedDates: [...closedDateSet(readClosedDates(org?.settings))],
  }
}

function rulesOf(page: PageRow, timezone: string, closedDates: readonly string[] = []): BookingRules {
  return {
    timezone,
    closedDates,
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
/**
 * Everything that makes a host unavailable in the window: their confirmed
 * meetings, their connected calendar, and the hours their own schedule says
 * they do not work. The timezone is required because that last one is read on
 * the organization's clock — and because every caller of this function also
 * decides whether a slot may be booked, so none of them may quietly skip it.
 */
export interface BusyOptions {
  /**
   * Count the times the WhatsApp agent is holding for a client as busy. The
   * customer-facing paths pass this — the public page, a public or WhatsApp
   * booking — so two conversations are never offered the same chair. Staff
   * screens do not: the salon's own decision wins over a pending offer, and
   * the client who tapped late simply gets new times.
   */
  holds?: { exceptConversationId?: string | null }
  /**
   * A class does not make its own master busy for itself: the seats of one
   * class share the hour by design. Their master stays busy for every other
   * service, and the class's own seats are counted instead.
   */
  exceptBookingPageId?: string
}

export async function loadBusyByHost(orgId: string, hostIds: string[], from: Date, to: Date, timezone: string, options: BusyOptions = {}): Promise<Map<string, BusyInterval[]> & { unavailableHostIds: Set<string>; calendarKeys: Map<string, string> }> {
  const accounts = await connectedCalendars(prisma, hostIds)
  // Which calendars each host had connected when this was read; the write
  // refuses if that set changed meanwhile (see connectedCalendarKey).
  const calendarKeys = new Map(hostIds.map((id) => [id, connectedCalendarKey(accounts.get(id) ?? [])]))
  const busy = Object.assign(new Map<string, BusyInterval[]>(hostIds.map((id) => [id, []])), { unavailableHostIds: new Set<string>(), calendarKeys })
  const bookings = await prisma.booking.findMany({
    where: {
      organizationId: orgId, hostUserId: { in: hostIds }, status: "confirmed",
      endsAt: { gt: new Date(from.getTime() - 240 * 60_000) }, startsAt: { lt: new Date(to.getTime() + 240 * 60_000) },
      ...(options.exceptBookingPageId ? { bookingPageId: { not: options.exceptBookingPageId } } : {}),
    },
    select: { hostUserId: true, startsAt: true, endsAt: true, bufferBefore: true, bufferAfter: true },
  })
  for (const booking of bookings) busy.get(booking.hostUserId)?.push({ start: booking.startsAt, end: booking.endsAt, bufferBeforeMinutes: booking.bufferBefore, bufferAfterMinutes: booking.bufferAfter })
  if (options.holds) {
    // A client's own offers never stand in their way: re-asking, or tapping
    // one of them, sees those times as free.
    const holds = await prisma.bookingOffer.findMany({
      where: {
        organizationId: orgId, hostUserId: { in: hostIds },
        // A time waiting for the salon's confirmation is held just as firmly
        // as one still on the client's buttons — otherwise «we are holding it
        // for you» is a promise the next booking breaks.
        status: { in: ["offered", "pending"] }, expiresAt: { gt: new Date() },
        endsAt: { gt: new Date(from.getTime() - 240 * 60_000) }, startsAt: { lt: new Date(to.getTime() + 240 * 60_000) },
        ...(options.holds.exceptConversationId ? { conversationId: { not: options.holds.exceptConversationId } } : {}),
      },
      select: { hostUserId: true, startsAt: true, endsAt: true, bufferMinutes: true },
    })
    for (const hold of holds) busy.get(hold.hostUserId)?.push({ start: hold.startsAt, end: hold.endsAt, bufferBeforeMinutes: hold.bufferMinutes, bufferAfterMinutes: hold.bufferMinutes })
  }
  // Every calendar the host connected blocks the same chair: a master with
  // their own Google account and the company's Outlook is busy in both.
  await Promise.all(hostIds.map(async (hostId) => {
    const connected = accounts.get(hostId) ?? []
    try {
      for (const account of connected) {
        busy.get(hostId)?.push(...await calendarBusy(account, new Date(from.getTime() - 240 * 60_000), new Date(to.getTime() + 240 * 60_000)))
      }
    } catch {
      // One unreadable calendar takes the host out of the day entirely: a
      // calendar nobody could read must not be offered as free time.
      busy.unavailableHostIds.add(hostId)
      busy.get(hostId)?.push({ start: from, end: to })
    }
  }))
  // A host with no schedule of their own keeps the page's hours: no row, no
  // intervals, and the day comes out exactly as it did before schedules
  // existed.
  const schedules = await prisma.bookingHostSchedule.findMany({ where: { organizationId: orgId, userId: { in: hostIds } }, select: { userId: true, weekly: true } })
  for (const schedule of schedules) {
    const weekly = parseWeeklyHours(schedule.weekly)
    if (!weekly) continue
    busy.get(schedule.userId)?.push(...offHoursIntervals(weekly, timezone, from, to))
  }
  return busy
}

function windowOf(rules: BookingRules, now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + (rules.maxDaysAhead + 2) * 24 * 3600_000) }
}

/** What the public page shows. Runs under the page's tenant scope. */
/**
 * The public page and its free times.
 *
 * `hostId` is the master the customer picked. It only ever narrows what is
 * offered — to that master's own hours, their own duration and their own
 * price. A service where every master charges the same never asks: who is free
 * stays the server's business, as it always was.
 */
export async function publicBookingView(orgId: string, pageId: string, now = new Date(), hostId?: string | null, addOnIds: readonly string[] = []) {
  const page = await prisma.bookingPage.findFirst({ where: { id: pageId, organizationId: orgId, isActive: true } })
  if (!page) return null
  const org = await orgContext(orgId)
  const hosts = await activeHosts(orgId, page.hostIds)
  const service = { price: page.price === null ? null : String(page.price), durationMinutes: page.durationMinutes, hostVariants: page.hostVariants }
  const chosen = hostId && hosts.some((host) => host.id === hostId) ? hostId : null
  const offered = chosen ? hosts.filter((host) => host.id === chosen) : hosts
  const chosenService = chosen ? hostService(service, chosen) : null
  // The extras take time as well as money: the slot is cut for the whole
  // visit, or the master is double-booked for the half nobody counted.
  const addOns = parseAddOns(page.addOns)
  const takenAddOns = selectedAddOns(addOns, addOnIds)
  const visit = addOnTotals(chosenService ?? { price: page.price === null ? null : String(page.price), durationMinutes: page.durationMinutes }, takenAddOns)
  const rules = { ...rulesOf(page, org.timezone, org.closedDates), durationMinutes: visit.durationMinutes }
  const { from, to } = windowOf(rules, now)
  const group = isGroupService(page)
  const busy = await loadBusyByHost(orgId, offered.map((host) => host.id), from, to, org.timezone,
    { holds: {}, ...(group ? { exceptBookingPageId: page.id } : {}) })
  const days: DaySlots[] = computeSlots({ rules, hostIds: offered.map((host) => host.id), busyByHost: busy, now })
  if (!days.length && busy.unavailableHostIds.size) throw new BookingCommandError("CALENDAR_UNAVAILABLE", 503)
  // A class is offered until its seats run out; a full one is simply not a
  // free time, exactly like a taken chair.
  const taken = group
    ? seatsByStart(await prisma.booking.findMany({
      where: { organizationId: orgId, bookingPageId: page.id, status: "confirmed", startsAt: { gte: from, lt: to } },
      select: { startsAt: true },
    }))
    : new Map<string, number>()
  const span = servicePriceSpan(service, hosts.map((host) => host.id))
  return {
    page: {
      orgName: org.name,
      title: page.title,
      description: page.description,
      photoUrl: page.photoUrl,
      durationMinutes: visit.durationMinutes,
      locationType: page.locationType as "office" | "phone" | "online",
      locationText: page.locationText,
      price: chosenService || takenAddOns.length > 0 ? visit.price : span.varies ? null : (page.price === null ? null : String(page.price)),
      priceCurrency: page.priceCurrency,
      /** Set only when masters differ and none is chosen yet: «from 25». */
      priceFrom: !chosen && span.varies ? span.min : null,
      hostNames: hosts.map((host) => host.name),
      /** More than one means a class: the time holds this many people. */
      capacity: serviceCapacity(page),
      /** What must be left to hold the time, and how late it may be cancelled. */
      deposit: asksDeposit(depositPolicy(page)) ? depositDue(depositPolicy(page), visit.price) : null,
      depositFreeHours: depositPolicy(page).freeHours,
      /** Offered only where the answer changes the price or the duration. */
      hosts: hasHostVariants(service, hosts.map((host) => host.id))
        ? hosts.map((host) => ({ id: host.id, name: host.name, ...hostService(service, host.id) }))
        : [],
      chosenHostId: chosen,
      /** What the service offers to add, and what the customer has ticked. */
      addOns,
      chosenAddOnIds: takenAddOns.map((addOn) => addOn.id),
      timezone: org.timezone,
    },
    // Which host is free is the server's business, not the customer's — unless
    // the customer named one, and then it is only that one.
    days: days
      .map((day) => ({
        date: day.date,
        slots: day.slots
          .map(({ startsAt, endsAt }) => ({ startsAt, endsAt, hostIds: [], ...(group ? { seatsLeft: seatsLeft(page, taken.get(startsAt) ?? 0) } : {}) }))
          .filter((slot) => !group || (slot as { seatsLeft: number }).seatsLeft > 0),
      }))
      .filter((day) => day.slots.length > 0),
  }
}

export interface BookingInput {
  locale?: "az" | "ru" | "en"
  idempotencyKey?: string
  recoverySecret?: string
  hostUserId?: string
  /** Extras the customer ticked; unknown ids are ignored, never charged. */
  addOnIds?: string[]
  startsAt: string
  name: string
  phone: string
  email?: string | null
  note?: string | null
  /** Where the customer came from (src/lib/ad-conversions/attribution.ts). */
  attribution?: AdAttribution | null
  /**
   * Set only by the WhatsApp agent, never from a request body: the booking is
   * recorded as coming from WhatsApp, and this conversation's own holds do
   * not block it. Ignored on a staff booking.
   */
  whatsapp?: { conversationId: string }
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
    include: { bookingPage: { select: { title: true, slug: true, locationType: true, locationText: true, durationMinutes: true, description: true, price: true, priceCurrency: true } } },
  })
  if (!booking) return null
  const org = await orgContext(orgId)
  const saved = booking.snapshot && typeof booking.snapshot === "object" && !Array.isArray(booking.snapshot) ? booking.snapshot : null
  const host = await prisma.user.findFirst({ where: { id: booking.hostUserId, organizationId: orgId }, select: { name: true } })
  return {
    // What the visit still owes, and whether a card would be taken for it now.
    // Null where no deposit was ever asked, which is most meetings.
    deposit: await depositCheckoutView(orgId, booking),
    status: booking.status as "confirmed" | "cancelled" | "completed" | "no_show",
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    hostName: host?.name ?? "",
    past: booking.startsAt.getTime() <= Date.now(),
    bookAgainUrl: bookingPageUrl(booking.bookingPage.slug),
    page: {
      orgName: typeof saved?.orgName === "string" ? saved.orgName : org.name,
      title: typeof saved?.title === "string" ? saved.title : booking.bookingPage.title,
      description: typeof saved?.description === "string" ? saved.description : saved?.description === null ? null : booking.bookingPage.description,
      durationMinutes: Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60000),
      locationType: (typeof saved?.locationType === "string" ? saved.locationType : booking.bookingPage.locationType) as "office" | "phone" | "online",
      locationText: typeof saved?.locationText === "string" ? saved.locationText : saved?.locationText === null ? null : booking.bookingPage.locationText,
      price: typeof saved?.price === "string" ? saved.price : booking.bookingPage.price === null ? null : String(booking.bookingPage.price),
      priceCurrency: typeof saved?.priceCurrency === "string" ? saved.priceCurrency : booking.bookingPage.priceCurrency,
      hostNames: host ? [host.name] : [],
      timezone: typeof saved?.timezone === "string" && isValidTimezone(saved.timezone) ? saved.timezone : org.timezone,
    },
  }
}

/** Cancel by the customer's link. Idempotent; a past meeting is not cancelled. */
export async function cancelBooking(orgId: string, bookingId: string): Promise<"cancelled" | "already" | "past" | "not_found"> {
  const { cancelStoredBooking } = await import("./commands")
  return cancelStoredBooking(orgId, bookingId)
}
