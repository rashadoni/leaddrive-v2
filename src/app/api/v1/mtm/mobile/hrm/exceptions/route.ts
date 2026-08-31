import { NextResponse } from "next/server"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { prisma } from "@/lib/prisma"

const MAX_SELF_EXCEPTION_CASES = 100

/**
 * GET /api/v1/mtm/mobile/hrm/exceptions
 *
 * A narrow mobile projection for the authenticated employee's own exception
 * cards. It is intentionally separate from history: an unavailable future
 * exception migration must not make normal Work Time history unavailable.
 * No raw evidence, reason, location, QR, device material or response-ledger
 * state crosses this boundary.
 */
export const GET = withMobileRls(async (_req, auth) => {
  const forbidden = requireMobilePermission(auth, "WORKTIME_SELF_READ")
  if (forbidden) return forbidden

  try {
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: auth.agentId, organizationId: auth.orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) {
      return NextResponse.json({ error: "Workforce employee is not available" }, { status: 404 })
    }

    const cases = await prisma.workforceExceptionCase.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: agent.id,
        workdayId: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SELF_EXCEPTION_CASES + 1,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        workday: { select: { id: true, workDate: true } },
      },
    })
    if (cases.length > MAX_SELF_EXCEPTION_CASES) {
      return NextResponse.json({
        error: "Too many personal Workforce exceptions for one safe mobile page",
        code: "WORKFORCE_SELF_EXCEPTION_LIMIT_EXCEEDED",
      }, { status: 413 })
    }

    return NextResponse.json({
      success: true,
      data: {
        disposition: "SELF_SERVICE_CORRECTION_ONLY",
        responseRecording: "MIGRATION_REQUIRED",
        cases: cases.flatMap((item) => item.workday ? [{
          caseId: item.id,
          displayReference: `WF-${item.id.slice(-8)}`,
          type: item.kind,
          createdAt: item.createdAt,
          workdayId: item.workday.id,
          workDate: item.workday.workDate,
          availableAction: "REQUEST_CORRECTION" as const,
        }] : []),
      },
    }, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
  } catch (error) {
    console.error("[MTM/mobile/hrm/exceptions GET]", error)
    return NextResponse.json({ error: "Failed to load personal Workforce exceptions" }, { status: 500 })
  }
}, { requiredCapability: "workforce-hrm" })
