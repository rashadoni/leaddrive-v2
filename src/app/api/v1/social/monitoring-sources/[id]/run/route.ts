import { NextRequest, NextResponse } from "next/server"
import { SOURCE_CAPABILITIES, type SourceCapability } from "@/lib/social/source-route-plan"
import { runMonitoringSourceForActor } from "@/lib/social/monitoring-source-run"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

type RouteCtx = { params: Promise<{ id: string }> }

const MAX_MANUAL_RUN_CAP_USD = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, { params }: RouteCtx) => {
  const { id } = await params
  const rawBody = await req.text()
  let body: Record<string, unknown> = {}
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as unknown
      if (!isRecord(parsed)) {
        return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 })
      }
      body = parsed
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
  }

  const requestedCap = body.maxTotalChargeUsd
  const requestedCapability = body.onlyCapability
  const requestedPaidConfirmed = body.paidConfirmed
  if (requestedPaidConfirmed !== undefined && typeof requestedPaidConfirmed !== "boolean") {
    return NextResponse.json({ error: "paidConfirmed must be a boolean" }, { status: 400 })
  }
  let onlyCapability: SourceCapability | undefined
  if (requestedCapability !== undefined) {
    if (typeof requestedCapability !== "string" || !SOURCE_CAPABILITIES.includes(requestedCapability as SourceCapability)) {
      return NextResponse.json({ error: "onlyCapability is invalid" }, { status: 400 })
    }
    onlyCapability = requestedCapability as SourceCapability
  }
  let maxTotalChargeUsd: number | undefined
  if (requestedCap !== undefined) {
    if (typeof requestedCap !== "number" || !Number.isFinite(requestedCap) || requestedCap <= 0 || requestedCap > MAX_MANUAL_RUN_CAP_USD) {
      return NextResponse.json({ error: "maxTotalChargeUsd must be greater than 0 and at most 100" }, { status: 400 })
    }
    maxTotalChargeUsd = Math.round(requestedCap * 1_000_000) / 1_000_000
  }

  const outcome = await runMonitoringSourceForActor({
    organizationId: auth.orgId,
    sourceId: id,
    expectedScope: "EXTERNAL",
    maxTotalChargeUsd,
    paidRunConfirmed: requestedPaidConfirmed === true || maxTotalChargeUsd !== undefined,
    requestedByUserId: auth.userId,
    onlyCapability,
  })
  if (!outcome.ok) {
    if (outcome.error === "monitoring_source_not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (outcome.error === "collector_already_running") {
      return NextResponse.json(
        {
          error: "Collector is already running",
          retryAfterSeconds: outcome.retryAfterSeconds ?? 60,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  return NextResponse.json({ success: true, data: outcome.data })
})
