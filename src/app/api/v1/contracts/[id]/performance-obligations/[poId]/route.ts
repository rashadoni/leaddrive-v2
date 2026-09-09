/**
 * CLM Slice 5b-1 — Performance Obligation single-item operations
 *
 * PATCH /api/v1/contracts/[id]/performance-obligations/[poId]
 *   Update description / SSP / status (state-machine guarded → 409 on
 *   invalid transition) / allocatedAmount override (logged in metadata).
 *   Full-predicate CAS: updateMany({id, organizationId, contractId}).
 *   Admin / manager only.
 *
 *   FIX 2 (recognition lock): before mutating, load the PO's schedules +
 *   entries. If any RevenueRecognitionEntry exists OR any schedule is not
 *   "scheduled" status (i.e. recognized/partially_recognized), the PO has
 *   recognized revenue. Financial fields (standaloneSellingPrice,
 *   allocatedAmount) and cancel transitions are locked → 409.
 *   Non-financial edits (description, valid non-cancel status transitions)
 *   remain allowed.
 *
 *   FIX 3 (minor-unit validation): standaloneSellingPrice + allocatedAmount
 *   are validated + canonicalised via decimalToMinor/minorToDecimalString.
 *   Sub-cent / over-precision values → 400.
 *
 *   requireAuth("contracts", "write")
 *
 * DELETE /api/v1/contracts/[id]/performance-obligations/[poId]
 *   Delete a DRAFT PO (+ its schedules cascade via DB FK).
 *   Returns 409 if PO is not in draft status.
 *   Full-predicate CAS.
 *   Admin / manager only.
 *   requireAuth("contracts", "write")
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { canPoTransition, isPoStatus } from "@/lib/revenue-recognition/state-machine"
import {
  decimalToMinor,
  minorToDecimalString,
} from "@/lib/revenue-recognition/decimal-minor"
import type { PoStatus } from "@/lib/revenue-recognition/types"

const PO_STATUSES = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const

const patchPoSchema = z.object({
  description:            z.string().min(1).optional(),
  standaloneSellingPrice: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
  status:                 z.enum(PO_STATUSES).optional(),
  allocatedAmount:        z.string().regex(/^\d+(\.\d+)?$/).optional(),
  allocatedAmountReason:  z.string().optional(),
})

export const PATCH = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string; poId: string }> }) => {
  const orgId  = auth.orgId
  const userId = auth.userId
  const role   = auth.role

  // Finance-sensitive: only admin / manager (+ superadmin)
  if (role !== "superadmin" && role !== "admin" && role !== "manager") {
    return NextResponse.json(
      { error: "Only admin or manager may update performance obligations" },
      { status: 403 },
    )
  }

  const { id, poId } = await params

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = patchPoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { description, standaloneSellingPrice, status, allocatedAmount, allocatedAmountReason } = parsed.data

  try {
    // FIX 2: Load current PO + its schedules + entries to detect recognized revenue.
    const existing = await prisma.performanceObligation.findFirst({
      where: { id: poId, organizationId: orgId, contractId: id },
      select: {
        status:   true,
        currency: true,
        metadata: true,
        schedules: {
          select: {
            status: true,
            entries: {
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Determine whether this PO has any recognized revenue:
    //   • Any schedule line NOT in "scheduled" status (i.e. recognized / partially_recognized)
    //   • OR any RevenueRecognitionEntry exists against any of its schedules.
    type ExistingSchedule = { status: string; entries: { id: string }[] }
    const schedules = existing.schedules as ExistingSchedule[]
    const hasRecognition =
      schedules.some((s) => s.status !== "scheduled") ||
      schedules.some((s) => s.entries.length > 0)

    if (hasRecognition) {
      // Financial fields are locked once revenue has been recognized.
      // Use key-presence check (not truthiness) so that an explicit null also
      // triggers the lock — e.g. standaloneSellingPrice: null would bypass a
      // `!== null` check and nullify a financial field after revenue is posted.
      if ("standaloneSellingPrice" in parsed.data) {
        return NextResponse.json(
          { error: "PO has recognized revenue — standaloneSellingPrice is locked" },
          { status: 409 },
        )
      }
      if ("allocatedAmount" in parsed.data) {
        return NextResponse.json(
          { error: "PO has recognized revenue — allocatedAmount is locked" },
          { status: 409 },
        )
      }
      if (status === "cancelled") {
        return NextResponse.json(
          { error: "PO has recognized revenue — cannot cancel a PO with recognized revenue" },
          { status: 409 },
        )
      }
    }

    // State-machine guard
    if (status !== undefined) {
      const fromStatus = existing.status
      if (!isPoStatus(fromStatus)) {
        return NextResponse.json({ error: `Current PO status "${fromStatus}" is invalid` }, { status: 500 })
      }
      const result = canPoTransition(fromStatus as PoStatus, status as PoStatus)
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 409 })
      }
    }

    // FIX 3: Validate + canonicalise money fields via minor-unit round-trip.
    const currency = existing.currency

    let canonicalSsp: string | null | undefined = undefined
    if (standaloneSellingPrice !== undefined) {
      if (standaloneSellingPrice === null) {
        canonicalSsp = null
      } else {
        const sspResult = decimalToMinor(standaloneSellingPrice, currency)
        if (!sspResult.ok) {
          return NextResponse.json(
            { error: `Invalid standaloneSellingPrice for ${currency}: ${sspResult.error}` },
            { status: 400 },
          )
        }
        canonicalSsp = minorToDecimalString(sspResult.minor, currency)
      }
    }

    let canonicalAlloc: string | undefined = undefined
    if (allocatedAmount !== undefined) {
      const allocResult = decimalToMinor(allocatedAmount, currency)
      if (!allocResult.ok) {
        return NextResponse.json(
          { error: `Invalid allocatedAmount for ${currency}: ${allocResult.error}` },
          { status: 400 },
        )
      }
      canonicalAlloc = minorToDecimalString(allocResult.minor, currency)
    }

    // Build update payload
    const data: Record<string, unknown> = {}
    if (description            !== undefined) data.description            = description
    if (canonicalSsp           !== undefined) data.standaloneSellingPrice = canonicalSsp
    if (status                 !== undefined) data.status                 = status

    if (canonicalAlloc !== undefined) {
      data.allocatedAmount = canonicalAlloc
      // Log override reason in metadata
      const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>
      const overrides = Array.isArray(existingMeta.allocatedAmountOverrides)
        ? (existingMeta.allocatedAmountOverrides as unknown[])
        : []
      overrides.push({
        amount:    canonicalAlloc,
        reason:    allocatedAmountReason ?? null,
        overridBy: userId,
        at:        new Date().toISOString(),
      })
      data.metadata = { ...existingMeta, allocatedAmountOverrides: overrides }
    }

    // Full-predicate CAS
    const result = await prisma.performanceObligation.updateMany({
      where: { id: poId, organizationId: orgId, contractId: id },
      data,
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updated = await prisma.performanceObligation.findFirst({
      where: { id: poId, organizationId: orgId, contractId: id },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[performance-obligations PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "write", async (_req, auth, { params }: { params: Promise<{ id: string; poId: string }> }) => {
  const orgId = auth.orgId
  const role  = auth.role

  // Finance-sensitive: only admin / manager (+ superadmin)
  if (role !== "superadmin" && role !== "admin" && role !== "manager") {
    return NextResponse.json(
      { error: "Only admin or manager may delete performance obligations" },
      { status: 403 },
    )
  }

  const { id, poId } = await params

  try {
    // Ensure it's a draft before deleting
    const existing = await prisma.performanceObligation.findFirst({
      where: { id: poId, organizationId: orgId, contractId: id },
      select: { status: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (existing.status !== "draft") {
      return NextResponse.json(
        { error: `Cannot delete a PO with status "${existing.status}" — only draft POs may be deleted` },
        { status: 409 },
      )
    }

    // Full-predicate CAS delete (cascades to schedules + entries via FK)
    const result = await prisma.performanceObligation.deleteMany({
      where: { id: poId, organizationId: orgId, contractId: id },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { deleted: poId } })
  } catch (e) {
    console.error("[performance-obligations DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
