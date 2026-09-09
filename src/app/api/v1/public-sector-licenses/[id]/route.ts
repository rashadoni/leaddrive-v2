/**
 * R8 Public Sector — license per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (FOIA).
 * PATCH — status transitions via slice-1 `transitionLicense` helper.
 *   Auto-stamps lifecycle columns AND backfills prior chronological
 *   stamps when a path skips a status (e.g. `applied → denied` still
 *   requires `reviewStartedAt` per
 *   `public_sector_licenses_review_coherence_check`).
 *
 *   Transition to `issued` requires `expiresAt` (either already set
 *   or supplied in same PATCH) because
 *   `public_sector_licenses_issued_coherence_check` requires
 *   issuedAt + expiresAt NOT NULL. Route surfaces a 400 instead of
 *   letting Postgres throw a check-violation 500.
 *
 *   `suspended` / `revoked` / `denied` require `decisionRationale`.
 *
 * Immutable on PATCH:
 *   • licenseNumber — institutional identifier
 *   • licenseType   — affects regulatory category + fee rules
 *
 * DELETE intentionally NOT exposed — FOIA + regulatory retention;
 * revocation is a status transition.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordFoiaAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionLicense } from "@/lib/public-sector/state-machine"
import { type LicenseStatus } from "@/lib/public-sector/types"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on
// `decisionRationale` (PATCH side-exit gate on `suspended`/`revoked`
// /`denied` license decisions). AAD binds to (orgId,
// public_sector_licenses, "decisionRationale") — defeats FOIA-
// relevant shuffle into other text columns on the same license.
const TABLE = "public_sector_licenses"

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  let raw: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    raw = String(v)
  } else if (typeof v === "string") {
    raw = v.trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "invalid"
  } else {
    return "invalid"
  }
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 2) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

/**
 * Forward-progression rank. Side exits (denied, expired, suspended,
 * revoked) still require `reviewStartedAt` per
 * `review_coherence_check`, so they're rank 1+ for backfill purposes.
 * `expired/suspended/revoked` are post-issued so they need
 * `issuedAt + expiresAt` already on the row (issued_coherence_check)
 * — those transitions are illegal from `applied`/`under_review` per
 * state-machine, so this is implicit.
 */
const STATUS_RANK: Record<LicenseStatus, number> = {
  applied: 0,
  under_review: 1,
  issued: 2,
  expired: 3,
  suspended: 3,
  revoked: 3,
  denied: 1,
}

