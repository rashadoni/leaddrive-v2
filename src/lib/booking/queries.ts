import { z } from "zod"
import { Prisma } from "@prisma/client"
import { bookingDb as prisma } from "./db"
import { checkPermission, type Role } from "@/lib/permissions"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { isValidTimezone } from "@/lib/timezone"
import { bookingScope, bookingHostWhere, isBookingOperator, type BookingAccess } from "./access"

export const bookingFilters = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  status: z.enum(["all", "confirmed", "cancelled", "completed", "no_show"]).default("all"),
  host: z.string().max(64).optional(),
  page: z.string().max(64).optional(),
  search: z.string().trim().max(100).default(""),
  cursor: z.string().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine((input) => !input.from || !input.to || new Date(input.from) < new Date(input.to))

export type BookingFilters = z.infer<typeof bookingFilters>
const columns = {
  id: true, bookingPageId: true, hostUserId: true, startsAt: true, endsAt: true,
  name: true, phone: true, email: true, note: true, status: true, createdAt: true,
  cancelledAt: true, googleEventId: true, updatedAt: true, version: true, snapshot: true, outcomeNote: true, cancellationReason: true,
  bookingPage: { select: { title: true, locationType: true, locationText: true, slug: true } },
} satisfies Prisma.BookingSelect

export function queryWhere(access: BookingAccess, filters: BookingFilters): Prisma.BookingWhereInput {
  const conditions: Prisma.BookingWhereInput[] = [bookingScope(access)]
  if (filters.status !== "all") conditions.push({ status: filters.status })
  if (filters.host) conditions.push({ hostUserId: filters.host })
  if (filters.page) conditions.push({ bookingPageId: filters.page })
  if (filters.from || filters.to) conditions.push({
    startsAt: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lt: new Date(filters.to) } : {}) },
  })
  if (filters.search) {
    const contains = { contains: filters.search.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const }
    if (access.phoneRestricted && filters.search.replace(/\D/g, "").length >= 7) conditions.push({ id: "__hidden_phone_search__" })
    conditions.push({ OR: [{ name: contains }, { snapshot: { path: ["title"], string_contains: contains.contains, mode: "insensitive" } }, { bookingPage: { title: contains } }, ...(!access.phoneRestricted ? [{ phone: contains }, { email: contains }] : [])] })
  }
  if (filters.cursor) {
    const [instant, id, extra] = filters.cursor.split("~")
    if (!instant || !id || extra || Number.isNaN(Date.parse(instant))) throw new Error("INVALID_CURSOR")
    const startsAt = new Date(instant)
    conditions.push({ OR: [{ startsAt: { gt: startsAt } }, { startsAt, id: { gt: id } }] })
  }
  return { AND: conditions }
}

export async function bookingContext(access: BookingAccess) {
  const [org, hosts, pages] = await Promise.all([
    prisma.organization.findUnique({ where: { id: access.orgId }, select: { settings: true } }),
    prisma.user.findMany({ where: { organizationId: access.orgId, ...(access.hostIds === null ? {} : { id: { in: access.hostIds } }) }, select: { id: true, name: true, isActive: true, role: true, hiddenModules: true }, orderBy: { name: "asc" } }),
    prisma.bookingPage.findMany({ where: { organizationId: access.orgId, ...(access.hostIds === null ? {} : { hostIds: { hasSome: access.hostIds } }) }, select: { id: true, title: true, hostIds: true, isActive: true }, orderBy: { title: "asc" } }),
  ])
  const timezone = organizationTimezone(org?.settings)
  return { writableHostIds: access.writableHostIds, timezone: isValidTimezone(timezone) ? timezone : "Asia/Baku", hosts: hosts.map(({ role, hiddenModules, ...host }) => ({ ...host, canReceiveBookings: isBookingOperator(role) && (["admin", "superadmin"].includes(role) || !hiddenModules.includes("sales")) })), pages: pages.map((page) => ({ ...page, hostIds: page.hostIds.filter((id) => access.writableHostIds === null || access.writableHostIds.includes(id)) })), canConfigure: access.administrator, canCoordinate: access.hostIds === null || access.hostIds.length > 1, userId: access.userId }
}

export async function listBookings(access: BookingAccess, filters: BookingFilters) {
  const rows = await prisma.booking.findMany({ where: queryWhere(access, filters), select: columns, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: filters.limit + 1 })
  const hasMore = rows.length > filters.limit
  const visible = rows.slice(0, filters.limit)
  const hosts = await prisma.user.findMany({ where: { organizationId: access.orgId, id: { in: [...new Set(visible.map((row) => row.hostUserId))] } }, select: { id: true, name: true } })
  const last = visible.at(-1)
  return {
    items: visible.map(({ googleEventId, snapshot, ...row }) => ({ ...row, bookingPage: snapshotView(snapshot, row.bookingPage), legacyDetails: !snapshot, hostName: hosts.find((host) => host.id === row.hostUserId)?.name ?? null, calendarLinked: Boolean(googleEventId) })),
    nextCursor: hasMore && last ? `${last.startsAt.toISOString()}~${last.id}` : null,
  }
}

