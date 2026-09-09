/**
 * R6 Energy & Utilities — metering point roster / create (slice-2-mini).
 *
 * Twenty-first route-layer consumer. Metering points carry PII-
 * adjacent data (service location coords) and accountability rows
 * (which meter belongs to which billing account).
 *
 * Status lifecycle (slice-1 `transitionMeter` helper):
 *   pending_install → active | retired (cancel-before-install)
 *   active → disconnected | retired
 *   disconnected → active (reconnection) | retired
 *   retired — terminal
 *
 * Geo-coord pre-validation: latitude ∈ [-90, 90], longitude ∈ [-180, 180]
 * (matches DB CHECK; route returns friendly 400 instead of opaque 500).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { COMMODITY_TYPES } from "@/lib/energy-utilities/types"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "metering_points"
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

function parseLat(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "number" || !Number.isFinite(v)) return "invalid"
  if (v < -90 || v > 90) return "invalid"
  return v
}

function parseLon(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "number" || !Number.isFinite(v)) return "invalid"
  if (v < -180 || v > 180) return "invalid"
  return v
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const commodityType = searchParams.get("commodityType")
  const utilityCustomerId = searchParams.get("utilityCustomerId")
  const meterNumberSearch = searchParams.get("meterNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    commodityType?: string
    utilityCustomerId?: string
    meterNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (commodityType) where.commodityType = commodityType
  if (utilityCustomerId) where.utilityCustomerId = utilityCustomerId
  if (meterNumberSearch && meterNumberSearch.length >= 2) {
    where.meterNumber = {
      contains: meterNumberSearch,
      mode: "insensitive",
    }
  }

  try {
    const meters = await prisma.meteringPoint.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        utilityCustomerId: true,
        meterNumber: true,
        commodityType: true,
        latitude: true,
        longitude: true,
        manufacturer: true,
        modelNumber: true,
        installedAt: true,
        status: true,
        disconnectedAt: true,
        retiredAt: true,
        tariffPlanSlug: true,
        createdAt: true,
      },
    })
    const hasMore = meters.length > limit
    const rows = hasMore ? meters.slice(0, limit) : meters
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        commodityType: commodityType ?? null,
        utilityCustomerId: utilityCustomerId ?? null,
        searchHit:
          meterNumberSearch !== null && meterNumberSearch.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ meters: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[metering-points] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load metering points" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  utilityCustomerId?: unknown
  meterNumber?: unknown
  commodityType?: unknown
  latitude?: unknown
  longitude?: unknown
  manufacturer?: unknown
  modelNumber?: unknown
  installedAt?: unknown
  tariffPlanSlug?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("energy-utilities", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const utilityCustomerId = trimOrNull(body.utilityCustomerId, 64)
  if (!utilityCustomerId) {
    return NextResponse.json(
      { error: "`utilityCustomerId` is required" },
      { status: 400 },
    )
  }
  const meterNumber = trimOrNull(body.meterNumber, 64)
  if (!meterNumber) {
    return NextResponse.json(
      { error: "`meterNumber` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.commodityType !== "string" ||
    !(COMMODITY_TYPES as readonly string[]).includes(body.commodityType)
  ) {
    return NextResponse.json(
      {
        error: `\`commodityType\` is required and must be one of: ${COMMODITY_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const commodityType = body.commodityType

  const latitude = parseLat(body.latitude)
  if (latitude === "invalid") {
    return NextResponse.json(
      { error: "`latitude` must be a finite number in [-90, 90]" },
      { status: 400 },
    )
  }
  const longitude = parseLon(body.longitude)
  if (longitude === "invalid") {
    return NextResponse.json(
      { error: "`longitude` must be a finite number in [-180, 180]" },
      { status: 400 },
    )
  }
  const installedAt = parseDate(body.installedAt)
  if (installedAt === "invalid") {
    return NextResponse.json(
      { error: "Invalid `installedAt`" },
      { status: 400 },
    )
  }

  // Tenant pre-check on the parent customer.
  const customerCheck = await prisma.utilityCustomer.findFirst({
    where: { id: utilityCustomerId, organizationId: orgId },
    select: { id: true },
  })
  if (!customerCheck) {
    return NextResponse.json(
      { error: "Utility customer not found for this tenant" },
      { status: 404 },
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
    const meter = await prisma.meteringPoint.create({
      data: {
        organizationId: orgId,
        utilityCustomerId,
        meterNumber,
        commodityType,
        latitude,
        longitude,
        manufacturer: trimOrNull(body.manufacturer, 200),
        modelNumber: trimOrNull(body.modelNumber, 64),
        installedAt,
        tariffPlanSlug: trimOrNull(body.tariffPlanSlug, 64),
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        utilityCustomerId: true,
        meterNumber: true,
        commodityType: true,
        status: true,
        installedAt: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: meter.id,
      action: "write",
      metadata: {
        meterNumber: meter.meterNumber,
        utilityCustomerId: meter.utilityCustomerId,
        commodityType: meter.commodityType,
      },
    })

    return NextResponse.json({ meter }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A meter with this `meterNumber` already exists" },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`utilityCustomerId`)" },
          { status: 400 },
        )
      }
    }
    console.error("[metering-points] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create meter" },
      { status: 500 },
    )
  }
})
