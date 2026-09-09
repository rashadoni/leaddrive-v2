import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD } from "@/lib/social/provider-spend-limits"
import { runMonitoringProfileSourceForSubject } from "@/lib/social/monitoring-profile-source-run"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

type RouteCtx = { params: Promise<{ id: string }> }

const runSchema = z.object({
  scenarioId: z.string().trim().min(1).max(160),
  sourceId: z.string().trim().min(1).max(160),
  paidConfirmed: z.boolean().optional(),
  includeComments: z.boolean().optional(),
  commentsOnly: z.boolean().optional(),
  fullSearchConfirmed: z.boolean().optional(),
  fullArchiveConfirmed: z.literal(true),
  maxTotalChargeUsd: z.number().gt(0).max(CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD).optional(),
}).strict()

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, { params }: RouteCtx) => {
  if (!["admin", "superadmin"].includes(auth.role)) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 })
  }

  const parsed = runSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid monitoring run request" },
      { status: 400 },
    )
  }

  const { id: subjectId } = await params
  const { fullArchiveConfirmed: _confirmed, ...run } = parsed.data
  void _confirmed
  const outcome = await runMonitoringProfileSourceForSubject({
    organizationId: auth.orgId,
    requestedByUserId: auth.userId,
    subjectId,
    run,
  })

  if (!outcome.ok) {
    const {
      ok: _ok,
      status,
      error,
      ...details
    } = outcome
    void _ok
    return NextResponse.json({ error, ...details }, { status })
  }

  return NextResponse.json({ success: true, data: outcome.data })
})
