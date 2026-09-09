import { NextRequest, NextResponse } from "next/server"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { executeMtmMobileRouteCommand } from "@/lib/mtm/mobile-route-command"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { parseMobileSyncV2DeviceId } from "@/lib/mtm/mobile-sync-v2"
import { MtmMobileRouteCommandSchema } from "@/lib/mtm-validators"
import { withMobileRls } from "@/lib/with-mobile-rls"

function invalidCommand() {
  return NextResponse.json({
    success: false,
    error: "Invalid mobile route command.",
    code: "MOBILE_ROUTE_COMMAND_INVALID",
  }, { status: 400 })
}

/**
 * POST /api/v1/mtm/mobile/route-commands
 *
 * Additive mobile-only v1 transport for the standalone Route Field APK. It
 * intentionally does not alter existing /routes compatibility handlers and
 * does not make sync v2 a mutation authority. Every accepted terminal command
 * is committed with a durable receipt before the response is returned.
 */
export const POST = withMobileRls(async (req: NextRequest, auth) => {
  const deviceId = parseMobileSyncV2DeviceId(req.headers.get("x-field-device-id"))
  if (!deviceId) {
    return NextResponse.json({
      success: false,
      error: "A valid Route Field device ID is required for durable route commands.",
      code: "MOBILE_ROUTE_COMMAND_DEVICE_ID_REQUIRED",
    }, { status: 400 })
  }

  const parsed = MtmMobileRouteCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidCommand()

  // ROUTE_SELF_PUBLISH is intentionally dynamic: the same AGENT role may be
  // allowed or denied by the current agent grant and tenant routeSelfPublish
  // setting. The durable state machine reads both inside its transaction, so
  // a static role-only check here would reject every otherwise-authorized
  // agent before that authoritative check can run.
  const permission = requireMobilePermission(
    auth,
    parsed.data.command === "START"
        ? "ROUTE_EXECUTE"
        : "ROUTE_SELF_PLAN",
  )
  if (permission) return permission

  try {
    const execution = await executeMtmMobileRouteCommand({
      auth,
      deviceId,
      command: parsed.data,
    })
    if (!execution.replayed && execution.audit) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: execution.audit.agentId,
        action: MTM_ROUTE_AUDIT_ACTION[execution.audit.action],
        entity: "route",
        entityId: execution.audit.routeId,
        metadataKind: "mobile_route_command",
        oldData: execution.audit.oldData,
        newData: execution.audit.newData,
        req,
      }).catch((error) => console.warn("[MTM/mobile/route-commands] audit failed", error))
    }
    return NextResponse.json({
      ...execution.result,
      ...(execution.replayed ? { idempotent: true } : {}),
    }, { status: execution.responseStatus })
  } catch (error) {
    console.error("[MTM/mobile/route-commands]", error)
    return NextResponse.json({
      success: false,
      error: "Failed to process mobile route command.",
      code: "MOBILE_ROUTE_COMMAND_UNAVAILABLE",
    }, { status: 500 })
  }
}, { requiredCapability: "route-field" })
