/**
 * B10 Entitlement Process.
 *
 * PATCH /api/v1/entitlements/[id]
 *   - editable fields while draft/suspended
 *   - lifecycle actions: activate, suspend, resume, expire, cancel
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
  ENTITLEMENT_STATUS_TRANSITIONS,
  type AuditEventType,
  type EntitlementStatus,
} from "@/lib/entitlement-process/types"

const supportLevelSchema = z.enum(["basic", "standard", "premium", "enterprise"])
const editableFieldsSchema = z.object({
  supportLevel: supportLevelSchema.optional(),
  validFrom: z.string().min(1).optional(),
  validTo: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})
const lifecycleActionSchema = z.object({
  action: z.enum(["activate", "suspend", "resume", "expire", "cancel"]),
  cancellationReason: z.string().min(1).max(1000).optional(),
})
const patchSchema = editableFieldsSchema.merge(lifecycleActionSchema.partial())

function parseDateInput(value: string | null | undefined, fieldName: string): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid.`)
  }
  return date
}

function targetStatusForAction(action: z.infer<typeof lifecycleActionSchema>["action"]): EntitlementStatus {
  switch (action) {
    case "activate":
    case "resume":
      return "active"
    case "suspend":
      return "suspended"
    case "expire":
      return "expired"
    case "cancel":
      return "cancelled"
  }
}

function auditEventForAction(
  action: z.infer<typeof lifecycleActionSchema>["action"],
  fromStatus: EntitlementStatus,
): AuditEventType {
  if (action === "activate" && fromStatus === "suspended") return "entitlement_resumed"
  switch (action) {
    case "activate":
      return "entitlement_activated"
    case "resume":
      return "entitlement_resumed"
    case "suspend":
      return "entitlement_suspended"
    case "expire":
      return "entitlement_expired"
    case "cancel":
      return "entitlement_cancelled"
  }
}

function isKnownStatus(status: string): status is EntitlementStatus {
  return status in ENTITLEMENT_STATUS_TRANSITIONS
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
  async (req, auth, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: "Missing entitlement id." }, { status: 400 })
    }

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

    const requiredPermission: EntitlementPermissionScope = parsed.data.action
      ? parsed.data.action === "cancel"
        ? "entitlements.cancel"
        : "entitlements.activate"
      : "entitlements.write"
    if (!canUseEntitlementPermission(auth.role, requiredPermission)) {
      return forbidden(requiredPermission)
    }

    const existing = await prisma.entitlement.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        id: true,
        organizationId: true,
        companyId: true,
        slaPolicyId: true,
        supportLevel: true,
        validFrom: true,
        validTo: true,
        status: true,
        notes: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: "Support term not found." }, { status: 404 })
    }
    if (!isKnownStatus(existing.status)) {
      return NextResponse.json(
        { error: "Support term has an unknown status." },
        { status: 409 },
      )
    }
    const currentStatus: EntitlementStatus = existing.status

    if (parsed.data.action) {
      const targetStatus = targetStatusForAction(parsed.data.action)
      if (targetStatus === currentStatus) {
        return NextResponse.json(
          { error: `Support term is already ${currentStatus}.` },
          { status: 409 },
        )
      }
      const allowed = ENTITLEMENT_STATUS_TRANSITIONS[currentStatus]
      if (!allowed.includes(targetStatus)) {
        return NextResponse.json(
          { error: `Cannot change support term from ${currentStatus} to ${targetStatus}.` },
          { status: 422 },
        )
      }
      if (targetStatus === "active") {
        const duplicate = await prisma.entitlement.findFirst({
          where: {
            organizationId: auth.orgId,
            companyId: existing.companyId,
            status: "active",
            id: { not: id },
          },
          select: { id: true },
        })
        if (duplicate) {
          return NextResponse.json(
            { error: "This company already has an active support term." },
            { status: 409 },
          )
        }
        const definitionCount = await prisma.entitlementMilestoneDefinition.count({
          where: {
            organizationId: auth.orgId,
            entitlementId: id,
          },
        })
        if (definitionCount === 0) {
          return NextResponse.json(
            { error: "Add at least one milestone rule before activation." },
            { status: 422 },
          )
        }
      }
      if (targetStatus === "cancelled" && !parsed.data.cancellationReason?.trim()) {
        return NextResponse.json(
          { error: "Cancellation reason is required." },
          { status: 400 },
        )
      }

      try {
        const now = new Date()
        const eventType = auditEventForAction(parsed.data.action, currentStatus)
        const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const entitlement = await tx.entitlement.update({
            where: { id },
            data: {
              status: targetStatus,
              ...(targetStatus === "expired" ? { expiredAt: now } : {}),
              ...(targetStatus === "cancelled"
                ? {
                    cancelledAt: now,
                    cancellationReason: parsed.data.cancellationReason?.trim(),
                  }
                : {}),
            },
          })
          await tx.entitlementAuditEvent.create({
            data: {
              organizationId: auth.orgId,
              entitlementId: id,
              eventType,
              actorUserId: auth.userId,
              payload: {
                fromStatus: existing.status,
                toStatus: targetStatus,
                action: parsed.data.action,
              },
            },
          })
          return entitlement
        })
        return NextResponse.json({ success: true, entitlement: updated })
      } catch (err) {
        console.error("[entitlements/:id] lifecycle error:", err)
        return NextResponse.json(
          { error: "Failed to update support term lifecycle." },
          { status: 500 },
        )
      }
    }

    if (!["draft", "suspended"].includes(currentStatus)) {
      return NextResponse.json(
        { error: "Only draft or suspended support terms can be edited." },
        { status: 422 },
      )
    }

    const data: Prisma.EntitlementUpdateInput = {}
    if (parsed.data.supportLevel !== undefined) data.supportLevel = parsed.data.supportLevel
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes?.trim() || null

    let nextValidFrom = existing.validFrom
    let nextValidTo = existing.validTo
    try {
      if (parsed.data.validFrom !== undefined) {
        const parsedValidFrom = parseDateInput(parsed.data.validFrom, "validFrom")
        if (!parsedValidFrom) {
          return NextResponse.json({ error: "validFrom is required." }, { status: 400 })
        }
        nextValidFrom = parsedValidFrom
        data.validFrom = parsedValidFrom
      }
      if (parsed.data.validTo !== undefined) {
        nextValidTo = parseDateInput(parsed.data.validTo, "validTo")
        data.validTo = nextValidTo
      }
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid date." },
        { status: 400 },
      )
    }
    if (nextValidTo && nextValidTo <= nextValidFrom) {
      return NextResponse.json(
        { error: "validTo must be after validFrom." },
        { status: 400 },
      )
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No editable fields provided." }, { status: 400 })
    }

    try {
      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const entitlement = await tx.entitlement.update({
          where: { id },
          data,
        })
        await tx.entitlementAuditEvent.create({
          data: {
            organizationId: auth.orgId,
            entitlementId: id,
            eventType: "entitlement_updated",
            actorUserId: auth.userId,
            payload: {
              fields: Object.keys(data),
              status: currentStatus,
            },
          },
        })
        return entitlement
      })
      return NextResponse.json({ success: true, entitlement: updated })
    } catch (err) {
      console.error("[entitlements/:id] PATCH error:", err)
      return NextResponse.json(
        { error: "Failed to update support term." },
        { status: 500 },
      )
    }
  },
)
