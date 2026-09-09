/**
 * B10 Entitlement Process.
 *
 * PATCH  /api/v1/entitlements/[id]/milestones/[milestoneId]
 * DELETE /api/v1/entitlements/[id]/milestones/[milestoneId]
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  canUseEntitlementPermission,
  entitlementPermissionError,
  type EntitlementPermissionScope,
} from "@/lib/entitlement-process/access"
import {
  DUE_WINDOW_UNITS,
  dueWindowToSeconds,
  type DueWindowUnit,
} from "@/lib/entitlement-process/milestone-definitions"

const editableStatuses = new Set(["draft", "suspended"])
const dueUnitSchema = z.enum(["minutes", "hours", "days"])

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  dueValue: z.coerce.number().positive().optional(),
  dueUnit: dueUnitSchema.optional(),
  isRequired: z.boolean().optional(),
}).refine(
  (value) => value.name !== undefined || value.dueValue !== undefined || value.isRequired !== undefined,
  "No editable fields provided.",
).refine(
  (value) => (value.dueValue === undefined && value.dueUnit === undefined) || (value.dueValue !== undefined && value.dueUnit !== undefined),
  "dueValue and dueUnit must be provided together.",
)

interface DefinitionWithEntitlement {
  id: string
  type: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  name: string
  _count?: { ticketMilestones: number }
  entitlement: {
    id: string
    status: string
  }
}

async function findDefinition(orgId: string, entitlementId: string, milestoneId: string) {
  return prisma.entitlementMilestoneDefinition.findFirst({
    where: {
      id: milestoneId,
      organizationId: orgId,
      entitlementId,
    },
    select: {
      id: true,
      type: true,
      severityTier: true,
      dueWithinSeconds: true,
      isRequired: true,
      name: true,
      _count: { select: { ticketMilestones: true } },
      entitlement: { select: { id: true, status: true } },
    },
  }) as Promise<DefinitionWithEntitlement | null>
}

function ensureEditable(definition: DefinitionWithEntitlement) {
  return editableStatuses.has(definition.entitlement.status)
}

function forbidden(permission: EntitlementPermissionScope) {
  return NextResponse.json(
    { error: "Forbidden", message: entitlementPermissionError(permission) },
    { status: 403 },
  )
}

export const PATCH = withRlsAuth(
  "tickets",
  "write",
  async (req, auth, context: { params: Promise<{ id: string; milestoneId: string }> }) => {
    if (!canUseEntitlementPermission(auth.role, "entitlements.write")) {
      return forbidden("entitlements.write")
    }

    const { id, milestoneId } = await context.params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      )
    }

    const definition = await findDefinition(auth.orgId, id, milestoneId)
    if (!definition) {
      return NextResponse.json({ error: "Milestone definition not found." }, { status: 404 })
    }
    if (!ensureEditable(definition)) {
      return NextResponse.json(
        { error: "Milestone rules can be changed only while the support term is draft or suspended." },
        { status: 422 },
      )
    }

    const data: Prisma.EntitlementMilestoneDefinitionUpdateInput = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.isRequired !== undefined) data.isRequired = parsed.data.isRequired
    if (parsed.data.dueValue !== undefined && parsed.data.dueUnit !== undefined) {
      try {
        data.dueWithinSeconds = dueWindowToSeconds(
          parsed.data.dueValue,
          parsed.data.dueUnit as DueWindowUnit,
        )
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid due window." },
          { status: 400 },
        )
      }
    }

    try {
      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const milestoneDefinition = await tx.entitlementMilestoneDefinition.update({
          where: { id: milestoneId },
          data,
        })
        await tx.entitlementAuditEvent.create({
          data: {
            organizationId: auth.orgId,
            entitlementId: id,
            eventType: "entitlement_updated",
            actorUserId: auth.userId,
            payload: {
              action: "milestone_definition_updated",
              milestoneDefinitionId: milestoneId,
              fields: Object.keys(data),
            },
          },
        })
        return milestoneDefinition
      })

      return NextResponse.json({ success: true, definition: updated, units: DUE_WINDOW_UNITS })
    } catch (err) {
      console.error("[entitlement milestone] PATCH error:", err)
      return NextResponse.json(
        { error: "Failed to update milestone definition." },
        { status: 500 },
      )
    }
  },
)

export const DELETE = withRlsAuth(
  "tickets",
  "write",
  async (_req, auth, context: { params: Promise<{ id: string; milestoneId: string }> }) => {
    if (!canUseEntitlementPermission(auth.role, "entitlements.write")) {
      return forbidden("entitlements.write")
    }

    const { id, milestoneId } = await context.params
    const definition = await findDefinition(auth.orgId, id, milestoneId)
    if (!definition) {
      return NextResponse.json({ error: "Milestone definition not found." }, { status: 404 })
    }
    if (!ensureEditable(definition)) {
      return NextResponse.json(
        { error: "Milestone rules can be changed only while the support term is draft or suspended." },
        { status: 422 },
      )
    }
    if ((definition._count?.ticketMilestones ?? 0) > 0) {
      return NextResponse.json(
        { error: "This milestone definition is already used by tickets and cannot be deleted." },
        { status: 409 },
      )
    }

    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.entitlementMilestoneDefinition.delete({
          where: { id: milestoneId },
        })
        await tx.entitlementAuditEvent.create({
          data: {
            organizationId: auth.orgId,
            entitlementId: id,
            eventType: "entitlement_updated",
            actorUserId: auth.userId,
            payload: {
              action: "milestone_definition_deleted",
              milestoneDefinitionId: milestoneId,
              type: definition.type,
              severityTier: definition.severityTier,
            },
          },
        })
      })

      return NextResponse.json({ success: true, deleted: milestoneId })
    } catch (err) {
      console.error("[entitlement milestone] DELETE error:", err)
      return NextResponse.json(
        { error: "Failed to delete milestone definition." },
        { status: 500 },
      )
    }
  },
)
