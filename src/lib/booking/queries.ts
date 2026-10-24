import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { isValidTimezone } from "@/lib/timezone"
import { bookingScope, type BookingAccess } from "./access"

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
  cancelledAt: true, googleEventId: true, updatedAt: true,
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
    const contains = { contains: filters.search, mode: "insensitive" as const }
    conditions.push({ OR: [{ name: contains }, { bookingPage: { title: contains } }, ...(!access.phoneRestricted ? [{ phone: contains }, { email: contains }] : [])] })
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
    prisma.user.findMany({ where: { organizationId: access.orgId, ...(access.hostIds === null ? {} : { id: { in: access.hostIds } }) }, select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    prisma.bookingPage.findMany({ where: { organizationId: access.orgId, ...(access.hostIds === null ? {} : { hostIds: { hasSome: access.hostIds } }) }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ])
  const timezone = organizationTimezone(org?.settings)
  return { timezone: isValidTimezone(timezone) ? timezone : "Asia/Baku", hosts, pages, canConfigure: access.administrator, canCoordinate: access.hostIds === null || access.hostIds.length > 1, userId: access.userId }
}

export async function listBookings(access: BookingAccess, filters: BookingFilters) {
  const rows = await prisma.booking.findMany({ where: queryWhere(access, filters), select: columns, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: filters.limit + 1 })
  const hasMore = rows.length > filters.limit
  const visible = rows.slice(0, filters.limit)
  const hosts = await prisma.user.findMany({ where: { organizationId: access.orgId, id: { in: [...new Set(visible.map((row) => row.hostUserId))] } }, select: { id: true, name: true } })
  const last = visible.at(-1)
  return {
    items: visible.map(({ googleEventId, ...row }) => ({ ...row, hostName: hosts.find((host) => host.id === row.hostUserId)?.name ?? null, calendarLinked: Boolean(googleEventId) })),
    nextCursor: hasMore && last ? `${last.startsAt.toISOString()}~${last.id}` : null,
  }
}

export async function bookingDetail(access: BookingAccess, id: string, role: Role) {
  const row = await prisma.booking.findFirst({ where: { AND: [bookingScope(access), { id }] }, select: { ...columns, leadId: true, taskId: true } })
  if (!row) return null
  const host = await prisma.user.findFirst({ where: { organizationId: access.orgId, id: row.hostUserId }, select: { name: true, isActive: true } })
  const { googleEventId, leadId, taskId, ...safe } = row
  return { ...safe, hostName: host?.name ?? null, hostActive: host?.isActive ?? false, calendarLinked: Boolean(googleEventId),
    leadId: checkPermission(role, "leads", "read") ? leadId : null,
    taskId: checkPermission(role, "tasks", "read") ? taskId : null,
  }
}
