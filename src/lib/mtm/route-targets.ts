import type { Prisma } from "@prisma/client"
import { activeFieldAssignmentWindow } from "@/lib/mtm/field-scope"
import { eligibleFieldCustomerWhere } from "@/lib/mtm/field-eligibility"

export type MtmRouteTargetInput = {
  customerId: string
  contactId?: string | null
}

type RouteTargetClient = Pick<Prisma.TransactionClient, "mtmCustomer" | "mtmContact">

export function mtmRouteTargetKey(point: MtmRouteTargetInput): string {
  return point.contactId ? `contact:${point.contactId}` : `customer:${point.customerId}`
}

export async function validateMtmRouteTargets(
  client: RouteTargetClient,
  input: {
    organizationId: string
    routeDate: Date
    points: readonly MtmRouteTargetInput[]
  },
): Promise<{
  ok: boolean
  missingCustomerIds: string[]
  missingContactIds: string[]
  invalidContactWorkplaces: Array<{ contactId: string; customerId: string }>
}> {
  const customerIds = [...new Set(input.points.map((point) => point.customerId))]
  const contactTargets = input.points.filter(
    (point): point is MtmRouteTargetInput & { contactId: string } => Boolean(point.contactId),
  )
  const contactIds = [...new Set(contactTargets.map((point) => point.contactId))]

  const [customers, contacts] = await Promise.all([
    customerIds.length > 0
      ? client.mtmCustomer.findMany({
          where: {
            organizationId: input.organizationId,
            id: { in: customerIds },
            deletedAt: null,
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    contactIds.length > 0
      ? client.mtmContact.findMany({
          where: {
            organizationId: input.organizationId,
            id: { in: contactIds },
            status: { not: "INACTIVE" },
            deletedAt: null,
          },
          select: {
            id: true,
            workplaces: {
              where: {
                organizationId: input.organizationId,
                customerId: { in: customerIds },
                deletedAt: null,
                AND: [
                  { OR: [{ startedOn: null }, { startedOn: { lte: input.routeDate } }] },
                  { OR: [{ endedOn: null }, { endedOn: { gt: input.routeDate } }] },
                ],
              },
              select: { customerId: true },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const foundCustomers = new Set(customers.map((customer) => customer.id))
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))
  const missingCustomerIds = customerIds.filter((customerId) => !foundCustomers.has(customerId))
  const missingContactIds = contactIds.filter((contactId) => !contactsById.has(contactId))
  const invalidContactWorkplaces = contactTargets
    .filter((target) => {
      const contact = contactsById.get(target.contactId)
      return Boolean(contact && !contact.workplaces.some((workplace) => workplace.customerId === target.customerId))
    })
    .map(({ contactId, customerId }) => ({ contactId, customerId }))

  return {
    ok: missingCustomerIds.length === 0 && missingContactIds.length === 0 && invalidContactWorkplaces.length === 0,
    missingCustomerIds,
    missingContactIds,
    invalidContactWorkplaces,
  }
}

/**
 * Mobile route planning is deliberately narrower than web planning. A mobile
 * bearer may only use the selected route owner's current catalogue for the
 * route day; it must not turn a known tenant record into an unassigned stop by
 * bypassing the picker UI.
 *
 * This returns only a boolean so callers can reject a forged target without
 * disclosing another agent's assignment or customer ownership.
 */
export async function validateMtmMobileRouteTargetEligibility(
  client: RouteTargetClient,
  input: {
    organizationId: string
    primaryAgentId: string
    routeDate: Date
    points: readonly MtmRouteTargetInput[]
  },
): Promise<{ ok: boolean }> {
  if (input.points.length === 0) return { ok: true }

  const customerIds = [...new Set(input.points.map((point) => point.customerId))]
  const contactTargets = input.points.filter(
    (point): point is MtmRouteTargetInput & { contactId: string } => Boolean(point.contactId),
  )
  const contactIds = [...new Set(contactTargets.map((point) => point.contactId))]
  const assignmentWindow = activeFieldAssignmentWindow(input.routeDate)

  const [customers, contacts, eligibleCustomers] = await Promise.all([
    client.mtmCustomer.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: customerIds },
        status: "ACTIVE",
        deletedAt: null,
      },
      select: {
        id: true,
        agentAssignments: {
          where: { agentId: input.primaryAgentId, ...assignmentWindow },
          take: 1,
          select: { id: true },
        },
      },
    }),
    contactIds.length > 0
      ? client.mtmContact.findMany({
          where: {
            organizationId: input.organizationId,
            id: { in: contactIds },
            type: "DOCTOR",
            status: "ACTIVE",
            deletedAt: null,
          },
          select: {
            id: true,
            agentAssignments: {
              where: { agentId: input.primaryAgentId, ...assignmentWindow },
              take: 1,
              select: { id: true },
            },
            workplaces: {
              where: {
                organizationId: input.organizationId,
                customerId: { in: customerIds },
                deletedAt: null,
                AND: [
                  { OR: [{ startedOn: null }, { startedOn: { lte: input.routeDate } }] },
                  { OR: [{ endedOn: null }, { endedOn: { gt: input.routeDate } }] },
                ],
              },
              select: { customerId: true },
            },
          },
        })
      : Promise.resolve([]),
    // The same definition the picker offers from. Without this the picker and
    // the save disagree: A2 widened the picker to points reachable through an
    // actionable route, and a validator that still demanded an assignment
    // would reject exactly what the agent had just been shown — the promise
    // the app refuses to keep, moved one step later.
    client.mtmCustomer.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: customerIds },
        status: "ACTIVE",
        deletedAt: null,
        AND: [eligibleFieldCustomerWhere({ agentId: input.primaryAgentId, date: input.routeDate })],
      },
      select: { id: true },
    }),
  ])

  const eligibleCustomerIds = new Set(eligibleCustomers.map((customer) => customer.id))
  const customersById = new Map(customers.map((customer) => [customer.id, customer]))
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))
  const eligible = input.points.every((point) => {
    const customer = customersById.get(point.customerId)
    if (!customer) return false
    // The shared scope already contains the assignment arm, so this is a
    // superset of the old check, never a weaker one.
    if (!point.contactId) return eligibleCustomerIds.has(point.customerId)

    const contact = contactsById.get(point.contactId)
    if (!contact || !contact.workplaces.some((workplace) => workplace.customerId === point.customerId)) {
      return false
    }
    // Doctors stay assignment-only on purpose: the picker does not offer
    // route-only doctors yet, and accepting them here would grant a write the
    // interface never showed.
    return contact.agentAssignments.length > 0 || customer.agentAssignments.length > 0
  })

  return { ok: eligible }
}
