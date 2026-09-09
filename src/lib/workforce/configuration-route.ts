import type { NextRequest } from "next/server"
import { clientIp } from "@/lib/request-ip"
import type { WorkforceConfigurationAuditContext } from "@/lib/workforce/configuration-management"

/**
 * Builds bounded audit metadata for Workforce configuration mutations. The
 * server-derived resolver rejects a caller-controlled X-Forwarded-For chain.
 */
export function workforceConfigurationRequestAuditContext(
  req: NextRequest,
  actorUserId: string,
): WorkforceConfigurationAuditContext {
  const ipAddress = clientIp(req)
  return {
    actorUserId,
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}
