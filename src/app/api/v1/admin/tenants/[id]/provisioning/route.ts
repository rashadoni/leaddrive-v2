import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  getTenantProvisioningRun,
  runTenantProvisioningV2,
  TenantProvisioningAlreadyRunningError,
} from "@/lib/tenant-provisioning-v2"
import { logAudit } from "@/lib/prisma"
import type { TenantProvisioningStep } from "@prisma/client"

const retrySchema = z.object({
  runId: z.string().min(1).optional(),
})

function serializeRun(run: NonNullable<Awaited<ReturnType<typeof getTenantProvisioningRun>>>) {
  return {
    id: run.id,
    organizationId: run.organizationId,
    version: run.version,
    status: run.status,
    summary: run.summary,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    steps: (run.steps as TenantProvisioningStep[]).map((step) => ({
      id: step.id,
      stepKey: step.stepKey,
      status: step.status,
      attempts: step.attempts,
      output: step.output,
      error: step.error,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    })),
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  return runWithRlsBypass(async () => {
    const run = await getTenantProvisioningRun(id, req.nextUrl.searchParams.get("runId") || undefined)
    if (!run) {
      return NextResponse.json({ error: "No provisioning run found for this tenant" }, { status: 404 })
    }
    return NextResponse.json({ data: serializeRun(run) })
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const parsed = retrySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  return runWithRlsBypass(async () => {
    const current = await getTenantProvisioningRun(id, parsed.data.runId)
    if (!current) {
      return NextResponse.json({ error: "No provisioning run found for this tenant" }, { status: 404 })
    }
    if (current.status === "running") {
      return NextResponse.json({ error: "Provisioning is already running" }, { status: 409 })
    }

    let run
    try {
      run = await runTenantProvisioningV2({
        organizationId: id,
        runId: current.id,
        retryFailed: true,
      })
    } catch (error) {
      if (error instanceof TenantProvisioningAlreadyRunningError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      throw error
    }
    logAudit(auth.orgId, "retry", "tenant_provisioning", run.id, id, {
      oldValue: { status: current.status },
      newValue: { status: run.status },
    })
    return NextResponse.json({ data: serializeRun(run) })
  })
}
