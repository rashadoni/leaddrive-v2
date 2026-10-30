import type { NextRequest } from "next/server"
import { recordComplianceAccess } from "./compliance-audit"
import { runWithTenant } from "@/lib/rls-context"
import { clientIp } from "@/lib/request-ip"
import { describeReviewerRead, REVIEWER_ROLE } from "@/lib/reviewer-access"

// One journal line per request, however many auth helpers the route calls.
const logged = new WeakSet<object>()

/**
 * Writes one read of an outside reviewer to the append-only
 * compliance_audit_log: which section, list or record, the path and query,
 * when and from where. Everyone else passes through untouched. Fire-and-forget
 * under the reviewer's own tenant scope: the journal must never slow or fail
 * the read.
 */
export function recordReviewerRead(
  req: NextRequest,
  session: { role: string; orgId: string; userId: string },
): void {
  if (session.role !== REVIEWER_ROLE || !session.orgId || !session.userId) return
  const method = req.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD") return
  if (logged.has(req)) return
  logged.add(req)

  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  const read = describeReviewerRead(url.pathname)
  void runWithTenant(session.orgId, () => recordComplianceAccess({
    organizationId: session.orgId,
    userId: session.userId,
    action: "read",
    recordType: "pii",
    recordTable: read.scope ?? "unscoped",
    recordId: read.recordId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    metadata: {
      reviewer: true,
      kind: read.kind,
      path: url.pathname,
      ...(url.search ? { query: url.search.slice(0, 500) } : {}),
    },
  }))
}
