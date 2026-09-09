/**
 * R2 Health — medical record roster / create (slice-2-mini).
 *
 * Append-only by design — `health_medical_records_no_update_trigger`
 * (migration `20260519230000_fix_health_fk_order:378-382`) rejects
 * every UPDATE at the DB layer. The route surface therefore exposes
 * only GET + POST; there is no PATCH and no DELETE — corrections
 * are made by appending a new record (e.g. an `addendum` type) that
 * references the prior one via `metadata.supersedes`.
 *
 * HIPAA: the per-record `sensitivity` column (`normal | sensitive |
 * restricted`) is the per-row 42 CFR Part 2 / mental-health analogue.
 * Slice-2 access-control on `restricted` reads is a follow-up; today
 * the audit row carries the sensitivity tag so a records-request can
 * answer "did this reader open any restricted records?".
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  MEDICAL_RECORD_TYPES,
  MEDICAL_RECORD_SEVERITIES,
  MEDICAL_RECORD_SENSITIVITIES,
  type MedicalRecordType,
  type MedicalRecordSeverity,
  type MedicalRecordSensitivity,
} from "@/lib/health/types"
import { validateMedicalRecord } from "@/lib/health/medical-record-validator"
import {
  encryptForTenantOrNull,
  softDecryptForTenant,
} from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "health_medical_records"
const MAX_PAGE_SIZE = 200
const MAX_NOTES_LEN = 20_000

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

export const GET = withRlsAuth("health", "read", async (req: NextRequest, auth, _ctx) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const patientId = searchParams.get("patientId")
  const encounterId = searchParams.get("encounterId")
  const recordedByProviderId = searchParams.get("recordedByProviderId")
  const recordType = searchParams.get("recordType")
  const severity = searchParams.get("severity")
  const sensitivity = searchParams.get("sensitivity")
  const fromRaw = searchParams.get("recordedFrom")
  const toRaw = searchParams.get("recordedTo")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    patientId?: string
    encounterId?: string
    recordedByProviderId?: string
    recordType?: string
    severity?: string
    sensitivity?: string
    recordedAt?: { gte?: Date; lte?: Date }
  } = { organizationId: orgId }
  if (patientId) where.patientId = patientId
  if (encounterId) where.encounterId = encounterId
  if (recordedByProviderId) where.recordedByProviderId = recordedByProviderId
  if (recordType) where.recordType = recordType
  if (severity) where.severity = severity
  if (sensitivity) where.sensitivity = sensitivity

  if (fromRaw || toRaw) {
    const range: { gte?: Date; lte?: Date } = {}
    if (fromRaw) {
      const d = parseDate(fromRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `recordedFrom`" },
          { status: 400 },
        )
      }
      range.gte = d
    }
    if (toRaw) {
      const d = parseDate(toRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `recordedTo`" },
          { status: 400 },
        )
      }
      range.lte = d
    }
    where.recordedAt = range
  }

  try {
    const records = await prisma.healthMedicalRecord.findMany({
      where,
      orderBy: [{ recordedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        recordedByProviderId: true,
        recordType: true,
        recordedAt: true,
        severity: true,
        sensitivity: true,
        createdAt: true,
      },
    })
    const hasMore = records.length > limit
    const rows = hasMore ? records.slice(0, limit) : records
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    // Sensitivity tagging — the audit row surfaces whether the reader
    // touched restricted records so a records-request can answer
    // "did this reader open any restricted-class data?". Slice-2
    // follow-up adds an access-control gate (today the route returns
    // restricted records to any authorized reader).
    const restrictedCount = rows.filter(
      (r: { sensitivity: string }) => r.sensitivity === "restricted",
    ).length

    // Log raw filter strings only if they're enum-valid (audit-log
    // pollution guard — arbitrary `?recordType=<10KB>` should not
    // land in the audit row).
    const safeEnum = <T extends readonly string[]>(
      list: T,
      v: string | null,
    ): string | null => (v && list.includes(v as T[number]) ? v : null)

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        patientId: patientId ?? null,
        encounterId: encounterId ?? null,
        recordedByProviderId: recordedByProviderId ?? null,
        recordType: safeEnum(MEDICAL_RECORD_TYPES, recordType),
        severity: safeEnum(MEDICAL_RECORD_SEVERITIES, severity),
        sensitivity: safeEnum(MEDICAL_RECORD_SENSITIVITIES, sensitivity),
        windowed: !!(fromRaw || toRaw),
        rowCount: rows.length,
        restrictedCount,
      },
    })

    return NextResponse.json({ records: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[health-medical-records] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load records" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  patientId?: unknown
  encounterId?: unknown
  recordedByProviderId?: unknown
  recordType?: unknown
  recordedAt?: unknown
  details?: unknown
  clinicianNotes?: unknown
  severity?: unknown
  sensitivity?: unknown
  metadata?: unknown
}

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

export const POST = withRlsAuth("health", "write", async (req: NextRequest, auth, _ctx) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const patientId = trimOrNull(body.patientId, 64)
  if (!patientId) {
    return NextResponse.json(
      { error: "`patientId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.recordType !== "string" ||
    !(MEDICAL_RECORD_TYPES as readonly string[]).includes(body.recordType)
  ) {
    return NextResponse.json(
      {
        error: `\`recordType\` is required and must be one of: ${MEDICAL_RECORD_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const recordType = body.recordType
  const recordedAt = parseDate(body.recordedAt)
  if (recordedAt === "invalid" || recordedAt === null) {
    return NextResponse.json(
      { error: "Valid `recordedAt` (ISO datetime) is required" },
      { status: 400 },
    )
  }

  let severity: string = "informational"
  if (body.severity !== undefined && body.severity !== null) {
    if (
      typeof body.severity !== "string" ||
      !(MEDICAL_RECORD_SEVERITIES as readonly string[]).includes(body.severity)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`severity\` — must be one of: ${MEDICAL_RECORD_SEVERITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    severity = body.severity
  }

  let sensitivity: string = "normal"
  if (body.sensitivity !== undefined && body.sensitivity !== null) {
    if (
      typeof body.sensitivity !== "string" ||
      !(MEDICAL_RECORD_SENSITIVITIES as readonly string[]).includes(
        body.sensitivity,
      )
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`sensitivity\` — must be one of: ${MEDICAL_RECORD_SENSITIVITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    sensitivity = body.sensitivity
  }

  // Tenant pre-check on patient, encounter, provider.
  const encounterId = trimOrNull(body.encounterId, 64)
  const recordedByProviderId = trimOrNull(body.recordedByProviderId, 64)

  const [patientCheck, encCheck, provCheck] = await Promise.all([
    prisma.healthPatient.findFirst({
      where: { id: patientId, organizationId: orgId },
      select: { id: true },
    }),
    encounterId
      ? prisma.healthEncounter.findFirst({
          where: { id: encounterId, organizationId: orgId },
          select: { id: true, patientId: true },
        })
      : Promise.resolve(null),
    recordedByProviderId
      ? prisma.healthProvider.findFirst({
          where: { id: recordedByProviderId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if (!patientCheck) {
    return NextResponse.json(
      { error: "Patient not found for this tenant" },
      { status: 404 },
    )
  }
  if (encounterId && !encCheck) {
    return NextResponse.json(
      { error: "Encounter not found for this tenant" },
      { status: 404 },
    )
  }
  if (encounterId && encCheck && encCheck.patientId !== patientId) {
    return NextResponse.json(
      {
        error:
          "`encounterId` does not belong to the supplied `patientId` (cross-patient record-attribution bug)",
      },
      { status: 400 },
    )
  }
  if (recordedByProviderId && !provCheck) {
    return NextResponse.json(
      { error: "Provider not found for this tenant" },
      { status: 404 },
    )
  }

  // metadata: plain object only (no arrays / primitives).
  // Details validation is delegated to `validateMedicalRecord` below
  // — that helper enforces per-type required fields, plain-object
  // shape, and prototype-chain pollution guard.
  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  // Per-type details validation. Slice-1 ships `validateMedicalRecord`
  // (`src/lib/health/medical-record-validator.ts`) — enforces per-type
  // required-keys, no-extra-keys, plain-object shape, prototype-
  // pollution guards. Slice-2 wires it at the route boundary so the
  // INSERT never lands a malformed payload.
  const validation = validateMedicalRecord({
    recordType: recordType as MedicalRecordType,
    details: body.details ?? {},
    severity: severity as MedicalRecordSeverity,
    sensitivity: sensitivity as MedicalRecordSensitivity,
  })
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: `Invalid \`details\`: ${validation.error}`,
        field: validation.field,
      },
      { status: 400 },
    )
  }

  try {
    const record = await prisma.healthMedicalRecord.create({
      data: {
        organizationId: orgId,
        patientId,
        encounterId,
        recordedByProviderId,
        recordType,
        recordedAt,
        details: (body.details ?? {}) as Prisma.InputJsonValue,
        // Slice-2 PII column wrap: clinicianNotes is free-text PHI;
        // encrypt at the route boundary. Read paths soft-decrypt.
        clinicianNotes: encryptForTenantOrNull(
          orgId,
          trimOrNull(body.clinicianNotes, MAX_NOTES_LEN),
        ),
        severity,
        sensitivity,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        patientId: true,
        encounterId: true,
        recordedByProviderId: true,
        recordType: true,
        recordedAt: true,
        severity: true,
        sensitivity: true,
        createdAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: record.id,
      action: "write",
      metadata: {
        patientId: record.patientId,
        encounterId: record.encounterId,
        recordedByProviderId: record.recordedByProviderId,
        recordType: record.recordType,
        severity: record.severity,
        sensitivity: record.sensitivity,
      },
    })

    return NextResponse.json({ record }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid foreign key (`patientId` / `encounterId` / `recordedByProviderId`)",
        },
        { status: 400 },
      )
    }
    console.error("[health-medical-records] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create record" },
      { status: 500 },
    )
  }
})
