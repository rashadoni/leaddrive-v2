import { NextRequest, NextResponse } from "next/server"

import { reconcileMissedInboundCalls } from "@/lib/calls/missed-inbound-reconciliation"
import { requireCronAuth } from "@/lib/cron-auth"
import { withJobLease } from "@/lib/cron/job-lease"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

const MISSED_INBOUND_RECONCILIATION_LEASE_MS = 120_000

export async function POST(request: NextRequest) {
  // The cross-tenant context is never entered before the shared cron guard.
  const authError = requireCronAuth(request)
  if (authError) return authError

  // Deployment proves auth + route availability without taking the global
  // lease or reading/writing any tenant row.
  if (new URL(request.url).searchParams.get("smoke") === "1") {
    return NextResponse.json({
      success: true,
      data: {
        selected: 0,
        reconciled: 0,
        alreadyReconciled: 0,
        failed: 0,
        smoke: true,
      },
    })
  }

  return runWithRlsBypass(async () => {
    try {
      const run = await withJobLease(
        {
          name: "missed-inbound-reconciliation",
          ttlMs: MISSED_INBOUND_RECONCILIATION_LEASE_MS,
        },
        () => reconcileMissedInboundCalls(prisma),
      )
      if (run.status === "skipped") {
        return NextResponse.json({
          success: true,
          data: { skipped: run.reason },
        })
      }
      return NextResponse.json({ success: true, data: run.value })
    } catch (error) {
      console.error(
        "[missed-inbound-reconciliation] failed",
        error instanceof Error ? error.message : "unknown_error",
      )
      return NextResponse.json(
        { error: "Missed inbound reconciliation failed" },
        { status: 500 },
      )
    }
  })
}
