import type { Prisma } from "@prisma/client"
import { activeFieldAssignmentWindow } from "@/lib/mtm/field-scope"
import { validateMtmMobileRouteTargetEligibility } from "@/lib/mtm/route-targets"

/**
 * A doctor who works in two clinics: the agent decides on the spot where he
 * is (owner, 2026-11-13: «чтоб агент сам уже принимал решение где находится
 * врач»).
 *
 * The route stop keeps the clinic it was planned at — a published route is
 * the plan a manager approved, and a check-in queued offline cannot wait for
 * a route edit. The VISIT carries the clinic where it happened: the check-in
 * names the stop (`routePointId`), the doctor (`contactId`) and the other
 * clinic (`customerId`). Check-out marks the stop by its id, plan/fact keys a
 * doctor stop by the doctor, so «planned at A, visited at B» counts once and
 * reads honestly.
 *
 * The other clinic is accepted only by the rule the planner offers and saves
 * a doctor stop with (`validateMtmMobileRouteTargetEligibility`): an active
 * workplace of this doctor on that day, and the doctor given to this agent —
 * directly, or through that very clinic. Never «any workplace»: a doctor the
 * agent reaches only through clinic A is not his to visit at clinic B.
 */

/** Which stop a check-in addresses. With the stop's id and its doctor named,
 * the clinic is left out of the lookup — it is checked by
 * `doctorVisitPlace`; otherwise the clinic stays part of the address, as before. */
export function routePointCheckInWhere(input: {
  routePointId?: string | null
  routeId?: string | null
  customerId: string
  contactId?: string | null
}): Prisma.MtmRoutePointWhereInput {
  const byDoctorStop = Boolean(input.routePointId) && typeof input.contactId === "string" && input.contactId.length > 0
  return {
    ...(input.routePointId ? { id: input.routePointId } : {}),
    ...(input.routeId ? { routeId: input.routeId } : {}),
    ...(byDoctorStop ? {} : { customerId: input.customerId }),
    ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
  }
}

export type DoctorVisitPlace =
  | { ok: true; customerId: string; otherClinic: boolean }
  | { ok: false }

/**
 * Where a check-in at a route stop is recorded: the stop's own clinic, or —
 * for a doctor stop only — another clinic of the same doctor that this agent
 * may visit him at on `at`.
 */
export async function doctorVisitPlace(
  client: Pick<Prisma.TransactionClient, "mtmCustomer" | "mtmContact">,
  input: {
    organizationId: string
    agentId: string
    point: { customerId: string; contactId: string | null }
    requestedCustomerId: string
    requestedContactId?: string | null
    at: Date
  },
): Promise<DoctorVisitPlace> {
  if (input.requestedCustomerId === input.point.customerId) {
    return { ok: true, customerId: input.point.customerId, otherClinic: false }
  }
  if (!input.point.contactId || input.requestedContactId !== input.point.contactId) return { ok: false }
  const eligibility = await validateMtmMobileRouteTargetEligibility(client, {
    organizationId: input.organizationId,
    primaryAgentId: input.agentId,
    routeDate: input.at,
    points: [{ customerId: input.requestedCustomerId, contactId: input.point.contactId }],
  })
  return eligibility.ok
    ? { ok: true, customerId: input.requestedCustomerId, otherClinic: true }
    : { ok: false }
}

export type DoctorOtherClinic = {
  id: string
  name: string
  address: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  geofenceRadius: number | null
}

/**
 * For each doctor stop: the doctor's OTHER clinics where `agentId` may visit
 * him on `date` — exactly the places `doctorVisitPlace` would accept, so the
 * phone can tell, offline, that the agent stands in one of them. One query for
 * the whole route.
 */
export async function doctorOtherClinics(
  client: Pick<Prisma.TransactionClient, "mtmContactWorkplace">,
  input: {
    organizationId: string
    agentId: string
    date: Date
    points: ReadonlyArray<{ id: string; customerId: string; contactId: string | null }>
  },
): Promise<Map<string, DoctorOtherClinic[]>> {
  const doctorPoints = input.points.filter((point): point is typeof point & { contactId: string } => Boolean(point.contactId))
  const result = new Map<string, DoctorOtherClinic[]>()
  if (doctorPoints.length === 0) return result
  const assignment = { agentId: input.agentId, ...activeFieldAssignmentWindow(input.date) }
  const rows: Array<{ contactId: string; customer: DoctorOtherClinic }> = await client.mtmContactWorkplace.findMany({
    where: {
      organizationId: input.organizationId,
      contactId: { in: [...new Set(doctorPoints.map((point) => point.contactId))] },
      deletedAt: null,
      AND: [
        { OR: [{ startedOn: null }, { startedOn: { lte: input.date } }] },
        { OR: [{ endedOn: null }, { endedOn: { gt: input.date } }] },
        {
          // The doctor is this agent's, or this clinic is (route-targets.ts).
          OR: [
            { contact: { agentAssignments: { some: assignment } } },
            { customer: { agentAssignments: { some: assignment } } },
          ],
        },
      ],
      contact: { organizationId: input.organizationId, type: "DOCTOR", status: "ACTIVE", deletedAt: null },
      customer: { organizationId: input.organizationId, status: "ACTIVE", deletedAt: null },
    },
    orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }, { id: "asc" }],
    select: {
      contactId: true,
      customer: { select: { id: true, name: true, address: true, city: true, latitude: true, longitude: true, geofenceRadius: true } },
    },
  })
  for (const point of doctorPoints) {
    const seen = new Set<string>([point.customerId])
    const clinics: DoctorOtherClinic[] = []
    for (const row of rows) {
      if (row.contactId !== point.contactId || seen.has(row.customer.id)) continue
      seen.add(row.customer.id)
      clinics.push({
        ...row.customer,
        latitude: row.customer.latitude == null ? null : Number(row.customer.latitude),
        longitude: row.customer.longitude == null ? null : Number(row.customer.longitude),
      })
    }
    if (clinics.length > 0) result.set(point.id, clinics)
  }
  return result
}
