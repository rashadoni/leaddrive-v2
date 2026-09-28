import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceEvidenceTimelineRateLimit } from "@/lib/workforce/approved-report-rate-limit"
import { resolveWorkforceEvidenceDirectoryAccess } from "@/lib/workforce/evidence-timeline-access"
import { parseWorkforceEvidenceAccessContext } from "@/lib/workforce/evidence-timeline"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

// Prisma/PostgreSQL `contains` treats these LIKE metacharacters as patterns.
// Reject them so the two-character minimum remains an actual narrowing fence
// instead of allowing `%_` to enumerate the first directory page.
const Query = z.string().trim().min(2).max(80).refine((value) => !/[\\%_]/.test(value))
const TARGET_LIMIT = 25

function sensitiveJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: workforceSensitiveResponseHeaders })
}

/**
 * A purpose-bound, read-scoped typeahead for the derived-evidence page. It is
 * intentionally separate from the MFA/grant-management directory: a reviewer
 * may discover only active employees covered by the same exact timeline
 * resolver that protects the final read.
 */
export const GET = withWorkforceSessionAuth("read", async (req: NextRequest, auth) => {
  const { searchParams } = new URL(req.url)
  const parsedQuery = Query.safeParse(searchParams.get("q"))
  const accessContext = parseWorkforceEvidenceAccessContext(req.headers)
  if (!parsedQuery.success || !accessContext) {
    return sensitiveJson({
      error: "Search requires a purpose, reason code and two to eighty characters.",
      code: "WORKFORCE_EVIDENCE_TARGET_SEARCH_INVALID",
    }, 400)
  }

  const rateLimited = await requireWorkforceEvidenceTimelineRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  const directoryAccess = await resolveWorkforceEvidenceDirectoryAccess({
    organizationId: auth.orgId,
    auth,
  })
  if (directoryAccess instanceof Response) return directoryAccess

  try {
    const contains = { contains: parsedQuery.data, mode: "insensitive" as const }
    const agents = await prisma.mtmAgent.findMany({
      where: {
        organizationId: auth.orgId,
        status: "ACTIVE",
        ...(directoryAccess.mode === "EXACT_AGENTS"
          ? { id: { in: [...directoryAccess.agentIds] } }
          : {}),
        OR: [{ name: contains }, { email: contains }, { externalCode: contains }],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: TARGET_LIMIT + 1,
      select: { id: true, name: true, email: true, externalCode: true },
    })
    const hasMore = agents.length > TARGET_LIMIT
    const items = agents.slice(0, TARGET_LIMIT).map((agent) => ({
      id: agent.id,
      label: [agent.name, agent.externalCode ?? agent.email].filter(Boolean).join(" · "),
    }))

    const ipAddress = clientIp(req)
    await prisma.auditLog.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.userId,
        action: "read",
        entityType: "workforce_evidence_target_search",
        entityId: null,
        entityName: null,
        newValue: {
          event: "WORKFORCE_DERIVED_EVIDENCE_TARGETS_SEARCHED",
          purpose: accessContext.purpose,
          reasonCode: accessContext.reasonCode,
          caseReference: accessContext.caseReference,
          queryLength: parsedQuery.data.length,
          resultCount: items.length,
          hasMore,
          projection: "ACTIVE_NAMED_EMPLOYEES_ONLY",
        },
        ipAddress: ipAddress === "unknown" ? null : ipAddress,
        userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    })

    return sensitiveJson({ success: true, data: { items, hasMore } })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "search-evidence-timeline-targets" })
    return sensitiveJson({
      error: "Workforce evidence employee search is unavailable.",
      code: "WORKFORCE_EVIDENCE_TARGET_SEARCH_UNAVAILABLE",
    }, 503)
  }
})
