import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { activeFieldAssignmentWindow, customerScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isValidTimezone } from "@/lib/timezone"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function accessWhere(actor: MtmRouteActor, asOf: Date): Prisma.MtmCustomerWhereInput {
  if (actor.role === "ADMIN") return {}
  const scoped = customerScopeForActor(actor, asOf)
  if (actor.role === "AGENT") return scoped
  return { OR: [scoped, { agentAssignments: { none: activeFieldAssignmentWindow(asOf) } }] }
}

export async function resolveOrganizationDetailAccess(auth: MtmRlsAuth, customerId: string) {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor) return { actor: null, customer: null, asOf: null }
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = utcDate(currentDateKey(new Date(), timezone))
  const customer = await prisma.mtmCustomer.findFirst({
    where: {
      id: customerId,
      organizationId: auth.orgId,
      deletedAt: null,
      objectType: { not: "DOCTOR" },
      AND: [accessWhere(actor, asOf)],
    },
    select: { id: true, name: true, latitude: true, longitude: true },
  })
  return { actor, customer, asOf }
}
