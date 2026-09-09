/**
 * R6 Energy & Utilities — metering point per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — three-way handling + transitionMeter slice-1 helper.
 *   STATUS_RANK backfill ensures `installedAt NOT NULL` for any
 *   transition to active/disconnected/retired (DB CHECK
 *   `installed_coherence_check`).
 *
 *   Edge case: `pending_install → retired` (cancel-before-install)
 *   still requires installedAt per the CHECK. Route backfills
 *   installedAt = now() with the documented compromise that
 *   "installedAt" means "lifecycle began at" rather than literal
 *   physical-install time. Slice-3 may add a separate
 *   `cancelledBeforeInstallAt` column.
 *
 * Immutable on PATCH:
 *   • utilityCustomerId — re-parenting a meter to a different account
 *                          forges billing attribution
 *   • commodityType     — meter hardware can't switch commodity
 *
 * DELETE NOT exposed — meters referenced by historical readings;
 * use status=retired.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionMeter } from "@/lib/energy-utilities/state-machine"
import { type MeterStatus } from "@/lib/energy-utilities/types"
import { withRlsAuth } from "@/lib/with-rls"

const TABLE = "metering_points"

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseLat(v: unknown): number | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "number" || !Number.isFinite(v)) return "invalid"
  if (v < -90 || v > 90) return "invalid"
  return v
}

function parseLon(v: unknown): number | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "number" || !Number.isFinite(v)) return "invalid"
  if (v < -180 || v > 180) return "invalid"
  return v
}

const STATUS_RANK: Record<MeterStatus, number> = {
  pending_install: 0,
  active: 1,
  disconnected: 2,
  retired: 3,
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing meter id" }, { status: 400 })
  }

  try {
    const meter = await prisma.meteringPoint.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!meter) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Meter not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: meter.id,
      action: "read",
      metadata: {
        meterNumber: meter.meterNumber,
        utilityCustomerId: meter.utilityCustomerId,
        commodityType: meter.commodityType,
        status: meter.status,
      },
    })

    return NextResponse.json({ meter })
  } catch (err) {
    console.error("[metering-points/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load meter" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  latitude?: unknown
  longitude?: unknown
  manufacturer?: unknown
  modelNumber?: unknown
  installedAt?: unknown
  tariffPlanSlug?: unknown
  status?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("energy-utilities", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing meter id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.meteringPoint.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      installedAt: true,
      disconnectedAt: true,
      retiredAt: true,
    },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Meter not found" },
      { status: 404 },
    )
  }

  const data: {
    latitude?: number | null
    longitude?: number | null
    manufacturer?: string | null
    modelNumber?: string | null
    installedAt?: Date | null
    tariffPlanSlug?: string | null
    status?: string
    disconnectedAt?: Date
    retiredAt?: Date
    metadata?: unknown
  } = {}

  if (body.latitude !== undefined) {
    const v = parseLat(body.latitude)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "`latitude` must be a finite number in [-90, 90]" },
        { status: 400 },
      )
    }
    if (v !== undefined) data.latitude = v
  }
  if (body.longitude !== undefined) {
    const v = parseLon(body.longitude)
    if (v === "invalid") {
      return NextResponse.json(
        { error: "`longitude` must be a finite number in [-180, 180]" },
        { status: 400 },
      )
    }
    if (v !== undefined) data.longitude = v
  }
  if (body.manufacturer !== undefined) {
    const v = strField(body.manufacturer, 200)
    if (v !== undefined) data.manufacturer = v
  }
  if (body.modelNumber !== undefined) {
    const v = strField(body.modelNumber, 64)
    if (v !== undefined) data.modelNumber = v
  }
  if (body.tariffPlanSlug !== undefined) {
    const v = strField(body.tariffPlanSlug, 64)
    if (v !== undefined) data.tariffPlanSlug = v
  }
  if (body.installedAt !== undefined) {
    if (body.installedAt === null) {
      // Cannot clear installedAt if status is active/disconnected/retired.
      if (
        existing.status === "active" ||
        existing.status === "disconnected" ||
        existing.status === "retired"
      ) {
        return NextResponse.json(
          {
            error: `\`installedAt\` cannot be cleared while status is \`${existing.status}\``,
          },
          { status: 400 },
        )
      }
      data.installedAt = null
    } else if (typeof body.installedAt === "string") {
      const d = new Date(body.installedAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `installedAt`" },
          { status: 400 },
        )
      }
      data.installedAt = d
    } else {
      return NextResponse.json(
        { error: "Invalid `installedAt`" },
        { status: 400 },
      )
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionMeter(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    data.status = body.status
    const now = new Date()
    const target = body.status as MeterStatus
    const targetRank = STATUS_RANK[target]

    // installed_coherence_check: status IN (active, disconnected,
    // retired) → installedAt NOT NULL. Backfill if missing.
    // Edge: pending_install → retired (cancel-before-install) still
    // hits this CHECK; route backfills installedAt = now() to satisfy
    // the constraint. The semantic compromise ("never physically
    // installed but installedAt set") is documented in the route file
    // header.
    if (targetRank >= STATUS_RANK.active && !existing.installedAt) {
      data.installedAt = now
    }
    if (body.status === "disconnected" && !existing.disconnectedAt) {
      data.disconnectedAt = now
    }
    if (body.status === "retired" && !existing.retiredAt) {
      data.retiredAt = now
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
    const meter = await prisma.meteringPoint.update({
      where: { id },
      data,
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
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "disconnectedAt",
      "retiredAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: meter.id,
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

    return NextResponse.json({ meter })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A meter with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[metering-points/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update meter" },
      { status: 500 },
    )
  }
})
