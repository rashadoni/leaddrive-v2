/**
 * R2 Health — encounter per-id (slice-2-mini).
 *
 * GET — single encounter read, audited as PHI.
 * PATCH — status transitions via `transitionEncounter` slice-1 helper.
 *   Auto-stamps lifecycle columns per the timestamp-write contract in
 *   `src/lib/health/types.ts`. DB CHECK rejects status flips that miss
 *   the timestamp, so the route does the work — never the caller.
 *
 * Immutable on PATCH (mirrors patient `mrn` lock):
 *   • patientId      — re-parenting an encounter is a clinical
 *                       integrity bug (a different patient's chart
 *                       must never inherit another patient's history)
 *   • providerId     — re-assignment goes through a referral, not a
 *                       silent column update (slice-2 follow-up may
 *                       expose a dedicated reassign endpoint)
 *
 * DELETE intentionally NOT exposed — HIPAA + integrity require
 * append-only audit trail; cancellation is a status transition, not
 * a deletion.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionEncounter } from "@/lib/health/state-machine"
import { ENCOUNTER_TYPES } from "@/lib/health/types"
import {
  encryptForTenantOrNull,
  softDecryptForTenant,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "health_encounters"
const MAX_GENERIC_LEN = 200

function strField(
  v: unknown,
  max: number = MAX_GENERIC_LEN,
): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const GET = withRlsAuth("health", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing encounter id" },
      { status: 400 },
    )
  }

  try {
    const encounter = await prisma.healthEncounter.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!encounter) {
      void recordPhiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Encounter not found" },
        { status: 404 },
      )
    }

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: encounter.id,
      action: "read",
      metadata: {
        patientId: encounter.patientId,
        providerId: encounter.providerId,
        status: encounter.status,
        encounterType: encounter.encounterType,
      },
    })

    return NextResponse.json({
      encounter: {
        ...encounter,
        reason: softDecryptForTenant(orgId, encounter.reason),
        location: softDecryptForTenant(orgId, encounter.location),
        cancellationReason: softDecryptForTenant(
          orgId,
          encounter.cancellationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[health-encounters/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load encounter" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  encounterType?: unknown
  reason?: unknown
  scheduledStartAt?: unknown
  scheduledEndAt?: unknown
  location?: unknown
  status?: unknown
  cancellationReason?: unknown
  cancelledBy?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("health", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing encounter id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.healthEncounter.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      checkedInAt: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
      noShowAt: true,
    },
  })
  if (!existing) {
    return NextResponse.json(
      { error: "Encounter not found" },
      { status: 404 },
    )
  }

  const data: {
    encounterType?: string
    reason?: string | null
    scheduledStartAt?: Date
    scheduledEndAt?: Date
    location?: string | null
    status?: string
    cancellationReason?: string | null
    cancelledBy?: string | null
    checkedInAt?: Date
    startedAt?: Date
    completedAt?: Date
    cancelledAt?: Date
    noShowAt?: Date
    metadata?: unknown
  } = {}

  if (body.encounterType !== undefined) {
    if (typeof body.encounterType !== "string") {
      return NextResponse.json(
        { error: "Invalid `encounterType`" },
        { status: 400 },
      )
    }
    if (!(ENCOUNTER_TYPES as readonly string[]).includes(body.encounterType)) {
      return NextResponse.json(
        {
          error: `Invalid \`encounterType\` — must be one of: ${ENCOUNTER_TYPES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.encounterType = body.encounterType
  }

  // Slice-2 PII column wrap: encrypt PHI free-text fields.
  if (body.reason !== undefined) {
    const v = strField(body.reason)
    if (v !== undefined) data.reason = encryptForTenantOrNull(orgId, v)
  }
  if (body.location !== undefined) {
    const v = strField(body.location)
    if (v !== undefined) data.location = encryptForTenantOrNull(orgId, v)
  }
  if (body.cancellationReason !== undefined) {
    const v = strField(body.cancellationReason)
    if (v !== undefined) {
      data.cancellationReason = encryptForTenantOrNull(orgId, v)
    }
  }
  if (body.cancelledBy !== undefined) {
    const v = strField(body.cancelledBy, 64)
    if (v !== undefined) data.cancelledBy = v
  }

  // Schedule edits on terminal encounters distort post-hoc analytics
  // (e.g. shifting a `no_show` slot retroactively). Block them.
  if (
    (body.scheduledStartAt !== undefined ||
      body.scheduledEndAt !== undefined) &&
    (existing.status === "completed" ||
      existing.status === "no_show" ||
      existing.status === "cancelled")
  ) {
    return NextResponse.json(
      {
        error: `Cannot edit schedule on a terminal encounter (status=${existing.status})`,
      },
      { status: 400 },
    )
  }

  // Scheduled window — both must remain start < end after the merge.
  let nextStart = existing.scheduledStartAt
  let nextEnd = existing.scheduledEndAt
  if (body.scheduledStartAt !== undefined) {
    if (typeof body.scheduledStartAt !== "string") {
      return NextResponse.json(
        { error: "Invalid `scheduledStartAt`" },
        { status: 400 },
      )
    }
    const d = new Date(body.scheduledStartAt)
    if (isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "Invalid `scheduledStartAt`" },
        { status: 400 },
      )
    }
    data.scheduledStartAt = d
    nextStart = d
  }
  if (body.scheduledEndAt !== undefined) {
    if (typeof body.scheduledEndAt !== "string") {
      return NextResponse.json(
        { error: "Invalid `scheduledEndAt`" },
        { status: 400 },
      )
    }
    const d = new Date(body.scheduledEndAt)
    if (isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "Invalid `scheduledEndAt`" },
        { status: 400 },
      )
    }
    data.scheduledEndAt = d
    nextEnd = d
  }
  if (
    (body.scheduledStartAt !== undefined ||
      body.scheduledEndAt !== undefined) &&
    nextEnd.getTime() <= nextStart.getTime()
  ) {
    return NextResponse.json(
      { error: "`scheduledEndAt` must be after `scheduledStartAt`" },
      { status: 400 },
    )
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionEncounter(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    // Cancellation coherence — DB CHECK
    // `health_encounters_cancelled_coherence_check` requires BOTH
    // `cancelledAt IS NOT NULL AND cancellationReason IS NOT NULL`.
    // We auto-stamp `cancelledAt` below; we MUST surface a 400 here
    // when the caller didn't include a non-empty `cancellationReason`,
    // else the CHECK throws and we'd return an opaque 500.
    if (body.status === "cancelled") {
      const reason = strField(body.cancellationReason)
      // Existing rows shouldn't reach here (scheduled/checked_in/
      // in_progress are non-terminal) but defend defensively.
      const reasonOk =
        (reason !== undefined && reason !== null && reason.length > 0) ||
        // Resolve to `undefined` happens for non-string input — covered
        // by the same path. The route requires it freshly on the
        // cancellation request even if a previous one existed (none
        // should — cancelled is terminal).
        false
      if (!reasonOk) {
        return NextResponse.json(
          {
            error:
              "`cancellationReason` (non-empty string) is required when transitioning to `cancelled`",
          },
          { status: 400 },
        )
      }
      // Slice-2 PII column wrap: encrypt cancellation reason before
      // persisting.
      data.cancellationReason = encryptForTenantOrNull(orgId, reason)
    }
    data.status = body.status
    // Auto-stamp lifecycle columns per timestamp-write contract.
    const now = new Date()
    if (body.status === "checked_in" && !existing.checkedInAt) {
      data.checkedInAt = now
    }
    if (body.status === "in_progress" && !existing.startedAt) {
      data.startedAt = now
    }
    if (body.status === "completed" && !existing.completedAt) {
      data.completedAt = now
    }
    if (body.status === "cancelled" && !existing.cancelledAt) {
      data.cancelledAt = now
    }
    if (body.status === "no_show" && !existing.noShowAt) {
      data.noShowAt = now
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
    const encounter = await prisma.healthEncounter.update({
      where: { id },
      data,
      select: {
        id: true,
        patientId: true,
        providerId: true,
        encounterType: true,
        status: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        checkedInAt: true,
        startedAt: true,
        completedAt: true,
        cancelledAt: true,
        noShowAt: true,
        updatedAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: encounter.id,
      action: "write",
      metadata: {
        fields: Object.keys(data),
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      encounter: {
        ...encounter,
        reason: softDecryptForTenant(orgId, encounter.reason),
        location: softDecryptForTenant(orgId, encounter.location),
        cancellationReason: softDecryptForTenant(
          orgId,
          encounter.cancellationReason,
        ),
      },
    })
  } catch (err) {
    console.error("[health-encounters/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update encounter" },
      { status: 500 },
    )
  }
})
