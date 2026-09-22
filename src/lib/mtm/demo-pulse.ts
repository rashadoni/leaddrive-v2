import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { currentDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import {
  applyMtmWorkdayEvent,
  WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION,
  type MtmWorkdayAction,
} from "@/lib/mtm/workday"
import { advanceMtmAgentLatestLocation } from "@/lib/mtm/mobile-location-latest"
import {
  demoPulsePosition,
  MTM_DEMO_PULSE_FEATURE,
  planDemoPulseDay,
  type DemoPulseDay,
} from "@/lib/mtm/demo-pulse-plan"

/**
 * The demo pulse: an ordinary working day for demo agents, every day.
 *
 * Owner decision 2026-09-22 — the LeadDrive Inc. demo organization is shown to
 * prospects and had nothing after 9 August. Every tick (cron, every ten
 * minutes) creates whatever the clock has passed in the day planned by
 * demo-pulse-plan.ts: the route at 07:00, the shift start, each check-in and
 * check-out, a GPS point, the shift end. Everything is keyed so a repeated or
 * late tick creates nothing twice.
 *
 * Safety, in order:
 * - It runs only for organizations whose `features` include
 *   `mtm-demo-pulse`. No customer organization has it; it is set by hand.
 * - Inside such an organization it drives only agents with role AGENT that
 *   have not signed in to the mobile app for 30 days. A real phone — the
 *   owner's own test login — is never given a shift it did not start.
 * - An agent with a shift the pulse did not open is left alone for the day.
 * Written rows say what they are: audit rows carry metadataKind `demo_pulse`,
 * journal and GPS keys start with `demo-pulse:`.
 */

const DEMO_KEY = "demo-pulse"
const TICK_MINUTES = 10
const REAL_LOGIN_WINDOW_DAYS = 30
const GEOFENCE_RADIUS_METERS = 150

type PulseAgent = { id: string; name: string }
type PulseCustomer = { id: string; name: string; latitude: number; longitude: number }

export type DemoPulseAgentResult = {
  agentId: string
  routeCreated: boolean
  workday: "none" | "started" | "finished" | "skipped"
  checkIns: number
  checkOuts: number
  gpsPoint: boolean
}

export type DemoPulseSummary = {
  organizations: number
  agents: DemoPulseAgentResult[]
}

/** Deterministic jitter in metres, so a check-in is near the door, not on the pin. */
function jitter(seed: string, meters: number): { dLat: number; dLng: number } {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0
  const angle = ((hash >>> 0) % 360) * (Math.PI / 180)
  const distance = (((hash >>> 9) % 1000) / 1000) * meters
  return { dLat: (distance * Math.cos(angle)) / 111_320, dLng: (distance * Math.sin(angle)) / 111_320 }
}

function near(point: { latitude: number; longitude: number }, seed: string, meters = 30) {
  const { dLat, dLng } = jitter(seed, meters)
  return { latitude: point.latitude + dLat, longitude: point.longitude + dLng }
}

export function demoPulseRouteExternalId(agentId: string, dayKey: string): string {
  return `${DEMO_KEY}:${agentId}:${dayKey}`
}

export function demoPulseWorkdayId(agentId: string, dayKey: string): string {
  return `${DEMO_KEY}-${agentId}-${dayKey}`.slice(0, 100)
}

/** Demo agents the pulse may drive in one organization. */
export async function demoPulseAgents(organizationId: string, now: Date): Promise<PulseAgent[]> {
  const since = new Date(now.getTime() - REAL_LOGIN_WINDOW_DAYS * 86_400_000)
  const agents = await prisma.mtmAgent.findMany({
    where: { organizationId, status: "ACTIVE", role: "AGENT" },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  })
  if (agents.length === 0) return []
  const signedIn = await prisma.mtmAuditLog.findMany({
    where: {
      organizationId,
      agentId: { in: agents.map((agent: PulseAgent) => agent.id) },
      action: { in: ["MOBILE_LOGIN", "login"] },
      createdAt: { gte: since },
    },
    select: { agentId: true },
    distinct: ["agentId"],
  })
  const real = new Set(signedIn.map((row: { agentId: string | null }) => row.agentId))
  return agents.filter((agent: PulseAgent) => !real.has(agent.id))
}

/** The agent's own customers with coordinates: the ones they have visited before. */
async function agentCustomers(organizationId: string, agentId: string): Promise<PulseCustomer[]> {
  const visited = await prisma.mtmVisit.findMany({
    where: { organizationId, agentId, deletedAt: null },
    select: { customerId: true },
    distinct: ["customerId"],
    take: 60,
  })
  const ids = visited.map((row: { customerId: string }) => row.customerId)
  if (ids.length === 0) return []
  const customers = await prisma.mtmCustomer.findMany({
    where: { organizationId, id: { in: ids }, deletedAt: null, latitude: { not: null }, longitude: { not: null } },
    select: { id: true, name: true, latitude: true, longitude: true },
  })
  return customers as PulseCustomer[]
}

async function audit(
  organizationId: string,
  agentId: string,
  action: string,
  entity: string,
  entityId: string,
  newData: Record<string, unknown>,
) {
  await prisma.mtmAuditLog.create({
    data: {
      organizationId,
      agentId,
      action,
      entity,
      entityId,
      metadataKind: "demo_pulse",
      newData: newData as Prisma.InputJsonValue,
    },
  })
}

async function ensureRoute(organizationId: string, agent: PulseAgent, day: DemoPulseDay, now: Date) {
  const externalId = demoPulseRouteExternalId(agent.id, day.dayKey)
  const existing = await prisma.mtmRoute.findFirst({
    where: { organizationId, externalId },
    select: { id: true, status: true, startedAt: true },
  })
  if (existing) return { route: existing, created: false }
  const route = await prisma.mtmRoute.create({
    data: {
      organizationId,
      agentId: agent.id,
      date: new Date(`${day.dayKey}T00:00:00.000Z`),
      externalId,
      status: "PLANNED",
      publishedAt: day.routePublishAt,
      publishedVersion: 1,
      totalPoints: day.stops.length,
      points: {
        create: day.stops.map((stop) => ({
          organizationId,
          customerId: stop.customerId,
          orderIndex: stop.orderIndex,
          plannedTime: stop.plannedAt,
        })),
      },
    },
    select: { id: true, status: true, startedAt: true },
  })
  await audit(organizationId, agent.id, "ROUTE_PUBLISH", "route", route.id, { routeId: route.id, points: day.stops.length, at: now.toISOString() })
  return { route, created: true }
}

async function workdayTransition(
  organizationId: string,
  agent: PulseAgent,
  day: DemoPulseDay,
  action: Extract<MtmWorkdayAction, "START" | "FINISH">,
  now: Date,
  position: { latitude: number; longitude: number } | null,
) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => applyMtmWorkdayEvent(tx, { organizationId, agentId: agent.id }, {
    action,
    workdayId: demoPulseWorkdayId(agent.id, day.dayKey),
    clientEventId: `${DEMO_KEY}:${agent.id}:${day.dayKey}:${action.toLowerCase()}`,
    occurredAt: now,
    claimedAt: now,
    capturedAt: now,
    queuedAt: now,
    serverReceivedAt: now,
    schemaVersion: 2,
    attendanceReview: {
      state: "NOT_REQUIRED",
      reasonCode: null,
      policyVersion: WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION,
      claimAgeSeconds: 0,
    },
    workDateKey: day.dayKey,
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    accuracy: position ? 12 : null,
    note: null,
  }))
}

