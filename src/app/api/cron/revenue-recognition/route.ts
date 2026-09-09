/**
 * CLM Slice 5b-2 — Revenue Recognition Cron
 *
 * POST /api/cron/revenue-recognition
 *
 * Fires monthly (1st of month recommended). For every due schedule line
 * (status in {scheduled, partially_recognized} where periodEnd <= now),
 * posts a RevenueRecognitionEntry via the pure recognition calculator.
 *
 * Design:
 *   - Status CAS (conditional updateMany) prevents double-post across
 *     concurrent runs or if cron fires twice. If the status changed between
 *     fetch and write, the updateMany matches 0 rows → skip (idempotent).
 *   - All money in minor units via decimalToMinor / minorToDecimalString.
 *     NO Number() float on financial fields.
 *   - RevenueRecognitionEntry rows are append-only (DB trigger blocks UPDATE).
 *   - Per-PO: after all its schedules reach "recognized", transitions the PO
 *     to "completed" (via canPoTransition guard, in_progress → completed).
 *   - usage_based lines produce postNow=0 (calculator returns 0 for usage_based
 *     in slice-1); they are skipped cleanly.
 *
 * Auth: CRON_SECRET (x-cron-secret header or Authorization: Bearer).
 *   503 when CRON_SECRET not configured (misconfiguration).
 *   401 on wrong/missing secret (bad caller).
 *
 * Returns: { posted, skipped, errors, timestamp }
 *
 * [P2-ops] /api/cron/revenue-recognition needs a MONTHLY crontab entry
 * (1st of month) on the box:
 *   0 2 1 * * curl -X POST https://app.leaddrivecrm.org/api/cron/revenue-recognition \
 *     -H "x-cron-secret: $CRON_SECRET"
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { calculateRecognition } from "@/lib/revenue-recognition/recognition-calculator"
import { canPoTransition, canScheduleTransition } from "@/lib/revenue-recognition/state-machine"
import {
  decimalToMinor,
  minorToDecimalString,
} from "@/lib/revenue-recognition/decimal-minor"
import type { PoStatus, ScheduleStatus } from "@/lib/revenue-recognition/types"

export const dynamic = "force-dynamic"

const MAX_BATCH = 500
const DUE_STATUSES: ScheduleStatus[] = ["scheduled", "partially_recognized"]

// ─── Prisma row shapes (runtime) ────────────────────────────────────────────

type EntryRow = {
  recognizedAmount: { toString(): string }
}

type ScheduleRow = {
  id:                      string
  organizationId:          string
  performanceObligationId: string
  lineNumber:              number
  periodStart:             Date
  periodEnd:               Date
  scheduledAmount:         { toString(): string }
  currency:                string
  status:                  string
  entries:                 EntryRow[]
}

type PoRow = {
  id:                string
  organizationId:    string
  contractId:        string
  status:            string
  recognitionMethod: string
  schedules:         ScheduleRow[]
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const now = new Date()
  const results = { posted: 0, skipped: 0, errors: 0 }

  try {
    // ── 1. Fetch due schedule lines (status in due-set, periodEnd <= now)
    // Include parent PO and all existing entries for the schedule.
    // Capped at MAX_BATCH per run; excess fires next invocation.
    const dueSchedules = await prisma.revenueRecognitionSchedule.findMany({
      where: {
        status: { in: DUE_STATUSES },
        periodEnd: { lte: now },
      },
      orderBy: { periodEnd: "asc" },
      take: MAX_BATCH,
      include: {
        entries: {
          select: { recognizedAmount: true },
        },
        performanceObligation: {
          select: {
            id:                true,
            organizationId:    true,
            contractId:        true,
            status:            true,
            recognitionMethod: true,
            schedules: {
              select: {
                id:     true,
                status: true,
              },
            },
          },
        },
      },
    })

    // ── 2. Process each schedule line
    for (const sched of dueSchedules) {
      const po = sched.performanceObligation as PoRow | null
      if (!po) {
        results.skipped++
        continue
      }

      try {
        const currency = sched.currency
        const orgId    = sched.organizationId

        // a. Compute postedToDateMinor — sum of existing entries for THIS schedule line.
        //    All arithmetic in minor units (no float).
        let postedToDateMinor = 0
        for (const e of sched.entries as EntryRow[]) {
          const er = decimalToMinor(e.recognizedAmount.toString(), currency)
          if (!er.ok) {
            throw new Error(`Entry decimalToMinor failed: ${er.error}`)
          }
          postedToDateMinor += er.minor
        }

        // b. Convert scheduledAmount to minor units.
        const scheduledResult = decimalToMinor(sched.scheduledAmount.toString(), currency)
        if (!scheduledResult.ok) {
          throw new Error(`scheduledAmount decimalToMinor failed: ${scheduledResult.error}`)
        }
        const scheduledMinor = scheduledResult.minor

        // c. Call recognition calculator (pure, synchronous).
        const calcResult = calculateRecognition({
          scheduledMinor,
          postedToDateMinor,
          periodStart: sched.periodStart,
          periodEnd:   sched.periodEnd,
          method:      po.recognitionMethod as "point_in_time" | "over_time_straight_line" | "milestone" | "usage_based",
          asOf:        now,
        })

        if (!calcResult.ok) {
          throw new Error(`calculateRecognition failed: ${calcResult.error}`)
        }

        const { postNowMinor, suggestedStatus } = calcResult.calc

        // All postNow=0 / suggestedStatus validation is handled INSIDE the $transaction
        // (after acquiring the contract row lock) to prevent TOCTOU with recalc.
        const fromStatus = sched.status as ScheduleStatus

        // Typed tx shim — same pattern as recalculate route (avoids Prisma overload ambiguity).
        type TxClient = {
          $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
          revenueRecognitionSchedule: {
            updateMany: (args: unknown) => Promise<{ count: number }>
            findMany:   (args: unknown) => Promise<{ id: string; status: string }[]>
          }
          revenueRecognitionEntry: {
            create: (args: unknown) => Promise<unknown>
          }
          performanceObligation: {
            updateMany: (args: unknown) => Promise<{ count: number }>
          }
        }

        const contractId = po.contractId

        let posted = false
        await prisma.$transaction(async (tx: TxClient) => {
          // FIX 1: Lock the contract row FIRST — serializes this cron tx against any
          // concurrent recalc tx on the same contract. Recalc acquires the same lock,
          // so one blocks until the other commits → no TOCTOU.
          await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} FOR UPDATE`

          // d. If postNow === 0 → check for stale status (FIX 2) before deciding to skip.
          if (postNowMinor === 0) {
            // FIX 2: A fully-posted line that is still marked partially_recognized
            // yields postNow=0 but suggestedStatus="recognized". Without this repair
            // the line is permanently non-terminal and PO completion is blocked.
            const currentStatus = sched.status as ScheduleStatus
            if (suggestedStatus && suggestedStatus !== currentStatus) {
              // Stale status detected — repair via CAS (state-machine guarded).
              const tr = canScheduleTransition(currentStatus, suggestedStatus)
              if (tr.ok) {
                const repairResult = await tx.revenueRecognitionSchedule.updateMany({
                  where: {
                    id:             sched.id,
                    organizationId: orgId,
                    status:         currentStatus,
                  },
                  data: {
                    status: suggestedStatus,
                    ...(suggestedStatus === "recognized" ? { recognizedAt: now } : {}),
                  },
                })
                if (repairResult.count > 0) {
                  // Run PO completion check after status repair (same as after entry post).
                  const allSiblingsAfterRepair = await tx.revenueRecognitionSchedule.findMany({
                    where: { performanceObligationId: po.id, organizationId: orgId },
                    select: { id: true, status: true },
                  })
                  const repairPoStatus = po.status as PoStatus
                  // FIX 3: Transition PO → in_progress on FIRST recognition (even if not all done).
                  const toInProgress = canPoTransition(repairPoStatus, "in_progress")
                  if (toInProgress.ok) {
                    await tx.performanceObligation.updateMany({
                      where: { id: po.id, organizationId: orgId, status: repairPoStatus },
                      data:  { status: "in_progress" },
                    })
                  }
                  // Then check if ALL siblings are now terminal → completed.
                  const allTerminalAfterRepair = allSiblingsAfterRepair.every(
                    (s) => s.status === "recognized" || s.status === "cancelled",
                  )
                  if (allTerminalAfterRepair && allSiblingsAfterRepair.some((s) => s.status === "recognized")) {
                    await tx.performanceObligation.updateMany({
                      where: { id: po.id, organizationId: orgId, status: "in_progress" },
                      data:  { status: "completed" },
                    })
                  }
                  posted = true
                  return
                }
              }
            }
            results.skipped++
            return
          }

          // e. Validate suggested status
          if (!suggestedStatus) {
            // Over-posted — should not happen in normal flow; skip safely.
            results.skipped++
            return
          }

          // f. CAS on schedule status — prevents double-post from concurrent runs.
          const casResult = await tx.revenueRecognitionSchedule.updateMany({
            where: {
              id:             sched.id,
              organizationId: orgId,
              status:         fromStatus,
            },
            data: {
              status:       suggestedStatus,
              // Only set recognizedAt on the transition to fully "recognized".
              ...(suggestedStatus === "recognized" ? { recognizedAt: now } : {}),
            },
          })

          if (casResult.count === 0) {
            // Another concurrent run already updated this row → skip.
            results.skipped++
            return
          }

          // g. Create recognition entry (append-only; DB trigger blocks UPDATE).
          await tx.revenueRecognitionEntry.create({
            data: {
              organizationId:   orgId,
              scheduleId:       sched.id,
              recognizedAmount: minorToDecimalString(postNowMinor, currency),
              currency,
              postedAt:         now,
              postedBy:         "cron",
            },
          })

          posted = true

          // h. Re-read sibling schedule statuses within the transaction.
          const allSiblings = await tx.revenueRecognitionSchedule.findMany({
            where: { performanceObligationId: po.id, organizationId: orgId },
            select: { id: true, status: true },
          })

          const poCurrentStatus = po.status as PoStatus

          // FIX 3: Transition PO scheduled → in_progress on the FIRST recognition —
          // not only when ALL schedules are terminal. A multi-line PO should move to
          // in_progress as soon as any line is recognized, so the caller can track progress.
          const toInProgress = canPoTransition(poCurrentStatus, "in_progress")
          if (toInProgress.ok) {
            await tx.performanceObligation.updateMany({
              where: { id: po.id, organizationId: orgId, status: poCurrentStatus },
              data:  { status: "in_progress" },
            })
          }

          // Separately: if ALL of the PO's schedules are now terminal →
          // transition in_progress → completed (two distinct CAS updates, both guarded).
          const allRecognized = allSiblings.every(
            (s) => s.status === "recognized" || s.status === "cancelled"
          )
          if (allRecognized && allSiblings.some((s) => s.status === "recognized")) {
            await tx.performanceObligation.updateMany({
              where: { id: po.id, organizationId: orgId, status: "in_progress" },
              data:  { status: "completed" },
            })
          }
        })

        if (posted) {
          results.posted++
        }
      } catch (err) {
        console.error(`[revenue-recognition] error for schedule ${sched.id}:`, err)
        results.errors++
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (err) {
    console.error("[revenue-recognition] cron error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
