/**
 * R6 Energy & Utilities — meter reading roster / create (slice-2-mini).
 *
 * Twenty-fourth route-layer consumer. Meter readings are time-series
 * telemetry — append-only at the DB layer via
 * `meter_readings_no_update_trigger` (migration 20260518130000:346).
 *
 * Corrections happen by inserting a NEW reading with `source:
 * "corrected"` and `supersedesReadingId` pointing at the prior row.
 * `meter_replacement` source begins a fresh monotonic series for a
 * newly-installed meter without requiring supersedesReadingId.
 *
 * READING_SOURCES (DB CHECK):
 *   • manual / amr / ami / estimated — normal sources
 *   • corrected — requires supersedesReadingId NOT NULL
 *   • meter_replacement — new monotonic series, supersedesReadingId
 *                          optional
 *
 * cumulativeValue / intervalValue are Decimal(18,4) — sub-cent
 * precision for revenue calculation.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  READING_SOURCES,
  READING_QUALITIES,
} from "@/lib/energy-utilities/types"

const TABLE = "meter_readings"
const MAX_PAGE_SIZE = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

function parseReadingDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | "invalid" {
  if (v === undefined || v === null) return null
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
  // Decimal(18,4) — up to 4 decimal places.
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 4) return "invalid"
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

export const GET = withRlsAuth("energy-utilities", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const meteringPointId = searchParams.get("meteringPointId")
  const source = searchParams.get("source")
  const quality = searchParams.get("quality")
  const fromRaw = searchParams.get("readingFrom")
  const toRaw = searchParams.get("readingTo")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    meteringPointId?: string
    source?: string
    quality?: string
    readingAt?: { gte?: Date; lte?: Date }
  } = { organizationId: orgId }
  if (meteringPointId) where.meteringPointId = meteringPointId
  if (source) where.source = source
  if (quality) where.quality = quality
  if (fromRaw || toRaw) {
    const range: { gte?: Date; lte?: Date } = {}
    if (fromRaw) {
      const d = parseDate(fromRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `readingFrom`" },
          { status: 400 },
        )
      }
      range.gte = d
    }
    if (toRaw) {
      const d = parseDate(toRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `readingTo`" },
          { status: 400 },
        )
      }
      range.lte = d
    }
    where.readingAt = range
  }

  try {
    const readings = await prisma.meterReading.findMany({
      where,
      orderBy: [{ readingAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        meteringPointId: true,
        source: true,
        readingAt: true,
        cumulativeValue: true,
        intervalValue: true,
        unit: true,
        tariffCode: true,
        quality: true,
        supersedesReadingId: true,
        createdAt: true,
      },
    })
    const hasMore = readings.length > limit
    const rows = hasMore ? readings.slice(0, limit) : readings
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        meteringPointId: meteringPointId ?? null,
        source: source ?? null,
        quality: quality ?? null,
        windowed: !!(fromRaw || toRaw),
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ readings: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[meter-readings] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load readings" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  meteringPointId?: unknown
  source?: unknown
  readingAt?: unknown
  cumulativeValue?: unknown
  intervalValue?: unknown
  unit?: unknown
  tariffCode?: unknown
  quality?: unknown
  supersedesReadingId?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("energy-utilities", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const meteringPointId = trimOrNull(body.meteringPointId, 64)
  if (!meteringPointId) {
    return NextResponse.json(
      { error: "`meteringPointId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.source !== "string" ||
    !(READING_SOURCES as readonly string[]).includes(body.source)
  ) {
    return NextResponse.json(
      {
        error: `\`source\` is required and must be one of: ${READING_SOURCES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const source = body.source

  const readingAt = parseDate(body.readingAt)
  if (readingAt === "invalid" || readingAt === null) {
    return NextResponse.json(
      { error: "Valid `readingAt` (ISO datetime) is required" },
      { status: 400 },
    )
  }

  const cumulativeValue = parseReadingDecimal(body.cumulativeValue)
  if (cumulativeValue === "invalid" || cumulativeValue === null) {
    return NextResponse.json(
      { error: "`cumulativeValue` is required (non-negative, ≤ 4dp)" },
      { status: 400 },
    )
  }
  // intervalValue is signed in principle (negative = back-flow on
  // export-capable meters), but allow non-negative only here for the
  // common case; slice-3 may add allowNegative=true for two-way meters.
  const intervalValue = parseReadingDecimal(body.intervalValue)
  if (intervalValue === "invalid") {
    return NextResponse.json(
      { error: "Invalid `intervalValue` (non-negative, ≤ 4dp)" },
      { status: 400 },
    )
  }

  const unit = trimOrNull(body.unit, 16)
  if (!unit) {
    return NextResponse.json(
      { error: "`unit` is required (1-16 chars)" },
      { status: 400 },
    )
  }

  let quality: string = "raw"
  if (body.quality !== undefined && body.quality !== null) {
    if (
      typeof body.quality !== "string" ||
      !(READING_QUALITIES as readonly string[]).includes(body.quality)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`quality\` — must be one of: ${READING_QUALITIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    quality = body.quality
  }

  // `corrected` source REQUIRES supersedesReadingId. Pre-validate
  // before INSERT (DB CHECK `correction_coherence_check` enforces).
  const supersedesReadingId = trimOrNull(body.supersedesReadingId, 64)
  if (source === "corrected" && !supersedesReadingId) {
    return NextResponse.json(
      {
        error:
          "`supersedesReadingId` is required when `source` is `corrected`",
      },
      { status: 400 },
    )
  }

  // Tenant pre-check on meter + optional superseded reading.
  const [meterCheck, supersedesCheck] = await Promise.all([
    prisma.meteringPoint.findFirst({
      where: { id: meteringPointId, organizationId: orgId },
      select: { id: true },
    }),
    supersedesReadingId
      ? prisma.meterReading.findFirst({
          where: { id: supersedesReadingId, organizationId: orgId },
          select: { id: true, meteringPointId: true },
        })
      : Promise.resolve(null),
  ])
  if (!meterCheck) {
    return NextResponse.json(
      { error: "Metering point not found for this tenant" },
      { status: 404 },
    )
  }
  if (supersedesReadingId && !supersedesCheck) {
    return NextResponse.json(
      { error: "Superseded reading not found for this tenant" },
      { status: 404 },
    )
  }
  // Cross-ref: superseded reading must be on the same meter.
  if (
    supersedesCheck &&
    supersedesCheck.meteringPointId !== meteringPointId
  ) {
    return NextResponse.json(
      {
        error:
          "`supersedesReadingId` belongs to a different metering point — corrections must reference a reading on the same meter",
      },
      { status: 400 },
    )
  }

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

  try {
    const reading = await prisma.meterReading.create({
      data: {
        organizationId: orgId,
        meteringPointId,
        source,
        readingAt,
        cumulativeValue,
        intervalValue,
        unit,
        tariffCode: trimOrNull(body.tariffCode, 64),
        quality,
        supersedesReadingId,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        meteringPointId: true,
        source: true,
        readingAt: true,
        cumulativeValue: true,
        intervalValue: true,
        unit: true,
        quality: true,
        supersedesReadingId: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: reading.id,
      action: "write",
      metadata: {
        meteringPointId: reading.meteringPointId,
        source: reading.source,
        quality: reading.quality,
        supersedesReadingId: reading.supersedesReadingId,
      },
    })

    return NextResponse.json({ reading }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid foreign key (`meteringPointId` / `supersedesReadingId`)",
        },
        { status: 400 },
      )
    }
    console.error("[meter-readings] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create reading" },
      { status: 500 },
    )
  }
})
