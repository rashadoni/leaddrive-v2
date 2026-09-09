/**
 * R11 Media — consumption event ingestion (slice-2-mini).
 *
 * Twenty-fifth route-layer consumer. Consumption events are
 * append-only telemetry — every view / click / conversion / share
 * lands as a row, never mutated.
 *
 * Append-only at DB layer via
 * `media_consumption_events_no_update_trigger`. No PATCH/DELETE.
 *
 * EVENT_KINDS (view_start / view_progress / view_complete /
 * view_abandon / click / conversion / share / bookmark) drive the
 * R11 daily-rollup aggregator (PR #86).
 *
 * Audit via `recordPiiAccessFromRequest` — events expose subscriber
 * behavior (PII concern under GDPR).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  EVENT_KINDS,
  DEVICE_KINDS,
} from "@/lib/media/types"

const TABLE = "media_consumption_events"
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

function parseProgressPct(v: unknown): Prisma.Decimal | null | "invalid" {
  if (v === undefined || v === null) return null
  let n: number
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    n = v
  } else if (typeof v === "string") {
    const trimmed = v.trim()
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return "invalid"
    const dot = trimmed.indexOf(".")
    if (dot !== -1 && trimmed.length - dot - 1 > 2) return "invalid"
    n = Number(trimmed)
    if (!Number.isFinite(n)) return "invalid"
  } else {
    return "invalid"
  }
  if (n < 0 || n > 100) return "invalid"
  return new Prisma.Decimal(n.toFixed(2))
}

function parseNonNegInt(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v
  return "invalid"
}

export const GET = withRlsAuth("media", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const subscriberId = searchParams.get("subscriberId")
  const contentId = searchParams.get("contentId")
  const placementId = searchParams.get("placementId")
  const eventKind = searchParams.get("eventKind")
  const deviceKind = searchParams.get("deviceKind")
  const fromRaw = searchParams.get("occurredFrom")
  const toRaw = searchParams.get("occurredTo")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    subscriberId?: string
    contentId?: string
    placementId?: string
    eventKind?: string
    deviceKind?: string
    occurredAt?: { gte?: Date; lte?: Date }
  } = { organizationId: orgId }
  if (subscriberId) where.subscriberId = subscriberId
  if (contentId) where.contentId = contentId
  if (placementId) where.placementId = placementId
  if (eventKind) where.eventKind = eventKind
  if (deviceKind) where.deviceKind = deviceKind
  if (fromRaw || toRaw) {
    const range: { gte?: Date; lte?: Date } = {}
    if (fromRaw) {
      const d = parseDate(fromRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `occurredFrom`" },
          { status: 400 },
        )
      }
      range.gte = d
    }
    if (toRaw) {
      const d = parseDate(toRaw)
      if (d === "invalid" || d === null) {
        return NextResponse.json(
          { error: "Invalid `occurredTo`" },
          { status: 400 },
        )
      }
      range.lte = d
    }
    where.occurredAt = range
  }

  try {
    const events = await prisma.mediaConsumptionEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        subscriberId: true,
        contentId: true,
        placementId: true,
        eventKind: true,
        occurredAt: true,
        progressPct: true,
        engagedSeconds: true,
        deviceKind: true,
        regionCode: true,
        createdAt: true,
      },
    })
    const hasMore = events.length > limit
    const rows = hasMore ? events.slice(0, limit) : events
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        subscriberId: subscriberId ?? null,
        contentId: contentId ?? null,
        placementId: placementId ?? null,
        eventKind: eventKind ?? null,
        deviceKind: deviceKind ?? null,
        windowed: !!(fromRaw || toRaw),
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ events: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[media-consumption-events] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load events" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  subscriberId?: unknown
  contentId?: unknown
  placementId?: unknown
  eventKind?: unknown
  occurredAt?: unknown
  progressPct?: unknown
  engagedSeconds?: unknown
  deviceKind?: unknown
  regionCode?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("media", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const contentId = trimOrNull(body.contentId, 64)
  if (!contentId) {
    return NextResponse.json(
      { error: "`contentId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.eventKind !== "string" ||
    !(EVENT_KINDS as readonly string[]).includes(body.eventKind)
  ) {
    return NextResponse.json(
      {
        error: `\`eventKind\` is required and must be one of: ${EVENT_KINDS.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const eventKind = body.eventKind

  const occurredAt = parseDate(body.occurredAt)
  if (occurredAt === "invalid" || occurredAt === null) {
    return NextResponse.json(
      { error: "Valid `occurredAt` (ISO datetime) is required" },
      { status: 400 },
    )
  }

  let deviceKind: string = "web"
  if (body.deviceKind !== undefined && body.deviceKind !== null) {
    if (
      typeof body.deviceKind !== "string" ||
      !(DEVICE_KINDS as readonly string[]).includes(body.deviceKind)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`deviceKind\` — must be one of: ${DEVICE_KINDS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    deviceKind = body.deviceKind
  }

  const progressPct = parseProgressPct(body.progressPct)
  if (progressPct === "invalid") {
    return NextResponse.json(
      { error: "Invalid `progressPct` (0..100, ≤ 2dp)" },
      { status: 400 },
    )
  }
  const engagedSeconds = parseNonNegInt(body.engagedSeconds)
  if (engagedSeconds === "invalid") {
    return NextResponse.json(
      { error: "Invalid `engagedSeconds` (non-negative integer)" },
      { status: 400 },
    )
  }

  let regionCode: string | null = null
  if (body.regionCode !== undefined && body.regionCode !== null) {
    if (
      typeof body.regionCode !== "string" ||
      !/^[A-Z]{2}$/.test(body.regionCode.toUpperCase())
    ) {
      return NextResponse.json(
        {
          error: "`regionCode` must be a 2-letter ISO 3166-1 alpha-2 code",
        },
        { status: 400 },
      )
    }
    regionCode = body.regionCode.toUpperCase()
  }

  const subscriberId = trimOrNull(body.subscriberId, 64)
  const placementId = trimOrNull(body.placementId, 64)

  // Tenant pre-check on content + optional subscriber + optional placement.
  const [contentCheck, subscriberCheck, placementCheck] = await Promise.all([
    prisma.mediaContentInventory.findFirst({
      where: { id: contentId, organizationId: orgId },
      select: { id: true },
    }),
    subscriberId
      ? prisma.mediaSubscriber.findFirst({
          where: { id: subscriberId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
    placementId
      ? prisma.mediaAdPlacement.findFirst({
          where: { id: placementId, organizationId: orgId },
          select: { id: true, contentId: true },
        })
      : Promise.resolve(null),
  ])
  if (!contentCheck) {
    return NextResponse.json(
      { error: "Content not found for this tenant" },
      { status: 404 },
    )
  }
  if (subscriberId && !subscriberCheck) {
    return NextResponse.json(
      { error: "Subscriber not found for this tenant" },
      { status: 404 },
    )
  }
  if (placementId && !placementCheck) {
    return NextResponse.json(
      { error: "Placement not found for this tenant" },
      { status: 404 },
    )
  }
  // Cross-ref: placement must reference the same content (if it links
  // to content at all — placement.contentId is optional).
  if (
    placementCheck &&
    placementCheck.contentId !== null &&
    placementCheck.contentId !== contentId
  ) {
    return NextResponse.json(
      {
        error:
          "`placementId` is bound to a different content item than supplied `contentId`",
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
    const event = await prisma.mediaConsumptionEvent.create({
      data: {
        organizationId: orgId,
        subscriberId,
        contentId,
        placementId,
        eventKind,
        occurredAt,
        progressPct,
        engagedSeconds,
        deviceKind,
        regionCode,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        subscriberId: true,
        contentId: true,
        placementId: true,
        eventKind: true,
        occurredAt: true,
        progressPct: true,
        engagedSeconds: true,
        deviceKind: true,
        regionCode: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: event.id,
      action: "write",
      metadata: {
        contentId: event.contentId,
        subscriberId: event.subscriberId,
        placementId: event.placementId,
        eventKind: event.eventKind,
        deviceKind: event.deviceKind,
      },
    })

    return NextResponse.json({ event }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid foreign key (`contentId` / `subscriberId` / `placementId`)",
        },
        { status: 400 },
      )
    }
    console.error("[media-consumption-events] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 },
    )
  }
})
