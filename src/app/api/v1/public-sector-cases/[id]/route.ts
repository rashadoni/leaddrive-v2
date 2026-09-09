/**
 * R8 Public Sector — case per-id (slice-2-mini).
 *
 * GET — single case read (FOIA audit, including 404 path).
 * PATCH — status transitions via slice-2 `canTransitionCase` wrapper
 *   (state-machine + escalated→resolved/denied supervisor-gate from
 *   PR #88). Auto-stamps lifecycle columns + backfills prior
 *   chronological stamps when a path skips a status (the DB CHECK
 *   suite requires e.g. intakeStartedAt NOT NULL whenever status is
 *   `assigned` or beyond — see `public_sector_cases_intake_coherence_check`).
 *
 * Immutable on PATCH:
 *   • caseNumber  — institutional identifier
 *   • citizenId   — re-parenting a case to a different citizen
 *                    forges someone else's complaint
 *   • caseType    — affects statutory-deadline math + agency routing
 *
 * DELETE intentionally NOT exposed — FOIA + civil-discovery require
 * append-only audit trail; withdrawal is a status transition.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { canTransitionCase } from "@/lib/public-sector/state-machine"
import {
  CASE_PRIORITIES,
  type CaseStatus,
} from "@/lib/public-sector/types"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the 3
// PII text columns — description (PATCH write), decisionRationale
// (PATCH side-exit gate on `denied`), withdrawalReason (PATCH
// side-exit gate on `withdrawn`). Bound AAD binds to (orgId,
// public_sector_cases, "<column>"), defeating same-tenant shuffle of
// FOIA-audit-relevant text into another column on the same case.
const TABLE = "public_sector_cases"
const MAX_GENERIC_LEN = 200
const MAX_SUBJECT_LEN = 500
const MAX_DESCRIPTION_LEN = 10_000

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

/**
 * Status ranks (chronological progression). Higher rank = later
 * lifecycle stage. Used by the timestamp backfill to ensure
 * `intakeStartedAt`, `assignedAt`, `workStartedAt`, `escalatedAt`
 * are set whenever the row reaches the corresponding minimum rank.
 *
 * Side exits (denied, withdrawn) have rank 0 — they don't drive
 * forward-progression timestamps but trigger their own column
 * (deniedAt / withdrawnAt).
 */
const STATUS_RANK: Record<CaseStatus, number> = {
  submitted: 0,
  intake: 1,
  assigned: 2,
  in_progress: 3,
  escalated: 4,
  resolved: 5,
  denied: 0,
  withdrawn: 0,
}

