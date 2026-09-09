import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  MtmLatestLocationReconciliationCursorError,
  issueMtmLatestLocationReconciliationCursor,
  readMtmLatestLocationReconciliationCursor,
  reconcileMtmLatestLocations,
} from "@/lib/mtm/mobile-location-reconciliation"

function nonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 191 && !/[\r\n\t\f\v]/.test(value)
}

/**
 * Privileged, tenant-scoped repair for raw GPS rows written before the latest
 * projection existed. It is intentionally not part of retention cleanup: a
 * scheduler must round-robin tenants and resume the sealed cursor explicitly.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "organizationId or cursor is required" }, { status: 400 })
    }
    const input = body as Record<string, unknown>
    const inputOrganizationId = input.organizationId == null
      ? null
      : nonEmptyId(input.organizationId)
        ? input.organizationId
        : null
    if (input.organizationId != null && !inputOrganizationId) {
      return NextResponse.json({ error: "Invalid organizationId" }, { status: 400 })
    }
    const inputCursor = input.cursor == null
      ? null
      : typeof input.cursor === "string" && input.cursor.length > 0
        ? input.cursor
        : null
    if (input.cursor != null && !inputCursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
    }

    try {
      const continuation = inputCursor
        ? readMtmLatestLocationReconciliationCursor(inputCursor)
        : null
      const organizationId = continuation?.organizationId ?? inputOrganizationId
      if (!organizationId) {
        return NextResponse.json({ error: "organizationId or cursor is required" }, { status: 400 })
      }
      if (inputOrganizationId && continuation && inputOrganizationId !== continuation.organizationId) {
        return NextResponse.json({ error: "Cursor organization mismatch" }, { status: 400 })
      }

      const result = await reconcileMtmLatestLocations({
        organizationId,
        afterAgentId: continuation?.afterAgentId ?? null,
      })
      const shouldContinue = result.morePending || result.retryableFailure
      const nextCursor = shouldContinue && result.nextAfterAgentId
        ? issueMtmLatestLocationReconciliationCursor({
          organizationId,
          afterAgentId: result.nextAfterAgentId,
        })
        : null

      // Counts and an opaque continuation are intentional: cron telemetry
      // must not export raw GPS, agent IDs or tenant identifiers.
      return NextResponse.json({
        success: !result.retryableFailure,
        data: {
          processedAgents: result.processedAgents,
          reconciledLocations: result.reconciledLocations,
          missingRawLocations: result.missingRawLocations,
          morePending: shouldContinue,
          nextCursor,
        },
        ...(result.retryableFailure ? { error: "MTM_LATEST_LOCATION_RECONCILIATION_RETRY" } : {}),
      }, result.retryableFailure
        ? { status: 503, headers: { "Retry-After": "5" } }
        : undefined)
    } catch (error) {
      if (error instanceof MtmLatestLocationReconciliationCursorError) {
        return NextResponse.json({ error: error.code }, { status: 400 })
      }
      console.error("[CRON/mtm-latest-location-reconcile]", error)
      return NextResponse.json({ error: "Latest-location reconciliation failed" }, { status: 500 })
    }
  })
}
