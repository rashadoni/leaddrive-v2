import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { resolveWorkforceExceptionResponseRecording } from "@/lib/workforce/exception-response-rollout"

const MAX_SELF_EXCEPTION_CASES = 100

function scopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

/**
 * GET /api/v1/workforce/exceptions/mine
 *
 * Employee discovery is deliberately self-scoped and raw-proof-free. It
 * returns only the own exception's generic type and exact owned workday link
 * needed to open the existing correction-request workflow. It never reads
 * decision reasons, location, QR/device evidence or employee response rows
 * unless a separately named, post-migration tenant rollout flag is enabled.
 */
export const GET = withWorkforceSessionAuth("read", async (_req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor || actor.role !== "AGENT" || !actor.agentId) return scopeDenied()

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { features: true },
    })
    // A missing organization or unknown flag shape remains the safe disabled
    // state. The response table must not be queried before an explicit rollout.
    const responseRecording = resolveWorkforceExceptionResponseRecording(organization?.features)
    const cases = await prisma.workforceExceptionCase.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: actor.agentId,
        workdayId: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SELF_EXCEPTION_CASES + 1,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        workday: { select: { id: true, workDate: true } },
        ...(responseRecording === "AVAILABLE"
          ? { employeeResponses: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } } }
          : {}),
      },
    })
    if (cases.length > MAX_SELF_EXCEPTION_CASES) {
      return NextResponse.json({
        error: "Too many personal exception cases for one safe page; narrow the date range first",
        code: "WORKFORCE_SELF_EXCEPTION_LIMIT_EXCEEDED",
      }, { status: 413 })
    }
    return NextResponse.json({
      success: true,
      data: {
        disposition: "SELF_SERVICE_CORRECTION_ONLY",
        responseRecording,
        cases: cases.flatMap((item) => item.workday ? [{
          caseId: item.id,
          displayReference: `WF-${item.id.slice(-8)}`,
          type: item.kind,
          createdAt: item.createdAt,
          workdayId: item.workday.id,
          workDate: item.workday.workDate,
          availableAction: "REQUEST_CORRECTION" as const,
          // The cast is deliberately guarded by the same branch that adds the
          // Prisma relation select. A disabled tenant never reads the
          // additive response table, even to discover an empty state.
          responseState: responseRecording === "AVAILABLE"
            && "employeeResponses" in item
            && Array.isArray(item.employeeResponses)
            && item.employeeResponses.length > 0
            ? "ACKNOWLEDGED" as const
            : responseRecording === "AVAILABLE"
              ? "NOT_ACKNOWLEDGED" as const
              : "UNAVAILABLE" as const,
        }] : []),
      },
    }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
  } catch (error) {
    console.error("[workforce/exceptions/mine GET]", error)
    return NextResponse.json({ error: "Failed to load personal Workforce exceptions" }, { status: 500 })
  }
})
