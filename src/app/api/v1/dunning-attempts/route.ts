/**
 * Dunning attempt list — D4 Phase 6 Block A slice 2.
 *
 *   GET /api/v1/dunning-attempts  — list (filter by subscriptionId / status-bucket)
 *
 * Slice-2 is READ-ONLY. POST + transition are slice 3, owned by the
 * dunning cron + Stripe webhook handlers (the cron writes a row at
 * scheduledAt; the webhook flips it to succeeded/failed).
 *
 * Status-bucket filter values:
 *   "pending"   — attemptedAt IS NULL
 *   "succeeded" — succeededAt IS NOT NULL
 *   "failed"    — failureReason IS NOT NULL AND succeededAt IS NULL
 *
 * Mirrors the DB CHECK `dunning_attempts_outcome_check`. Reporting in
 * slice 3 (recovery rate / final-attempt churn) reads this view.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const STATUS_BUCKETS = ["pending", "succeeded", "failed"] as const
const statusBucketSchema = z.enum(STATUS_BUCKETS).optional()

export const GET = withRlsAuth("subscriptions", "read", async (req, auth) => {
  const url = new URL(req.url)
  const subscriptionId = url.searchParams.get("subscriptionId")
  const statusRaw = url.searchParams.get("status")
  const statusParsed = statusBucketSchema.safeParse(statusRaw ?? undefined)
  if (!statusParsed.success) {
    const echo = (statusRaw ?? "").slice(0, 32)
    return NextResponse.json(
      { error: `Invalid status filter: "${echo}" (expected pending / succeeded / failed)` },
      { status: 400 }
    )
  }

  // Status bucket → Prisma `where` shape. The CHECK constraint at the
  // DB level guarantees these are the only valid 3 row shapes; the
  // route just translates the bucket label.
  let statusWhere: Record<string, unknown> = {}
  if (statusParsed.data === "pending") {
    statusWhere = { attemptedAt: null }
  } else if (statusParsed.data === "succeeded") {
    statusWhere = { succeededAt: { not: null } }
  } else if (statusParsed.data === "failed") {
    statusWhere = { failureReason: { not: null }, succeededAt: null }
  }

  const attempts = await prisma.dunningAttempt.findMany({
    where: {
      organizationId: auth.orgId,
      ...(subscriptionId ? { subscriptionId } : {}),
      ...statusWhere,
    },
    orderBy: [{ scheduledAt: "asc" }, { attemptNumber: "asc" }],
    // TODO(slice 3): cursor pagination + admin UI list view.
    take: 500,
  })

  return NextResponse.json({ attempts })
})
