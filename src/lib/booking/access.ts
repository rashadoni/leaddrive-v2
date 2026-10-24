import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { AuthResult } from "@/lib/api-auth"
import type { Prisma } from "@prisma/client"

export const BOOKING_ROLES = ["admin", "superadmin", "manager", "sales", "support", "ticketing"] as const

export function isBookingOperator(role: string, principalType = "session"): boolean {
  return principalType === "session" && BOOKING_ROLES.some((allowed) => allowed === role)
}

export interface BookingAccess {
  orgId: string
  userId: string
  administrator: boolean
  hostIds: string[] | null
  writableHostIds: string[] | null
  phoneRestricted: boolean
}

/** RLS is the tenant boundary; this additional predicate is the own/team boundary. */
export function bookingScope(access: BookingAccess, write = false): Prisma.BookingWhereInput {
  const hosts = write ? access.writableHostIds : access.hostIds
  return { organizationId: access.orgId, ...(hosts === null ? {} : { hostUserId: { in: hosts } }) }
}

export async function bookingAccess(auth: AuthResult): Promise<BookingAccess | NextResponse> {
  if (!auth.userId || !isBookingOperator(auth.role, auth.principalType ?? "")) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 })
  }
  const administrator = auth.role === "admin" || auth.role === "superadmin"
  const grants = administrator ? [] : await prisma.bookingCoordinatorGrant.findMany({
    where: { organizationId: auth.orgId, coordinatorUserId: auth.userId },
    select: { hostUserId: true, canManage: true },
  })
  return {
    orgId: auth.orgId,
    userId: auth.userId,
    administrator,
    hostIds: administrator ? null : [...new Set([auth.userId, ...grants.map((row) => row.hostUserId)])],
    writableHostIds: administrator ? null : [...new Set([auth.userId, ...grants.filter((row) => row.canManage).map((row) => row.hostUserId)])],
    phoneRestricted: !administrator && auth.hideCustomerPhoneForOperators === true,
  }
}
