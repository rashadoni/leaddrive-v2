import type { MtmRouteTravelPlan, MtmRouteTravelPolicy } from "@/lib/mtm/route-travel"

/**
 * Mirrors the Prisma enum. INCOMPLETE is written only by the
 * mtm-route-day-close job: the day ended with the route neither finished
 * nor cancelled. It keeps its progress, so it is not an error state.
 */
export type MtmRouteStatus = "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "CANCELLED"

export interface MtmRouteAgent {
  id: string
  name: string
  role?: string
}

export interface MtmRouteCustomer {
  id: string
  name: string
  code?: string | null
  address?: string | null
  city?: string | null
  district?: string | null
  territoryCode?: string | null
  phone?: string | null
  contactPerson?: string | null
  latitude?: number | null
  longitude?: number | null
}

export interface MtmRouteAssignment {
  agentId: string
  role: "PRIMARY" | "PARTICIPANT" | "OBSERVER"
  agent?: MtmRouteAgent
}

export interface MtmRoutePoint {
  id: string
  customerId?: string
  contactId?: string | null
  orderIndex: number
  status: string
  customer?: MtmRouteCustomer
  contact?: {
    id: string
    displayName: string
    type?: string
    specialtyName?: string | null
    phone?: string | null
  } | null
  visitedAt?: string | null
  plannedTime?: string | null
  changeRequests?: Array<{
    id: string
    changeType: "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"
    status: string
  }>
}

export interface MtmRouteRecord {
  id: string
  version: number
  publishedVersion?: number | null
  agentId: string | null
  agent?: MtmRouteAgent | null
  assignments?: MtmRouteAssignment[]
  points?: MtmRoutePoint[]
  name?: string | null
  notes?: string | null
  date: string
  status: MtmRouteStatus
  totalPoints: number
  visitedPoints: number
  startedAt?: string | null
  completedAt?: string | null
  distanceKm?: number | null
  historicalAccessOnly?: boolean
  /** Present only on the already scoped route-detail response. */
  travelPlan?: MtmRouteTravelPlan
  /** Present only on the already scoped route-detail response. */
  travelPolicy?: MtmRouteTravelPolicy
  changeRequests?: Array<{
    id: string
    changeType: "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"
    status: string
    routePointId?: string | null
  }>
}
