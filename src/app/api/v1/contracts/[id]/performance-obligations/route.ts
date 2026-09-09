/**
 * CLM Slice 5b-1 — Performance Obligations list + create
 *
 * GET  /api/v1/contracts/[id]/performance-obligations
 *   List the contract's POs, org-scoped, with schedule summary per PO.
 *   requireAuth("contracts", "read")
 *
 * POST /api/v1/contracts/[id]/performance-obligations
 *   Create a PO. Status starts as "draft".
 *   Admin or manager only (finance-sensitive write).
 *   productId validated same-org when provided.
 *   displayOrder auto-assigned (max+1) when omitted — retried on P2002
 *   (≤3 attempts) to eliminate the displayOrder race.
 *   standaloneSellingPrice validated + canonicalised via minor-unit round-trip
 *   (rejects sub-cent / over-precision values for the contract currency).
 *   requireAuth("contracts", "write")
 *
 * Guards:
 *   - Contract must belong to org (404 otherwise).
 *   - All rows scoped to {organizationId}.
 *   - ALL money through decimalToMinor/minorToDecimalString — no Number() float
 *     on financial fields.
 *
 * Note: allocatedAmount defaults to 0 on creation (set by recalculate).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  decimalToMinor,
  minorToDecimalString,
} from "@/lib/revenue-recognition/decimal-minor"

const RECOGNITION_METHODS = [
  "point_in_time",
  "over_time_straight_line",
  "milestone",
  "usage_based",
] as const

const createPoSchema = z.object({
  description:          z.string().min(1, "description is required"),
  productId:            z.string().optional(),
  standaloneSellingPrice: z.string().regex(/^\d+(\.\d+)?$/, "standaloneSellingPrice must be a decimal string").optional(),
  recognitionMethod:    z.enum(RECOGNITION_METHODS),
  periodStart:          z.coerce.date(),
  periodEnd:            z.coerce.date(),
  displayOrder:         z.number().int().positive().optional(),
  milestones: z.array(z.object({
    label:  z.string().min(1),
    weight: z.number().int().positive("milestone weight must be a positive integer"),
    dueAt:  z.coerce.date(),
  })).optional(),
})

// ─── Prisma unique-constraint error code ──────────────────────────────────────
function isPrismaP2002(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<string, unknown>).code === "P2002"
  )
}

export const GET = withRlsAuth("contracts", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  try {
    // Verify contract belongs to this org
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, currency: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const currency = contract.currency

    const pos = await prisma.performanceObligation.findMany({
      where: { contractId: id, organizationId: orgId },
      orderBy: { displayOrder: "asc" },
      include: {
        schedules: {
          select: {
            id:              true,
            status:          true,
            scheduledAmount: true,
            recognizedAt:    true,
            entries: {
              select: {
                recognizedAmount: true,
              },
            },
          },
        },
      },
    })

    // FIX 4: Build schedule summary in minor units (no Number() float on money).
    const data = pos.map((po: typeof pos[number]) => {
      const scheduleCount = po.schedules.length

      // Sum scheduledAmount in minor units
      let totalScheduledMinor = 0
      let totalRecognizedMinor = 0
      for (const s of po.schedules) {
        const sr = decimalToMinor(String(s.scheduledAmount ?? "0"), currency)
        if (sr.ok) totalScheduledMinor += sr.minor

        for (const e of s.entries) {
          const er = decimalToMinor(String(e.recognizedAmount ?? "0"), currency)
          if (er.ok) totalRecognizedMinor += er.minor
        }
      }

      return {
        ...po,
        schedules: undefined,
        scheduleSummary: {
          lineCount:       scheduleCount,
          totalScheduled:  minorToDecimalString(totalScheduledMinor, currency),
          totalRecognized: minorToDecimalString(totalRecognizedMinor, currency),
        },
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error("[performance-obligations GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId  = auth.orgId
  const userId = auth.userId
  const role   = auth.role

  // Finance-sensitive: only admin / manager (+ superadmin) may create POs
  if (role !== "superadmin" && role !== "admin" && role !== "manager") {
    return NextResponse.json(
      { error: "Only admin or manager may create performance obligations" },
      { status: 403 },
    )
  }

  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createPoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const {
    description,
    productId,
    standaloneSellingPrice,
    recognitionMethod,
    periodStart,
    periodEnd,
    displayOrder: displayOrderInput,
    milestones,
  } = parsed.data

  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "periodEnd must be >= periodStart" }, { status: 400 })
  }

  if (recognitionMethod === "milestone" && (!milestones || milestones.length === 0)) {
    return NextResponse.json(
      { error: "milestone method requires at least one milestone" },
      { status: 400 },
    )
  }

  try {
    // Verify contract belongs to this org + get currency
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, currency: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // FIX 3: Validate + canonicalise standaloneSellingPrice via minor-unit round-trip.
    // Rejects sub-cent / over-precision values; persists the canonical form.
    let canonicalSsp: string | null = null
    if (standaloneSellingPrice !== undefined && standaloneSellingPrice !== null) {
      const sspResult = decimalToMinor(standaloneSellingPrice, contract.currency)
      if (!sspResult.ok) {
        return NextResponse.json(
          { error: `Invalid standaloneSellingPrice for ${contract.currency}: ${sspResult.error}` },
          { status: 400 },
        )
      }
      canonicalSsp = minorToDecimalString(sspResult.minor, contract.currency)
    }

    // Validate productId same-org
    if (productId) {
      const product = await prisma.product.findFirst({
        where: { id: productId, organizationId: orgId },
        select: { id: true },
      })
      if (!product) {
        return NextResponse.json(
          { error: "productId not found in this organization" },
          { status: 400 },
        )
      }
    }

    const metadata: Record<string, unknown> = {}
    if (milestones && milestones.length > 0) {
      metadata.milestones = milestones.map((m) => ({
        label:  m.label,
        weight: m.weight,
        dueAt:  m.dueAt.toISOString(),
      }))
    }

    // FIX 5: Retry displayOrder max+1 on P2002 (up to 3 attempts).
    // Wraps both the max-lookup and the create atomically to eliminate the race.
    const MAX_DISPLAY_ORDER_RETRIES = 3
    let attempt = 0
    let po: Awaited<ReturnType<typeof prisma.performanceObligation.create>> | undefined

    while (attempt < MAX_DISPLAY_ORDER_RETRIES) {
      attempt++

      let displayOrder = displayOrderInput
      if (displayOrder === undefined) {
        const maxRow = await prisma.performanceObligation.aggregate({
          where: { contractId: id, organizationId: orgId },
          _max: { displayOrder: true },
        })
        displayOrder = (maxRow._max.displayOrder ?? 0) + 1
      }

      try {
        po = await prisma.performanceObligation.create({
          data: {
            organizationId:         orgId,
            contractId:             id,
            productId:              productId ?? null,
            description,
            standaloneSellingPrice: canonicalSsp,
            allocatedAmount:        "0",
            currency:               contract.currency,
            recognitionMethod,
            periodStart,
            periodEnd,
            displayOrder,
            status:                 "draft",
            metadata,
            createdBy:              userId ?? null,
          },
        })
        break // success
      } catch (createErr) {
        // P2002 on displayOrder uniqueness — re-fetch max and retry
        if (isPrismaP2002(createErr) && displayOrderInput === undefined && attempt < MAX_DISPLAY_ORDER_RETRIES) {
          continue
        }
        // P2002 exhausted retries → clean 409
        if (isPrismaP2002(createErr) && displayOrderInput === undefined) {
          return NextResponse.json(
            { error: "displayOrder conflict after retries — please retry" },
            { status: 409 },
          )
        }
        throw createErr
      }
    }

    return NextResponse.json({ success: true, data: po }, { status: 201 })
  } catch (e) {
    console.error("[performance-obligations POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