/** Advance one demo agent's day to `now`. */
export async function pulseDemoAgent(input: {
  organizationId: string
  agent: PulseAgent
  timezone: string
  now: Date
}): Promise<DemoPulseAgentResult> {
  const { organizationId, agent, timezone, now } = input
  const result: DemoPulseAgentResult = {
    agentId: agent.id, routeCreated: false, workday: "none", checkIns: 0, checkOuts: 0, gpsPoint: false,
  }
  const dayKey = currentDateKey(now, timezone)
  const customers = await agentCustomers(organizationId, agent.id)
  const day = planDemoPulseDay({
    agentId: agent.id,
    dayKey,
    localMidnight: localDateKeyToUtc(dayKey, timezone),
    customerIds: customers.map((customer) => customer.id),
  })
  if (!day || now < day.routePublishAt) return result
  const byId = new Map(customers.map((customer) => [customer.id, customer]))

  const { route, created } = await ensureRoute(organizationId, agent, day, now)
  result.routeCreated = created
  if (now < day.shiftStartAt) return result

  const workdayId = demoPulseWorkdayId(agent.id, day.dayKey)
  let workday = await prisma.mtmAgentWorkday.findFirst({
    where: { organizationId, agentId: agent.id, workDate: new Date(`${dayKey}T00:00:00.000Z`) },
    select: { id: true, status: true, startedAt: true },
  })
  if (workday && workday.id !== workdayId) {
    // Somebody else's shift on this agent today: the pulse steps aside.
    result.workday = "skipped"
    return result
  }
  if (!workday && now < day.shiftEndAt) {
    const first = byId.get(day.stops[0].customerId) ?? null
    const started = await workdayTransition(organizationId, agent, day, "START", now, first ? near(first, `${workdayId}:start`, 400) : null)
    if (started.status !== "ok") {
      result.workday = "skipped"
      return result
    }
    result.workday = "started"
    workday = { id: workdayId, status: "STARTED", startedAt: now }
  }
  if (!workday) return result

  // Visits: whatever the clock has passed since the shift began.
  const points = await prisma.mtmRoutePoint.findMany({
    where: { organizationId, routeId: route.id, deletedAt: null },
    select: { id: true, customerId: true, orderIndex: true, status: true },
    orderBy: { orderIndex: "asc" },
  })
  for (const stop of day.stops) {
    const point = points.find((candidate: { orderIndex: number }) => candidate.orderIndex === stop.orderIndex)
    const customer = byId.get(stop.customerId)
    if (!point || !customer || now < stop.checkInAt) continue
    // A stop the shift began after (the pulse was down) is not invented.
    if (stop.checkInAt < workday.startedAt) {
      if (point.status === "PENDING") {
        await prisma.mtmRoutePoint.updateMany({ where: { id: point.id, status: "PENDING" }, data: { status: "SKIPPED" } })
      }
      continue
    }
    let visit = await prisma.mtmVisit.findFirst({
      where: { organizationId, routePointId: point.id, deletedAt: null },
      select: { id: true, status: true },
    })
    if (!visit) {
      const at = near(customer, `${point.id}:in`)
      visit = await prisma.mtmVisit.create({
        data: {
          organizationId,
          agentId: agent.id,
          customerId: customer.id,
          routeId: route.id,
          routePointId: point.id,
          status: "CHECKED_IN",
          checkInAt: stop.checkInAt,
          checkInLat: at.latitude,
          checkInLng: at.longitude,
          checkInCustomerLat: customer.latitude,
          checkInCustomerLng: customer.longitude,
          checkInGeofenceRadius: GEOFENCE_RADIUS_METERS,
        },
        select: { id: true, status: true },
      })
      result.checkIns += 1
      await audit(organizationId, agent.id, "CHECK_IN", "visit", visit.id, { customerId: customer.id, customerName: customer.name, routeId: route.id, visitId: visit.id })
      if (route.status === "PLANNED") {
        await prisma.mtmRoute.updateMany({ where: { id: route.id, status: "PLANNED" }, data: { status: "IN_PROGRESS", startedAt: stop.checkInAt } })
        route.status = "IN_PROGRESS"
      }
    }
    if (visit.status === "CHECKED_IN" && now >= stop.checkOutAt) {
      const at = near(customer, `${point.id}:out`)
      const closed = await prisma.mtmVisit.updateMany({
        where: { id: visit.id, status: "CHECKED_IN" },
        data: {
          status: "CHECKED_OUT",
          checkOutAt: stop.checkOutAt,
          checkOutLat: at.latitude,
          checkOutLng: at.longitude,
          duration: stop.durationMinutes,
          outcome: stop.outcome,
        },
      })
      if (closed.count === 1) {
        result.checkOuts += 1
        await prisma.mtmRoutePoint.updateMany({ where: { id: point.id }, data: { status: "VISITED", visitedAt: stop.checkOutAt } })
        await audit(organizationId, agent.id, "CHECK_OUT", "visit", visit.id, { customerId: customer.id, customerName: customer.name, routeId: route.id, visitId: visit.id, duration: stop.durationMinutes })
      }
    }
  }
  const visitedPoints = await prisma.mtmRoutePoint.count({ where: { organizationId, routeId: route.id, status: "VISITED", deletedAt: null } })
  const allClosed = await prisma.mtmRoutePoint.count({ where: { organizationId, routeId: route.id, status: "PENDING", deletedAt: null } }) === 0
  await prisma.mtmRoute.updateMany({
    where: { id: route.id },
    data: allClosed && route.status !== "COMPLETED"
      ? { visitedPoints, status: "COMPLETED", completedAt: day.stops[day.stops.length - 1].checkOutAt }
      : { visitedPoints },
  })

  // The dot on the live map.
  const position = demoPulsePosition(day, new Map(customers.map((customer) => [customer.id, customer])), now)
  if (position && workday.status !== "COMPLETED") {
    const tick = Math.floor(now.getTime() / (TICK_MINUTES * 60_000))
    const at = near(position, `${agent.id}:${tick}`, position.isMoving ? 15 : 25)
    const clientLocationId = `${DEMO_KEY}:${agent.id}:${tick}`
    const exists = await prisma.mtmAgentLocation.findFirst({ where: { organizationId, agentId: agent.id, clientLocationId }, select: { id: true } })
    if (!exists) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const row = await tx.mtmAgentLocation.create({
          data: {
            organizationId,
            agentId: agent.id,
            workdayId,
            clientLocationId,
            latitude: at.latitude,
            longitude: at.longitude,
            accuracy: 12,
            isMoving: position.isMoving,
            recordedAt: now,
          },
          select: { id: true },
        })
        await advanceMtmAgentLatestLocation(tx, {
          organizationId, agentId: agent.id, sourceLocationId: row.id, payloadSha256: null,
          latitude: at.latitude, longitude: at.longitude, accuracy: 12, speed: null, heading: null,
          altitude: null, battery: null, isMoving: position.isMoving, recordedAt: now, receivedAt: now,
        })
        await tx.mtmAgent.updateMany({ where: { id: agent.id, organizationId }, data: { isOnline: true, lastSeenAt: now } })
      })
      result.gpsPoint = true
    }
  }

  if (workday.status !== "COMPLETED" && now >= day.shiftEndAt) {
    const last = byId.get(day.stops[day.stops.length - 1].customerId) ?? null
    const finished = await workdayTransition(organizationId, agent, day, "FINISH", now, last ? near(last, `${workdayId}:finish`, 400) : null)
    if (finished.status === "ok") {
      result.workday = "finished"
      await prisma.mtmAgent.updateMany({ where: { id: agent.id, organizationId }, data: { isOnline: false } })
    }
  }
  return result
}

export async function executeMtmDemoPulse(now: Date = new Date()): Promise<DemoPulseSummary> {
  const organizations = await prisma.organization.findMany({
    where: { features: { array_contains: [MTM_DEMO_PULSE_FEATURE] } },
    select: { id: true },
  })
  const agents: DemoPulseAgentResult[] = []
  for (const organization of organizations) {
    const settings = await getMtmSettings(organization.id)
    if (!isValidTimezone(settings.timezone)) continue
    for (const agent of await demoPulseAgents(organization.id, now)) {
      try {
        agents.push(await pulseDemoAgent({ organizationId: organization.id, agent, timezone: settings.timezone, now }))
      } catch (error) {
        // One agent's broken day must not stop the rest of the demo.
        console.error(`[MTM Cron] demo-pulse: agent ${agent.id} failed`, error)
      }
    }
  }
  return { organizations: organizations.length, agents }
}

export function runMtmDemoPulseJob(now?: Date) {
  return runWithRlsBypass(() =>
    withJobLease({ name: "mtm-demo-pulse", ttlMs: 5 * 60_000 }, () => executeMtmDemoPulse(now)),
  )
}
