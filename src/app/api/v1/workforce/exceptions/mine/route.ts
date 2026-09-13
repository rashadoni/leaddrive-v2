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
 * returns only the own exception's generic type and either an exact owned
 * workday link or a schedule-only no-show's expected work date. The latter is
 * view-only: it must not fabricate a workday or make the workday-bound
 * correction/acknowledgement workflow look available. It never reads decision
 * reasons, location, QR/device evidence or employee response rows unless a
 * separately named, post-migration tenant rollout flag is enabled.
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
        OR: [
          { workdayId: { not: null } },
          // A scheduled NO_SHOW legitimately has no accepted START/workday.
          // Limit the schedule-only projection to that exact case shape so a
          // malformed generic case cannot gain employee visibility merely by
          // carrying a date.
          { kind: "NO_SHOW", workdayId: null, expectedWorkDate: { not: null } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SELF_EXCEPTION_CASES + 1,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        expectedWorkDate: true,
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
        cases: cases.flatMap((item) => {
          const responseState = responseRecording === "AVAILABLE"
            && "employeeResponses" in item
            && Array.isArray(item.employeeResponses)
            && item.employeeResponses.length > 0
            ? "ACKNOWLEDGED" as const
            : responseRecording === "AVAILABLE"
              ? "NOT_ACKNOWLEDGED" as const
              : "UNAVAILABLE" as const
          if (item.workday) {
            return [{
              caseId: item.id,
              displayReference: `WF-${item.id.slice(-8)}`,
              type: item.kind,
              createdAt: item.createdAt,
              workdayId: item.workday.id,
              workDate: item.workday.workDate,
              availableAction: "REQUEST_CORRECTION" as const,
              responseState,
            }]
          }
          if (item.kind === "NO_SHOW" && item.expectedWorkDate) {
            return [{
              caseId: item.id,
              displayReference: `WF-${item.id.slice(-8)}`,
              type: item.kind,
              createdAt: item.createdAt,
              workdayId: null,
              workDate: item.expectedWorkDate,
              availableAction: "VIEW_ONLY_NO_SHOW" as const,
              // Employee responses are intentionally workday-bound. A
              // schedule-only case exposes no acknowledgement button even
              // after the additive response ledger has rolled out.
              responseState: "UNAVAILABLE" as const,
            }]
          }
          return []
        }),
      },
    }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
  } catch (error) {
    console.error("[workforce/exceptions/mine GET]", error)
    return NextResponse.json({ error: "Failed to load personal Workforce exceptions" }, { status: 500 })
  }
})
