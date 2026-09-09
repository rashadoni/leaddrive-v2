/**
 * R2 Health — encounter roster / create (slice-2-mini).
 *
 * Fourth route-layer consumer of `recordPhiAccessFromRequest` after
 * PR #93 R2 health-patients (PR #93). Patients first, encounters next —
 * encounters reference a patient by FK, and every read still trips
 * the HIPAA minimum-necessary audit even though the row itself
 * doesn't carry name/DoB.
 *
 * Status lifecycle (slice-1 helper `transitionEncounter`):
 *   scheduled → checked_in → in_progress → completed
 *   (no_show / cancelled side exits, all terminal)
 *
 * Timestamp-write contract: PATCH layer auto-stamps `checkedInAt /
 * startedAt / completedAt / cancelledAt / noShowAt` per the contract
 * documented in `src/lib/health/types.ts`. DB CHECK constraint
 * `health_encounters_no_show_at_coherence_check` rejects writes that
 * skip the timestamp, so the auto-stamp is mandatory.
 *
 * Encryption note: same plan as patients — column-by-column wrap in a
 * follow-up. Operators MUST NOT load real PHI until the wrap pass
 * completes for every PHI column on this table.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { ENCOUNTER_TYPES } from "@/lib/health/types"
import { encryptForTenantOrNull } from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "health_encounters"
const MAX_PAGE_SIZE = 200
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

export const GET = withRlsAuth("health", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const encounterType = searchParams.get("encounterType")
  const patientId = searchParams.get("patientId")
  const providerId = searchParams.get("providerId")
  const fromRaw = searchParams.get("scheduledFrom")
  const toRaw = searchParams.get("scheduledTo")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    encounterType?: string
    patientId?: string
    providerId?: string
    scheduledStartAt?: { gte?: Date; lte?: Date }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (encounterType) where.encounterType = encounterType
  if (patientId) where.patientId = patientId
  if (providerId) where.providerId = providerId

  if (fromRaw || toRaw) {
    const range: { gte?: Date; lte?: Date } = {}
    if (fromRaw) {
      const d = parseDate(fromRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `scheduledFrom`" },
          { status: 400 },
        )
      }
      range.gte = d
    }
    if (toRaw) {
      const d = parseDate(toRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `scheduledTo`" },
          { status: 400 },
        )
      }
      range.lte = d
    }
    where.scheduledStartAt = range
  }

  try {
    const encounters = await prisma.healthEncounter.findMany({
      where,
      orderBy: [{ scheduledStartAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        location: true,
        reason: true,
        createdAt: true,
      },
    })
    const hasMore = encounters.length > limit
    const rows = hasMore ? encounters.slice(0, limit) : encounters
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        encounterType: encounterType ?? null,
        patientId: patientId ?? null,
        providerId: providerId ?? null,
        windowed: !!(fromRaw || toRaw),
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ encounters: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[health-encounters] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load encounters" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  patientId?: unknown
  providerId?: unknown
  encounterType?: unknown
  reason?: unknown
  scheduledStartAt?: unknown
  scheduledEndAt?: unknown
  location?: unknown
}

export const POST = withRlsAuth("health", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const patientId = strField(body.patientId, 64)
  if (!patientId) {
    return NextResponse.json(
      { error: "`patientId` is required" },
      { status: 400 },
    )
  }
  const providerId = strField(body.providerId, 64)
  if (!providerId) {
    return NextResponse.json(
      { error: "`providerId` is required" },
      { status: 400 },
    )
  }
  const startRaw = parseDate(body.scheduledStartAt)
  if (startRaw === "invalid" || startRaw === null) {
    return NextResponse.json(
      { error: "Valid `scheduledStartAt` (ISO datetime) is required" },
      { status: 400 },
    )
  }
  const endRaw = parseDate(body.scheduledEndAt)
  if (endRaw === "invalid" || endRaw === null) {
    return NextResponse.json(
      { error: "Valid `scheduledEndAt` (ISO datetime) is required" },
      { status: 400 },
    )
  }
  if (endRaw.getTime() <= startRaw.getTime()) {
    return NextResponse.json(
      { error: "`scheduledEndAt` must be after `scheduledStartAt`" },
      { status: 400 },
    )
  }

  let encounterType: string = "in_person"
  if (body.encounterType !== undefined && body.encounterType !== null) {
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
    encounterType = body.encounterType
  }

  // Tenant isolation pre-check: verify the patient + provider belong
  // to the caller's org. Without this, the FK would only enforce
  // cross-tenant-id pointers (which fail), but a same-tenant-but-wrong-
  // org chained POST would slip through if a future schema change
  // dropped the org column. Belt-and-braces.
  try {
    const [patientCheck, providerCheck] = await Promise.all([
      prisma.healthPatient.findFirst({
        where: { id: patientId, organizationId: orgId },
        select: { id: true },
      }),
      prisma.healthProvider.findFirst({
        where: { id: providerId, organizationId: orgId },
        select: { id: true },
      }),
    ])
    if (!patientCheck) {
      return NextResponse.json(
        { error: "Patient not found for this tenant" },
        { status: 404 },
      )
    }
    if (!providerCheck) {
      return NextResponse.json(
        { error: "Provider not found for this tenant" },
        { status: 404 },
      )
    }
  } catch (err) {
    console.error("[health-encounters] tenant pre-check error:", err)
    return NextResponse.json(
      { error: "Failed to create encounter" },
      { status: 500 },
    )
  }

  try {
    const encounter = await prisma.healthEncounter.create({
      data: {
        organizationId: orgId,
        patientId,
        providerId,
        encounterType,
        // Slice-2 PII column wrap: reason describes the visit
        // purpose (e.g. "chest pain", "follow-up: HTN"). PHI.
        reason: encryptForTenantOrNull(orgId, strField(body.reason)),
        scheduledStartAt: startRaw,
        scheduledEndAt: endRaw,
        // Slice-2 PII column wrap: location may contain telehealth
        // URL with PHI-bearing session id, or clinic room number
        // tied to specialty (oncology / psych) — encrypt.
        location: encryptForTenantOrNull(orgId, strField(body.location)),
      },
      select: {
        id: true,
        patientId: true,
        providerId: true,
        encounterType: true,
        status: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        createdAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: encounter.id,
      action: "write",
      metadata: {
        patientId: encounter.patientId,
        providerId: encounter.providerId,
        encounterType: encounter.encounterType,
      },
    })

    return NextResponse.json({ encounter }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Invalid `patientId` or `providerId` (foreign key)" },
        { status: 400 },
      )
    }
    console.error("[health-encounters] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create encounter" },
      { status: 500 },
    )
  }
})