export async function bookingDetail(access: BookingAccess, id: string, role: Role) {
  const row = await prisma.booking.findFirst({ where: { AND: [bookingScope(access), { id }] }, select: { ...columns, leadId: true, taskId: true } })
  if (!row) return null
  const host = await prisma.user.findFirst({ where: { organizationId: access.orgId, id: row.hostUserId }, select: { name: true, isActive: true } })
  const { googleEventId, leadId, taskId, snapshot, ...safe } = row
  const config = await prisma.bookingPage.findFirst({ where: { id: row.bookingPageId, organizationId: access.orgId }, select: { hostIds: true } })
  const availableHosts = await prisma.user.findMany({ where: bookingHostWhere(access.orgId, (config?.hostIds ?? []).filter((id) => access.writableHostIds === null || access.writableHostIds.includes(id))), select: { id: true, name: true }, orderBy: { name: "asc" } })
  const [events, effects] = await Promise.all([
    bookingHistory(access, id),
    prisma.effectOutbox.groupBy({ by: ["effectType", "status", "lastError"], where: { organizationId: access.orgId, effectType: { startsWith: "booking." }, payload: { path: ["bookingId"], equals: id } }, _count: { _all: true } }),
  ])
  const canManage = access.writableHostIds === null || access.writableHostIds.includes(row.hostUserId)
  const canCorrect = access.administrator || Boolean(await prisma.bookingCoordinatorGrant.findFirst({ where: { organizationId: access.orgId, coordinatorUserId: access.userId, hostUserId: row.hostUserId, canManage: true } }))
  return { ...safe, phoneRestricted: access.phoneRestricted, canCreateFollowUp: canManage && checkPermission(role, "tasks", "write"), canManage, canCorrect, availableHosts, bookingPage: snapshotView(snapshot, row.bookingPage), legacyDetails: !snapshot, history: events.items, historyNextCursor: events.nextCursor, historyLimited: Boolean(events.nextCursor), integrations: effects.map((effect) => ({ type: effect.effectType, status: effect.status, requiresAttention: effect.lastError !== null, count: effect._count._all })), hostName: host?.name ?? null, hostActive: host?.isActive ?? false, calendarLinked: Boolean(googleEventId),
    leadId: checkPermission(role, "leads", "read") ? leadId : null,
    taskId: checkPermission(role, "tasks", "read") ? taskId : null,
  }
}


function snapshotView(snapshot: Prisma.JsonValue | null, fallback: { title: string; locationType: string; locationText: string | null; slug: string }) {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null
  return { ...fallback, title: typeof value?.title === "string" ? value.title : fallback.title, locationType: typeof value?.locationType === "string" ? value.locationType : fallback.locationType, locationText: typeof value?.locationText === "string" ? value.locationText : value?.locationText === null ? null : fallback.locationText, timezone: typeof value?.timezone === "string" ? value.timezone : null }
}


export async function bookingHistory(access: BookingAccess, id: string, before?: number) {
  const allowed = await prisma.booking.findFirst({ where: { AND: [bookingScope(access), { id }] }, select: { id: true } })
  if (!allowed) return { items: [], nextCursor: null }
  const events = await prisma.domainEvent.findMany({ where: { organizationId: access.orgId, aggregateType: "booking", aggregateId: id, ...(before ? { aggregateVersion: { lt: before } } : {}) }, select: { id: true, eventType: true, occurredAt: true, aggregateVersion: true, data: true }, orderBy: { aggregateVersion: "desc" }, take: 51 })
  const visible = events.slice(0, 50)
  const notes = await prisma.bookingChangeNote.findMany({ where: { organizationId: access.orgId, bookingId: id, eventId: { in: visible.map((event) => event.id) } }, select: { eventId: true, data: true } })
  const actorIds = visible.flatMap((event) => {
    const data = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data : null
    return typeof data?.actorUserId === "string" ? [data.actorUserId] : []
  })
  const actors = actorIds.length ? await prisma.user.findMany({ where: { organizationId: access.orgId, id: { in: actorIds } }, select: { id: true, name: true } }) : []
  return { items: visible.map((event) => {
    const actor = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data : null
    const note = notes.find((item) => item.eventId === event.id)?.data
    const text = note && typeof note === "object" && !Array.isArray(note) ? note : null
    return { id: event.id, type: event.eventType, when: event.occurredAt, version: Number(event.aggregateVersion), actorName: actors.find((person) => person.id === actor?.actorUserId)?.name || null, actorType: typeof actor?.actorType === "string" && ["employee", "customer", "import"].includes(actor.actorType) ? actor.actorType : "unknown", reason: typeof text?.reason === "string" ? text.reason : null, note: typeof text?.note === "string" ? text.note : null }
  }), nextCursor: events.length > 50 ? Number(visible.at(-1)!.aggregateVersion) : null }
}
