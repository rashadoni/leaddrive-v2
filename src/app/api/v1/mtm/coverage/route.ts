import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { readGovernedCoverage } from "@/lib/mtm/coverage-read"

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function validDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false
  const parsed = utcDate(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function unavailable(state: string, details: Record<string, unknown> = {}) {
  return NextResponse.json({
    success: true,
    data: { available: false, state, ...details },
  })
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_COVERAGE_SCOPE_DENIED" }, { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const agentId = params.get("agentId")?.trim() || actor.agentId || ""
  const periodStart = params.get("periodStart")?.trim() ?? ""
  const periodEnd = params.get("periodEnd")?.trim() ?? ""
  if (!agentId || !validDateKey(periodStart) || !validDateKey(periodEnd) || periodEnd < periodStart) {
    return NextResponse.json({
      error: "agentId, periodStart and periodEnd are required",
      code: "MTM_COVERAGE_INPUT_INVALID",
    }, { status: 400 })
  }
  const start = utcDate(periodStart)
  const end = utcDate(periodEnd)
  const durationDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (durationDays > 366) {
    return NextResponse.json({
      error: "Coverage period cannot exceed 366 days",
      code: "MTM_COVERAGE_PERIOD_TOO_LARGE",
    }, { status: 400 })
  }
  if (!isAgentInRouteScope(actor, agentId)) {
    return NextResponse.json({ error: "Not found", code: "MTM_COVERAGE_AGENT_NOT_FOUND" }, { status: 404 })
  }

  const targetAgent = await prisma.mtmAgent.findFirst({
    where: { id: agentId, organizationId: auth.orgId, status: "ACTIVE" },
    select: { id: true, name: true },
  })
  if (!targetAgent) {
    return NextResponse.json({ error: "Not found", code: "MTM_COVERAGE_AGENT_NOT_FOUND" }, { status: 404 })
  }

  const coverage = await readGovernedCoverage(prisma, {
    organizationId: auth.orgId,
    agentId,
    periodStart: start,
    periodEnd: end,
    periodStartKey: periodStart,
    periodEndKey: periodEnd,
  })
  if (!coverage.available) {
    return unavailable(coverage.state, {
      agent: targetAgent,
      period: coverage.period,
      ...(coverage.policy ? { policy: coverage.policy } : {}),
      ...(coverage.snapshot ? {
        snapshot: {
          id: coverage.snapshot.id,
          sourceCutoffAt: coverage.snapshot.sourceCutoffAt,
          sourceFreshnessAt: coverage.snapshot.sourceFreshnessAt,
          frozenAt: coverage.snapshot.frozenAt,
        },
      } : {}),
    })
  }

  return NextResponse.json({
    success: true,
    data: {
      available: true,
      state: "READY",
      agent: targetAgent,
      period: coverage.period,
      policy: coverage.policy,
      snapshot: coverage.snapshot,
      totals: coverage.totals,
    },
  })
})
