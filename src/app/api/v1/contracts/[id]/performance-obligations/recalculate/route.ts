/**
 * CLM Slice 5b-1 — ASC-606 recalculate: allocation + schedule generation
 *
 * POST /api/v1/contracts/[id]/performance-obligations/recalculate
 *
 * Wires the pure helpers in this order (all money via minor units):
 *   1. Load contract (valueAmount, currency) + all POs for this contract.
 *   2. decimalToMinor(contract.valueAmount, currency) → contractTotalMinor.
 *   3. For each PO: decimalToMinor(po.standaloneSellingPrice) → sspMinor
 *      (null SSP = null — allocator handles equal-split or full allocation).
 *   4. allocateTransactionPrice({contractTotalMinor, currency, obligations})
 *      → {ok, allocations} — 400 on {ok:false}.
 *   5. For each PO:
 *      a. Persist allocatedAmount = minorToDecimalString(allocatedMinor, currency).
 *      b. Build milestones[] from PO metadata (milestone method).
 *      c. generateSchedule({performanceObligationId, method, allocatedMinor,
 *                          currency, periodStart, periodEnd, milestones}) → lines.
 *      d. DELETE existing "scheduled" lines (preserve recognized /
 *         partially_recognized lines — posted revenue is immutable).
 *      e. FIX 1: Per-PO, after deleting "scheduled" lines, compute
 *         maxSurvivingLineNumber from the REMAINING preserved lines (0 if none).
 *         Offset new generated lines: lineNumber = maxSurviving + generatedLineNumber.
 *         So new scheduled lines never collide with preserved recognized lines.
 *      f. createMany new "scheduled" lines with offset lineNumbers.
 *      g. Transition PO status draft→scheduled via canPoTransition guard.
 *   6. FIX 6: PO allocatedAmount/status updateMany predicate includes contractId;
 *      count asserted === 1 (rollback on concurrent drift).
 *   7. Whole operation runs in a $transaction (atomic).
 *
 * Summary totals (FIX 4): computed in minor units — no Number() float on money.
 *
 * Admin / manager only. requireAuth("contracts", "write").
 *
 * Returns: updated POs with schedule summary.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { allocateTransactionPrice } from "@/lib/revenue-recognition/allocation-engine"
import { generateSchedule } from "@/lib/revenue-recognition/schedule-generator"
import { canPoTransition, isPoStatus } from "@/lib/revenue-recognition/state-machine"
import {
  decimalToMinor,
  minorToDecimalString,
} from "@/lib/revenue-recognition/decimal-minor"
import type { PoStatus } from "@/lib/revenue-recognition/types"

export const POST = withRlsAuth("contracts", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const role  = auth.role

  // Finance-sensitive: only admin / manager (+ superadmin)
  if (role !== "superadmin" && role !== "admin" && role !== "manager") {
    return NextResponse.json(
      { error: "Only admin or manager may recalculate performance obligations" },
      { status: 403 },
    )
  }

  const { id } = await params

  try {
    // 1. Load contract + all POs
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, valueAmount: true, currency: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const pos = await prisma.performanceObligation.findMany({
      where: { contractId: id, organizationId: orgId },
      orderBy: { displayOrder: "asc" },
    })

    if (pos.length === 0) {
      return NextResponse.json(
        { error: "No performance obligations found for this contract" },
        { status: 400 },
      )
    }

    const currency = contract.currency

    // FIX B (ASC-606 immutability): If ANY PO in this contract has recognized
    // revenue — any schedule line NOT in "scheduled" status, OR any
    // RevenueRecognitionEntry exists against any schedule — the allocation is
    // fixed at inception and MUST NOT be recomputed.  Re-allocation after
    // recognition is contract-modification accounting (prospective vs.
    // cumulative-catch-up) and is deferred to a future slice.
    // This check runs BEFORE any mutation (before the $transaction).
    const poIds = pos.map((p: { id: string }) => p.id)
    const recognizedScheduleCount = await prisma.revenueRecognitionSchedule.count({
      where: {
        performanceObligationId: { in: poIds },
        organizationId: orgId,
        OR: [
          { status: { not: "scheduled" } },
          { entries: { some: {} } },
        ],
      },
    })
    if (recognizedScheduleCount > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot recalculate allocation after revenue has been recognized — " +
            "recognized obligations are locked. Use a contract modification.",
        },
        { status: 409 },
      )
    }

    // 2. Convert contract total to minor units
    const contractValueStr = contract.valueAmount?.toString() ?? "0"
    const contractMinorResult = decimalToMinor(contractValueStr, currency)
    if (!contractMinorResult.ok) {
      return NextResponse.json(
        { error: `Contract value conversion error: ${contractMinorResult.error}` },
        { status: 400 },
      )
    }
    const contractTotalMinor = contractMinorResult.minor

    // 3. Convert each PO's SSP to minor units
    const obligations: { id: string; ssp: number | null }[] = []
    for (const po of pos) {
      if (po.standaloneSellingPrice === null || po.standaloneSellingPrice === undefined) {
        obligations.push({ id: po.id, ssp: null })
      } else {
        const sspResult = decimalToMinor(po.standaloneSellingPrice.toString(), currency)
        if (!sspResult.ok) {
          return NextResponse.json(
            { error: `PO ${po.id} SSP conversion error: ${sspResult.error}` },
            { status: 400 },
          )
        }
        obligations.push({ id: po.id, ssp: sspResult.minor })
      }
    }

    // 4. Run allocation engine
    const allocResult = allocateTransactionPrice({
      contractTotalMinor,
      currency,
      obligations,
    })
    if (!allocResult.ok) {
      return NextResponse.json({ error: allocResult.error }, { status: 400 })
    }

    // Build a map from PO id → allocatedMinor
    const allocMap = new Map<string, number>(
      allocResult.allocations.map((a) => [a.id, a.allocatedMinor]),
    )

    // 5. For each PO: generate schedule lines before entering the transaction (pure helpers)
    type ScheduleLineInput = {
      poId:            string
      contractId:      string
      allocatedMinor:  number
      allocatedDecStr: string
      fromStatus:      string
      shouldTransition: boolean
      lines: Array<{
        generatedLineNumber: number   // 1-based from the generator; offset applied inside tx
        periodStart:         Date
        periodEnd:           Date
        scheduledAmount:     string
        currency:            string
        label:               string | null
      }>
    }

    const scheduleInputs: ScheduleLineInput[] = []

    for (const po of pos) {
      const allocatedMinor = allocMap.get(po.id)!
      const allocatedDecStr = minorToDecimalString(allocatedMinor, currency)

      // Parse milestones from metadata (stored by POST handler)
      let milestones: Array<{ label: string; weight: number; dueAt: Date }> | undefined
      const meta = (po.metadata ?? {}) as Record<string, unknown>
      if (Array.isArray(meta.milestones)) {
        milestones = (meta.milestones as Array<{ label: string; weight: number; dueAt: string }>).map(
          (m) => ({
            label:  m.label,
            weight: m.weight,
            dueAt:  new Date(m.dueAt),
          }),
        )
      }

      const schedResult = generateSchedule({
        performanceObligationId: po.id,
        method:                  po.recognitionMethod as "point_in_time" | "over_time_straight_line" | "milestone" | "usage_based",
        allocatedMinor,
        currency,
        periodStart:             po.periodStart,
        periodEnd:               po.periodEnd,
        milestones,
      })

      if (!schedResult.ok) {
        return NextResponse.json(
          { error: `Schedule generation failed for PO ${po.id}: ${schedResult.error}` },
          { status: 400 },
        )
      }

      // Check if PO can transition draft→scheduled
      const fromStatus = po.status
      let shouldTransition = false
      if (isPoStatus(fromStatus as PoStatus) && fromStatus === "draft") {
        const tr = canPoTransition("draft", "scheduled")
        shouldTransition = tr.ok
      }

      scheduleInputs.push({
        poId:            po.id,
        contractId:      id,
        allocatedMinor,
        allocatedDecStr,
        fromStatus,
        shouldTransition,
        // Keep the raw generatedLineNumber (1-based); the tx step will offset it
        // past maxSurvivingLineNumber after deleting "scheduled" lines.
        lines: schedResult.lines.map((l) => ({
          generatedLineNumber: l.lineNumber,
          periodStart:         l.periodStart,
          periodEnd:           l.periodEnd,
          scheduledAmount:     minorToDecimalString(l.scheduledMinor, currency),
          currency:            l.currency,
          label:               l.label,
        })),
      })
    }

    // 6. Atomic transaction: persist allocations + replace scheduled lines
    await prisma.$transaction(async (tx: {
      $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
      performanceObligation: {
        updateMany: (args: unknown) => Promise<{ count: number }>
      }
      revenueRecognitionSchedule: {
        count:      (args: unknown) => Promise<number>
        aggregate:  (args: unknown) => Promise<{ _max: { lineNumber: number | null } }>
        deleteMany: (args: unknown) => Promise<unknown>
        createMany: (args: unknown) => Promise<unknown>
      }
    }) => {
      // FIX 1: Serialize recalc↔cron TOCTOU — acquire the contract row lock FIRST,
      // before any read or write. The cron acquires the same lock per-line, so
      // Postgres serializes them: one of them blocks until the other's tx commits.
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`

      // FIX 1: Re-check the recognition guard INSIDE the tx (after acquiring the lock).
      // The pre-tx fast-fail check above is a cheap early exit; this in-tx check is the
      // authoritative one: if the cron posted a recognition entry between the pre-check
      // and here, we catch it now and roll back everything cleanly.
      const inTxRecognizedCount = await tx.revenueRecognitionSchedule.count({
        where: {
          performanceObligationId: { in: poIds },
          organizationId: orgId,
          OR: [
            { status: { not: "scheduled" } },
            { entries: { some: {} } },
          ],
        },
      })
      if (inTxRecognizedCount > 0) {
        throw Object.assign(
          new Error(
            "Cannot recalculate allocation after revenue has been recognized — " +
            "recognized obligations are locked. Use a contract modification.",
          ),
          { __recognizedLock: true },
        )
      }

      for (const si of scheduleInputs) {
        // a. FIX 6: Persist allocatedAmount with contractId in predicate + count assert.
        const allocUpdateResult = await tx.performanceObligation.updateMany({
          where: { id: si.poId, organizationId: orgId, contractId: si.contractId },
          data:  { allocatedAmount: si.allocatedDecStr },
        })
        if (allocUpdateResult.count !== 1) {
          throw new Error(`Concurrent drift on PO ${si.poId} — allocatedAmount update matched ${allocUpdateResult.count} rows`)
        }

        // d. Delete existing "scheduled" lines only (preserve recognized/partially_recognized)
        await tx.revenueRecognitionSchedule.deleteMany({
          where: {
            performanceObligationId: si.poId,
            organizationId:          orgId,
            status:                  "scheduled",
          },
        })

        // FIX 1: After deleting scheduled lines, compute the maxSurvivingLineNumber
        // from the REMAINING preserved lines (recognized / partially_recognized).
        // New generated lines start at maxSurving + 1, never colliding with preserved lines.
        const maxRow = await tx.revenueRecognitionSchedule.aggregate({
          where: {
            performanceObligationId: si.poId,
            organizationId:          orgId,
          },
          _max: { lineNumber: true },
        })
        const maxSurvivingLineNumber = maxRow._max.lineNumber ?? 0

        // e. Create new schedule lines with offset lineNumbers
        await tx.revenueRecognitionSchedule.createMany({
          data: si.lines.map((l) => ({
            organizationId:          orgId,
            performanceObligationId: si.poId,
            lineNumber:              maxSurvivingLineNumber + l.generatedLineNumber,
            periodStart:             l.periodStart,
            periodEnd:               l.periodEnd,
            scheduledAmount:         l.scheduledAmount,
            currency:                l.currency,
            label:                   l.label,
            status:                  "scheduled",
            metadata:                {},
          })),
        })

        // f. Transition PO draft→scheduled if applicable
        if (si.shouldTransition) {
          await tx.performanceObligation.updateMany({
            where: { id: si.poId, organizationId: orgId, contractId: si.contractId, status: "draft" },
            data:  { status: "scheduled" },
          })
        }
      }
    })

    // Return updated POs with schedule summary
    const updatedPos = await prisma.performanceObligation.findMany({
      where: { contractId: id, organizationId: orgId },
      orderBy: { displayOrder: "asc" },
      include: {
        schedules: {
          select: {
            id:              true,
            lineNumber:      true,
            status:          true,
            scheduledAmount: true,
            periodStart:     true,
            periodEnd:       true,
            label:           true,
            entries: {
              select: { recognizedAmount: true },
            },
          },
        },
      },
    })

    // FIX 4: Summary totals in minor units — no Number() float on money.
    const data = updatedPos.map((po: typeof updatedPos[number]) => {
      let totalScheduledMinor = 0
      let totalRecognizedMinor = 0

      for (const l of po.schedules) {
        const sr = decimalToMinor(String(l.scheduledAmount ?? "0"), currency)
        if (sr.ok) totalScheduledMinor += sr.minor

        for (const e of l.entries) {
          const er = decimalToMinor(String(e.recognizedAmount ?? "0"), currency)
          if (er.ok) totalRecognizedMinor += er.minor
        }
      }

      return {
        ...po,
        schedules: undefined,
        scheduleSummary: {
          lineCount:       po.schedules.length,
          totalScheduled:  minorToDecimalString(totalScheduledMinor, currency),
          totalRecognized: minorToDecimalString(totalRecognizedMinor, currency),
        },
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (e) {
    // FIX 1: in-tx recognition lock sentinel → 409 (rolled back cleanly by $transaction throw)
    if (
      e instanceof Error &&
      (e as Error & { __recognizedLock?: boolean }).__recognizedLock === true
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot recalculate allocation after revenue has been recognized — " +
            "recognized obligations are locked. Use a contract modification.",
        },
        { status: 409 },
      )
    }
    console.error("[performance-obligations/recalculate POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
