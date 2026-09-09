import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import {
  getTenantPaidRunReport,
  MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD,
  MAX_TENANT_DAILY_RUN_QUOTA,
  MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD,
  MAX_TENANT_PAID_RUN_CAP_USD,
  updateTenantPaidRunPolicy,
} from "@/lib/social/paid-run-authorization"

const patchSchema = z.object({
  manualRunsEnabled: z.boolean().optional(),
  emergencyStopped: z.boolean().optional(),
  maxPerRunUsd: z.number().min(0).max(MAX_TENANT_PAID_RUN_CAP_USD).optional(),
  dailyBudgetUsd: z.number().min(0).max(MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD).optional(),
  monthlyBudgetUsd: z.number().min(0).max(MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD).optional(),
  dailyRunQuota: z.number().int().min(0).max(MAX_TENANT_DAILY_RUN_QUOTA).optional(),
  // Tenant-wide default route budget: applies to every source without an
  // explicit per-source budget. null clears it.
  routeDefaults: z.object({
    maxTotalChargeUsd: z.number().gt(0).max(MAX_TENANT_PAID_RUN_CAP_USD),
    dailyBudgetUsd: z.number().gt(0).max(MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD),
    monthlyBudgetUsd: z.number().gt(0).max(MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD),
  }).strict().nullable().optional(),
  authorizationConfirmed: z.literal(true).optional(),
}).strict()

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const report = await getTenantPaidRunReport(auth.orgId)
  return NextResponse.json({
    success: true,
    data: {
      ...report,
      recentAuthorizations: report.recentAuthorizations.map((authorization) => ({
        ...authorization,
        requestedByUserId: auth.role === "admin" ? authorization.requestedByUserId : null,
      })),
    },
  })
})

export const PATCH = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid paid-run policy" }, { status: 400 })
  try {
    const policy = await updateTenantPaidRunPolicy(auth.orgId, auth.userId, parsed.data)
    return NextResponse.json({ success: true, data: policy })
  } catch (error) {
    const message = error instanceof Error ? error.message : "paid_run_policy_update_failed"
    const status = message === "organization_not_found" ? 404 : 409
    return NextResponse.json({ error: message }, { status })
  }
})