export const GET = withRlsAuth("public-sector", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing license id" }, { status: 400 })
  }

  try {
    const license = await prisma.publicSectorLicense.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!license) {
      void recordFoiaAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json({ error: "License not found" }, { status: 404 })
    }

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: license.id,
      action: "read",
      metadata: {
        licenseNumber: license.licenseNumber,
        licenseType: license.licenseType,
        status: license.status,
        citizenId: license.citizenId,
        caseId: license.caseId,
      },
    })

    return NextResponse.json({
      license: {
        ...license,
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          license.decisionRationale,
        ),
      },
    })
  } catch (err) {
    console.error("[public-sector-licenses/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load license" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  issuingOfficialId?: unknown
  expiresAt?: unknown
  feeAmount?: unknown
  feeCurrency?: unknown
  status?: unknown
  decisionRationale?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("public-sector", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing license id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.publicSectorLicense.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      reviewStartedAt: true,
      expiredAt: true,
      suspendedAt: true,
      revokedAt: true,
      deniedAt: true,
      decisionRationale: true,
    },
  })
  if (!existing) {
    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json({ error: "License not found" }, { status: 404 })
  }

  const data: {
    issuingOfficialId?: string | null
    expiresAt?: Date | null
    feeAmount?: Prisma.Decimal
    feeCurrency?: string
    status?: string
    decisionRationale?: string | null
    reviewStartedAt?: Date
    issuedAt?: Date
    expiredAt?: Date
    suspendedAt?: Date
    revokedAt?: Date
    deniedAt?: Date
    metadata?: unknown
  } = {}

  // issuingOfficialId — three-way + tenant pre-check.
  if (body.issuingOfficialId !== undefined) {
    const v = strField(body.issuingOfficialId, 64)
    if (v !== undefined) {
      if (v !== null) {
        const off = await prisma.publicSectorOfficial.findFirst({
          where: { id: v, organizationId: orgId },
          select: { id: true },
        })
        if (!off) {
          return NextResponse.json(
            { error: "Official not found for this tenant" },
            { status: 404 },
          )
        }
      }
      data.issuingOfficialId = v
    }
  }

  // expiresAt — three-way.
  let nextExpiresAt: Date | null = existing.expiresAt
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null) {
      data.expiresAt = null
      nextExpiresAt = null
    } else if (typeof body.expiresAt === "string") {
      const d = new Date(body.expiresAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `expiresAt`" },
          { status: 400 },
        )
      }
      data.expiresAt = d
      nextExpiresAt = d
    } else {
      return NextResponse.json(
        { error: "Invalid `expiresAt`" },
        { status: 400 },
      )
    }
  }

  if (body.feeAmount !== undefined) {
    const v = parseDecimal(body.feeAmount)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "Invalid `feeAmount` (non-negative, ≤ 2dp)" },
        { status: 400 },
      )
    }
    // feeAmount column is NOT NULL — reject explicit `null` instead
    // of silently dropping the field. (DB default is 0; if caller
    // wants to zero out, they must send 0 explicitly.)
    if (v === null) {
      return NextResponse.json(
        { error: "`feeAmount` cannot be cleared (column is non-nullable)" },
        { status: 400 },
      )
    }
    if (v !== undefined) data.feeAmount = v
  }
  if (body.feeCurrency !== undefined) {
    if (typeof body.feeCurrency !== "string") {
      return NextResponse.json(
        { error: "`feeCurrency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    const upper = body.feeCurrency.toUpperCase()
    if (!/^[A-Z]{3}$/.test(upper)) {
      return NextResponse.json(
        { error: "`feeCurrency` must be a 3-letter ISO 4217 code" },
        { status: 400 },
      )
    }
    data.feeCurrency = upper
  }

  // Status transition + backfill.
  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionLicense(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    const target = body.status as LicenseStatus

    // `issued` (and any later forward stage) requires `expiresAt`
    // per `public_sector_licenses_issued_coherence_check`. We
    // auto-stamp `issuedAt`, but `expiresAt` is a domain decision
    // — must be supplied by caller (now or earlier) or 400.
    if (
      STATUS_RANK[target] >= STATUS_RANK.issued &&
      !nextExpiresAt
    ) {
      return NextResponse.json(
        {
          error: `\`expiresAt\` must be set before transitioning to \`${body.status}\``,
        },
        { status: 400 },
      )
    }

    // decisionRationale required for denied, suspended, revoked.
    const requiresRationale =
      body.status === "denied" ||
      body.status === "suspended" ||
      body.status === "revoked"
    if (requiresRationale) {
      const rationale =
        strField(body.decisionRationale, 10_000) ?? existing.decisionRationale
      if (!rationale) {
        return NextResponse.json(
          {
            error: `\`decisionRationale\` (non-empty string) is required when transitioning to \`${body.status}\``,
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.decisionRationale, 10_000)
      // Slice-2 PII column wrap: encrypt rationale before persisting.
      if (supplied) {
        data.decisionRationale = encryptForTenantBoundOrNull(orgId, TABLE, "decisionRationale", supplied)
      }
    }

    data.status = body.status
    const now = new Date()
    const targetRank = STATUS_RANK[target]

    // Backfill reviewStartedAt on any forward path that left `applied`.
    if (
      targetRank >= STATUS_RANK.under_review &&
      !existing.reviewStartedAt
    ) {
      data.reviewStartedAt = now
    }
    // Issuance stamp.
    if (
      targetRank >= STATUS_RANK.issued &&
      !existing.issuedAt
    ) {
      data.issuedAt = now
    }
    // Terminal/secondary lifecycle stamps.
    if (body.status === "expired" && !existing.expiredAt) {
      data.expiredAt = now
    }
    if (body.status === "suspended" && !existing.suspendedAt) {
      data.suspendedAt = now
    }
    if (body.status === "revoked" && !existing.revokedAt) {
      data.revokedAt = now
    }
    if (body.status === "denied" && !existing.deniedAt) {
      data.deniedAt = now
    }
  }

  // Pre-validate DB CHECK `public_sector_licenses_window_check`:
  // `expiresAt > issuedAt` when both set. Catches a caller who
  // either updates `expiresAt` to ≤ existing `issuedAt`, or whose
  // status flip auto-stamped `issuedAt = now` while `expiresAt` is
  // in the past. Without this pre-check, Postgres would throw
  // check-violation → opaque 500.
  const finalIssuedAt = data.issuedAt ?? existing.issuedAt
  if (
    nextExpiresAt &&
    finalIssuedAt &&
    nextExpiresAt.getTime() <= finalIssuedAt.getTime()
  ) {
    return NextResponse.json(
      { error: "`expiresAt` must be after `issuedAt`" },
      { status: 400 },
    )
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
    const license = await prisma.publicSectorLicense.update({
      where: { id },
      data,
      select: {
        id: true,
        licenseNumber: true,
        licenseType: true,
        status: true,
        citizenId: true,
        caseId: true,
        issuingOfficialId: true,
        appliedAt: true,
        reviewStartedAt: true,
        issuedAt: true,
        expiresAt: true,
        expiredAt: true,
        suspendedAt: true,
        revokedAt: true,
        deniedAt: true,
        decisionRationale: true,
        feeAmount: true,
        feeCurrency: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "reviewStartedAt",
      "issuedAt",
      "expiredAt",
      "suspendedAt",
      "revokedAt",
      "deniedAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter(k => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter(k => AUTO_STAMP_KEYS.has(k))

    void recordFoiaAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: license.id,
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

    return NextResponse.json({
      license: {
        ...license,
        decisionRationale: softDecryptForTenantBound(
          orgId,
          TABLE,
          "decisionRationale",
          license.decisionRationale,
        ),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`issuingOfficialId`)" },
          { status: 400 },
        )
      }
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A license with this identifier already exists" },
          { status: 409 },
        )
      }
    }
    console.error("[public-sector-licenses/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update license" },
      { status: 500 },
    )
  }
})