export const GET = withRlsAuth("public-sector", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing case id" }, { status: 400 })
  }

  try {
    const caseRow = await prisma.publicSectorCase.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!caseRow) {
      void recordFoiaAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "Case not found" }, { status: 404 })
    }

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: caseRow.id,
      action: "read",
      metadata: {
        caseNumber: caseRow.caseNumber,
        citizenId: caseRow.citizenId,
        caseType: caseRow.caseType,
        status: caseRow.status,
        agencySlug: caseRow.agencySlug,
      },
    })

    // Soft-decrypt encrypted PII columns.
    return NextResponse.json({
      case: {
        ...caseRow,
        description: softDecryptForTenantBound(orgId, TABLE, "description", caseRow.description),
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          caseRow.decisionRationale,
        ),
        withdrawalReason: softDecryptForTenantBound(
          orgId,
          TABLE,
          "withdrawalReason",
          caseRow.withdrawalReason,
        ),
      },
    })
  } catch (err) {
    console.error("[public-sector-cases/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load case" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  priority?: unknown
  agencySlug?: unknown
  departmentSlug?: unknown
  assignedOfficialId?: unknown
  subject?: unknown
  description?: unknown
  statutoryDueAt?: unknown
  status?: unknown
  decisionRationale?: unknown
  withdrawalReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("public-sector", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing case id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.publicSectorCase.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      assignedOfficialId: true,
      intakeStartedAt: true,
      assignedAt: true,
      workStartedAt: true,
      escalatedAt: true,
      resolvedAt: true,
      deniedAt: true,
      withdrawnAt: true,
      decisionRationale: true,
      withdrawalReason: true,
    },
  })
  if (!existing) {
    // PATCH-404 FOIA audit — every read AND write attempt logs,
    // including denials. FOIA records-request must show "the operator
    // tried to update case X at time Y but it didn't exist".
    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json({ error: "Case not found" }, { status: 404 })
  }

  const data: {
    priority?: string
    agencySlug?: string
    departmentSlug?: string | null
    assignedOfficialId?: string | null
    subject?: string
    description?: string | null
    statutoryDueAt?: Date | null
    status?: string
    decisionRationale?: string | null
    withdrawalReason?: string | null
    intakeStartedAt?: Date
    assignedAt?: Date
    workStartedAt?: Date
    escalatedAt?: Date
    resolvedAt?: Date
    deniedAt?: Date
    withdrawnAt?: Date
    metadata?: unknown
  } = {}

  if (body.priority !== undefined) {
    if (
      typeof body.priority !== "string" ||
      !(CASE_PRIORITIES as readonly string[]).includes(body.priority)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`priority\` — must be one of: ${CASE_PRIORITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.priority = body.priority
  }

  if (body.agencySlug !== undefined) {
    const v = strField(body.agencySlug, 64)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`agencySlug` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.agencySlug = v
  }

  if (body.departmentSlug !== undefined) {
    const v = strField(body.departmentSlug, 64)
    if (v !== undefined) data.departmentSlug = v
  }

  // assignedOfficialId — three-way + tenant pre-check on non-null swap.
  // The fetch also returns `authorityLevel` so a subsequent status
  // transition (escalated → resolved/denied) can use it for the
  // supervisor-gate without a second roundtrip.
  let nextAssignedOfficialId = existing.assignedOfficialId
  let assignedOfficialAuthorityLevel:
    | "line"
    | "supervisor"
    | "director"
    | null = null
  if (body.assignedOfficialId !== undefined) {
    const v = strField(body.assignedOfficialId, 64)
    if (v !== undefined) {
      // Block clearing while case is at `assigned`-or-beyond — DB
      // `assigned_coherence_check` requires assignedOfficialId NOT NULL.
      // Without this gate, Postgres throws a check-violation and the
      // request ends as an opaque 500. (Re-assignment to a different
      // official is fine — only clearing is blocked.)
      if (
        v === null &&
        STATUS_RANK[existing.status as CaseStatus] >= STATUS_RANK.assigned
      ) {
        return NextResponse.json(
          {
            error: `\`assignedOfficialId\` cannot be cleared while status is \`${existing.status}\`. Re-assign to a different official or move the case to \`withdrawn\` first.`,
          },
          { status: 400 },
        )
      }
      if (v !== null) {
        const off = await prisma.publicSectorOfficial.findFirst({
          where: { id: v, organizationId: orgId },
          select: { id: true, authorityLevel: true },
        })
        if (!off) {
          return NextResponse.json(
            { error: "Official not found for this tenant" },
            { status: 404 },
          )
        }
        assignedOfficialAuthorityLevel =
          off.authorityLevel as "line" | "supervisor" | "director"
      }
      data.assignedOfficialId = v
      nextAssignedOfficialId = v
    }
  }

  if (body.subject !== undefined) {
    const v = strField(body.subject, MAX_SUBJECT_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`subject` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.subject = v
  }
  if (body.description !== undefined) {
    const v = strField(body.description, MAX_DESCRIPTION_LEN)
    // Slice-2 PII column wrap: encrypt description before persisting.
    if (v !== undefined) data.description = encryptForTenantBoundOrNull(orgId, TABLE, "description", v)
  }

  if (body.statutoryDueAt !== undefined) {
    if (body.statutoryDueAt === null) {
      data.statutoryDueAt = null
    } else if (typeof body.statutoryDueAt === "string") {
      const d = new Date(body.statutoryDueAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `statutoryDueAt`" },
          { status: 400 },
        )
      }
      data.statutoryDueAt = d
    } else {
      return NextResponse.json(
        { error: "Invalid `statutoryDueAt`" },
        { status: 400 },
      )
    }
  }

  // Status transition via the context-aware wrapper. Requires the
  // assigned official's authorityLevel for the escalated→resolved /
  // escalated→denied gate (PR #88).
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const targetStatus = body.status as CaseStatus

    // Resolve the *next* assigned official's authority level. If the
    // same PATCH set/changed the assignee, we already fetched it above
    // (coalesced — single roundtrip). Otherwise, fall back to the
    // existing assignee.
    let assignedAuthorityLevel: "line" | "supervisor" | "director" | null =
      assignedOfficialAuthorityLevel
    if (
      assignedAuthorityLevel === null &&
      body.assignedOfficialId === undefined &&
      nextAssignedOfficialId
    ) {
      const off = await prisma.publicSectorOfficial.findFirst({
        where: { id: nextAssignedOfficialId, organizationId: orgId },
        select: { authorityLevel: true },
      })
      if (off) {
        assignedAuthorityLevel =
          off.authorityLevel as "line" | "supervisor" | "director"
      }
    }

    const result = canTransitionCase(existing.status, body.status, {
      assignedAuthorityLevel,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 },
      )
    }

    // Side-exit reasons must be provided when transitioning to denied
    // / withdrawn. DB CHECK enforces both column + reason non-null.
    if (body.status === "denied") {
      const rationale =
        strField(body.decisionRationale) ?? existing.decisionRationale
      if (!rationale) {
        return NextResponse.json(
          {
            error:
              "`decisionRationale` (non-empty string) is required when transitioning to `denied`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.decisionRationale)
      // Slice-2 PII column wrap: encrypt rationale before persisting.
      if (supplied) {
        data.decisionRationale = encryptForTenantBoundOrNull(orgId, TABLE, "decisionRationale", supplied)
      }
    }
    if (body.status === "withdrawn") {
      const reason =
        strField(body.withdrawalReason) ?? existing.withdrawalReason
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "`withdrawalReason` (non-empty string) is required when transitioning to `withdrawn`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.withdrawalReason)
      if (supplied) {
        data.withdrawalReason = encryptForTenantBoundOrNull(orgId, TABLE, "withdrawalReason", supplied)
      }
    }

    // `assigned`/`in_progress`/`escalated`/`resolved` all require
    // assignedOfficialId NOT NULL via assigned_coherence_check.
    const requiresAssignment =
      STATUS_RANK[targetStatus] >= STATUS_RANK.assigned
    if (requiresAssignment && !nextAssignedOfficialId) {
      return NextResponse.json(
        {
          error: `\`assignedOfficialId\` must be set before transitioning to \`${body.status}\``,
        },
        { status: 400 },
      )
    }

    data.status = body.status

    // Auto-stamp the corresponding column AND backfill any prior
    // forward-stage stamps that this path skipped.
    const now = new Date()
    const targetRank = STATUS_RANK[targetStatus]

    if (targetRank >= STATUS_RANK.intake && !existing.intakeStartedAt) {
      data.intakeStartedAt = now
    }
    if (targetRank >= STATUS_RANK.assigned && !existing.assignedAt) {
      data.assignedAt = now
    }
    if (targetRank >= STATUS_RANK.in_progress && !existing.workStartedAt) {
      data.workStartedAt = now
    }
    if (targetRank >= STATUS_RANK.escalated && !existing.escalatedAt) {
      data.escalatedAt = now
    }
    if (body.status === "resolved" && !existing.resolvedAt) {
      data.resolvedAt = now
    }
    if (body.status === "denied" && !existing.deniedAt) {
      data.deniedAt = now
    }
    if (body.status === "withdrawn" && !existing.withdrawnAt) {
      data.withdrawnAt = now
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
    // metadata: null is explicitly a "clear" semantic — collapses to
    // an empty object (the JSONB column is non-nullable on the schema).
    // null and {} are interchangeable inputs by design.
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const caseRow = await prisma.publicSectorCase.update({
      where: { id },
      data,
      select: {
        id: true,
        caseNumber: true,
        citizenId: true,
        caseType: true,
        status: true,
        priority: true,
        agencySlug: true,
        departmentSlug: true,
        assignedOfficialId: true,
        subject: true,
        statutoryDueAt: true,
        submittedAt: true,
        intakeStartedAt: true,
        assignedAt: true,
        workStartedAt: true,
        escalatedAt: true,
        resolvedAt: true,
        deniedAt: true,
        withdrawnAt: true,
        decisionRationale: true,
        withdrawalReason: true,
        updatedAt: true,
      },
    })

    // Distinguish operator-supplied fields from route-derived
    // auto-stamps (e.g. backfilled `intakeStartedAt`) for the FOIA
    // record. A records-request must show what the operator actually
    // edited, not the side-effects the route layer added.
    const AUTO_STAMP_KEYS = new Set([
      "intakeStartedAt",
      "assignedAt",
      "workStartedAt",
      "escalatedAt",
      "resolvedAt",
      "deniedAt",
      "withdrawnAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter(k => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter(k => AUTO_STAMP_KEYS.has(k))

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: caseRow.id,
      action: "write",
      metadata: {
        bodyFields,
        autoStampedFields:
          autoStampedFields.length > 0 ? autoStampedFields : undefined,
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({ case: caseRow })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`assignedOfficialId`)" },
          { status: 400 },
        )
      }
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A case with this identifier already exists" },
          { status: 409 },
        )
      }
    }
    console.error("[public-sector-cases/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update case" },
      { status: 500 },
    )
  }
})
