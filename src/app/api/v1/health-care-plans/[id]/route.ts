/**
 * R2 Health — care plan per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PHI).
 * PATCH — three-way handling. Goals replaced wholesale (not merged
 *   per-goal — that's a slice-2 mini-goal API on its own).
 *   Status transitions via `transitionCarePlan` slice-1 helper.
 *   Auto-stamps activatedAt / completedAt / cancelledAt; cancellation
 *   requires `cancellationReason`.
 *
 * Immutable on PATCH:
 *   • patientId  — re-parenting forges clinical attribution
 *
 * DELETE intentionally NOT exposed — care plans are clinical
 * artifacts referenced by progress calculations; cancellation is a
 * status transition.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionCarePlan } from "@/lib/health/state-machine"
import { validateCarePlanGoal } from "@/lib/health/care-plan-progress-calculator"
import { type CarePlanGoal } from "@/lib/health/types"
import {
  encryptForTenantOrNull,
  softDecryptForTenant,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "health_care_plans"
const MAX_NAME_LEN = 200
const MAX_DESCRIPTION_LEN = 10_000

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function validateGoalsArray(
  v: unknown,
):
  | { ok: true; goals: CarePlanGoal[] }
  | { ok: false; error: string } {
  if (!Array.isArray(v)) {
    return { ok: false, error: "`goals` must be an array" }
  }
  if (v.length > 100) {
    return { ok: false, error: "`goals` array too long (max 100)" }
  }
  const out: CarePlanGoal[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < v.length; i++) {
    const g = v[i] as unknown
    if (g === null || typeof g !== "object" || Array.isArray(g)) {
      return { ok: false, error: `goal[${i}] must be a plain object` }
    }
    const goal = g as CarePlanGoal
    if (typeof goal.id !== "string" || goal.id.length === 0) {
      return { ok: false, error: `goal[${i}] missing \`id\`` }
    }
    if (seenIds.has(goal.id)) {
      return { ok: false, error: `goal[${i}] duplicate id "${goal.id}"` }
    }
    seenIds.add(goal.id)
    const r = validateCarePlanGoal(goal)
    if (!r.ok) return { ok: false, error: r.error }
    out.push(goal)
  }
  return { ok: true, goals: out }
}

export const GET = withRlsAuth("health", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing plan id" },
      { status: 400 },
    )
  }

  try {
    const plan = await prisma.healthCarePlan.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!plan) {
      void recordPhiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Care plan not found" },
        { status: 404 },
      )
    }

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: plan.id,
      action: "read",
      metadata: {
        patientId: plan.patientId,
        providerId: plan.providerId,
        status: plan.status,
      },
    })

    return NextResponse.json({
      plan: {
        ...plan,
        description: softDecryptForTenant(orgId, plan.description),
        cancellationReason: softDecryptForTenant(
          orgId,
          plan.cancellationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[health-care-plans/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load care plan" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  providerId?: unknown
  name?: unknown
  description?: unknown
  goals?: unknown
  startDate?: unknown
  endDate?: unknown
  status?: unknown
  cancellationReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("health", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing plan id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.healthCarePlan.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      activatedAt: true,
      completedAt: true,
      cancelledAt: true,
      cancellationReason: true,
    },
  })
  if (!existing) {
    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Care plan not found" },
      { status: 404 },
    )
  }

  const data: {
    providerId?: string | null
    name?: string
    description?: string | null
    goals?: Prisma.InputJsonValue
    startDate?: Date
    endDate?: Date | null
    status?: string
    cancellationReason?: string | null
    activatedAt?: Date
    completedAt?: Date
    cancelledAt?: Date
    metadata?: unknown
  } = {}

  // providerId — three-way + tenant pre-check.
  if (body.providerId !== undefined) {
    const v = strField(body.providerId, 64)
    if (v !== undefined) {
      if (v !== null) {
        const prov = await prisma.healthProvider.findFirst({
          where: { id: v, organizationId: orgId },
          select: { id: true },
        })
        if (!prov) {
          return NextResponse.json(
            { error: "Provider not found for this tenant" },
            { status: 404 },
          )
        }
      }
      data.providerId = v
    }
  }

  if (body.name !== undefined) {
    const v = strField(body.name, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`name` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.name = v
  }
  if (body.description !== undefined) {
    const v = strField(body.description, MAX_DESCRIPTION_LEN)
    // Slice-2 PII column wrap: encrypt PHI description.
    if (v !== undefined) data.description = encryptForTenantOrNull(orgId, v)
  }

  if (body.goals !== undefined) {
    const r = validateGoalsArray(body.goals)
    if (!r.ok) {
      return NextResponse.json(
        { error: `Invalid \`goals\`: ${r.error}` },
        { status: 400 },
      )
    }
    data.goals = r.goals as unknown as Prisma.InputJsonValue
  }

  // startDate / endDate three-way.
  let nextStartDate = existing.startDate
  let nextEndDate = existing.endDate
  if (body.startDate !== undefined) {
    if (typeof body.startDate !== "string") {
      return NextResponse.json(
        { error: "Invalid `startDate`" },
        { status: 400 },
      )
    }
    const d = new Date(body.startDate)
    if (isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "Invalid `startDate`" },
        { status: 400 },
      )
    }
    data.startDate = d
    nextStartDate = d
  }
  if (body.endDate !== undefined) {
    if (body.endDate === null) {
      data.endDate = null
      nextEndDate = null
    } else if (typeof body.endDate === "string") {
      const d = new Date(body.endDate)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `endDate`" },
          { status: 400 },
        )
      }
      data.endDate = d
      nextEndDate = d
    } else {
      return NextResponse.json(
        { error: "Invalid `endDate`" },
        { status: 400 },
      )
    }
  }
  if (
    (body.startDate !== undefined || body.endDate !== undefined) &&
    nextEndDate &&
    nextEndDate.getTime() <= nextStartDate.getTime()
  ) {
    return NextResponse.json(
      { error: "`endDate` must be after `startDate`" },
      { status: 400 },
    )
  }

  // Status transition + lifecycle stamping.
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionCarePlan(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    // Cancellation reason required (mirrors encounter pattern). Note:
    // no DB CHECK enforces this today, but operator-trail consistency
    // matters — pre-validate so we don't get orphaned "cancelled
    // without reason" rows in the column.
    if (body.status === "cancelled") {
      const reason =
        strField(body.cancellationReason, MAX_DESCRIPTION_LEN) ??
        existing.cancellationReason
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "`cancellationReason` (non-empty string) is required when transitioning to `cancelled`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.cancellationReason, MAX_DESCRIPTION_LEN)
      // Slice-2 PII column wrap: encrypt cancellation reason before
      // persisting.
      if (supplied) {
        data.cancellationReason = encryptForTenantOrNull(orgId, supplied)
      }
    }

    data.status = body.status
    const now = new Date()
    if (body.status === "active" && !existing.activatedAt) {
      data.activatedAt = now
    }
    if (body.status === "completed" && !existing.completedAt) {
      data.completedAt = now
    }
    if (body.status === "cancelled" && !existing.cancelledAt) {
      data.cancelledAt = now
    }
  }

  if (body.metadata !== undefined) {
    if (
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const plan = await prisma.healthCarePlan.update({
      where: { id },
      data,
      select: {
        id: true,
        patientId: true,
        providerId: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        activatedAt: true,
        completedAt: true,
        cancelledAt: true,
        cancellationReason: true,
        updatedAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: plan.id,
      action: "write",
      metadata: {
        fields: Object.keys(data).filter(
          k =>
            k !== "activatedAt" && k !== "completedAt" && k !== "cancelledAt",
        ),
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      plan: {
        ...plan,
        description: softDecryptForTenant(orgId, plan.description),
        cancellationReason: softDecryptForTenant(
          orgId,
          plan.cancellationReason,
        ),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Invalid foreign key (`providerId`)" },
        { status: 400 },
      )
    }
    console.error("[health-care-plans/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update care plan" },
      { status: 500 },
    )
  }
})
