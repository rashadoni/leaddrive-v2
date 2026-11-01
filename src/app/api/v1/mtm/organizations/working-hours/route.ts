import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { activeFieldAssignmentWindow, canManageFieldMasterData, customerScopeForActor } from "@/lib/mtm/field-scope"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_ORGANIZATION_BULK_LIMIT } from "@/lib/mtm/organization-explorer"
import { MtmWorkingHoursSchema, normalizeWorkingHours } from "@/lib/mtm/customer-hours"

/**
 * PUT /api/v1/mtm/organizations/working-hours — «Часы приёма» of one place or
 * of many at once (owner 2026-11-02, mockup «MTM: часы приёма клиентов»: the
 * card's «Изменить часы» and the list's «Задать часы выбранным» are one
 * action). `workingHours: null` clears them back to «не указаны».
 *
 * Master data: only those who may edit places (agents propose, they do not
 * edit — mtm-agents-never-edit-master-data), and only places in their scope.
 */
const Body = z.object({
  organizationIds: z.array(z.string().min(1).max(64)).min(1).max(MTM_ORGANIZATION_BULK_LIMIT),
  workingHours: MtmWorkingHoursSchema.nullable(),
}).strict()

function accessForActor(actor: MtmRouteActor, asOf: Date): Prisma.MtmCustomerWhereInput {
  if (actor.role === "ADMIN") return {}
  return {
    OR: [
      customerScopeForActor(actor, asOf),
      { agentAssignments: { none: activeFieldAssignmentWindow(asOf) } },
    ],
  }
}

export const PUT = withRouteFieldRlsAuth("write", async (req, auth) => {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: auth.role, agentId: auth.agentId }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Agents must request organization changes", code: "MTM_ORGANIZATION_APPROVAL_REQUIRED" }, { status: 403 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid working hours", code: "MTM_WORKING_HOURS_INVALID", issues: parsed.error.issues.slice(0, 5) }, { status: 400 })
  }
  const ids = [...new Set(parsed.data.organizationIds)]
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  const allowed = await prisma.mtmCustomer.findMany({
    where: {
      id: { in: ids },
      organizationId: auth.orgId,
      deletedAt: null,
      objectType: { not: "DOCTOR" },
      AND: [accessForActor(actor, asOf)],
    },
    select: { id: true, workingHours: true },
  })
  if (allowed.length !== ids.length) {
    // All or nothing: a list where some places are outside the scope changes none.
    return NextResponse.json({ error: "Some places are not found or outside your scope", code: "MTM_WORKING_HOURS_SCOPE_DENIED" }, { status: 404 })
  }

  const hours = parsed.data.workingHours ? normalizeWorkingHours(parsed.data.workingHours) : null
  const now = new Date()
  const changed = await prisma.mtmCustomer.updateMany({
    where: { id: { in: ids }, organizationId: auth.orgId, deletedAt: null },
    data: {
      workingHours: hours ? hours as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      workingHoursUpdatedAt: hours ? now : null,
      workingHoursUpdatedBy: hours ? auth.userId : null,
    },
  })

  await Promise.all(allowed.map((row) => writeMtmAudit({
    organizationId: auth.orgId,
    agentId: actor.agentId,
    action: "FIELD_ORGANIZATION_UPDATE",
    entity: "customer",
    entityId: row.id,
    metadataKind: "field_organization_hours",
    oldData: { workingHours: row.workingHours },
    newData: { workingHours: hours },
    req,
  }).catch((error) => console.warn("[MTM/organizations/working-hours] audit failed", error))))

  return NextResponse.json({ success: true, data: { updated: changed.count } })
})
