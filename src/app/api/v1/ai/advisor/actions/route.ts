import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { buildAdvisorAutonomyPolicy, parseAdvisorTenantAutonomySettings } from "@/lib/ai/advisor/autonomy"
import { getAdvisorPayload } from "@/lib/ai/advisor/service"
import type { AdvisorAction, AdvisorSignal } from "@/lib/ai/advisor/types"

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  const body = await req.json().catch(() => null) as { signal?: AdvisorSignal; action?: AdvisorAction } | null
  const sourceSignalId = body?.signal?.id
  const requestedActionType = body?.action?.actionType

  if (!sourceSignalId || !requestedActionType) {
    return NextResponse.json({ error: "signal and action are required" }, { status: 400 })
  }

  const payload = await getAdvisorPayload(auth.orgId, auth.role, auth.userId)
  const signal = payload.signals.find((item) => item.id === sourceSignalId)
  const action = signal?.recommendedActions.find((item) => item.actionType === requestedActionType)

  if (!signal || !action) {
    return NextResponse.json({ error: "Advisor action is no longer valid for the current scope" }, { status: 409 })
  }
  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { settings: true },
  })
  const autonomy = buildAdvisorAutonomyPolicy(action.actionType, action.risk, parseAdvisorTenantAutonomySettings(org?.settings))

  const existing = await prisma.aiShadowAction.findFirst({
    where: {
      organizationId: auth.orgId,
      featureName: "advisor_signal",
      entityType: signal.entityType,
      entityId: signal.entityId,
      actionType: action.actionType,
      sourceSignalId: signal.id,
      approved: null,
    },
    orderBy: { createdAt: "desc" },
  })

  if (existing) {
    return NextResponse.json({ data: existing, duplicate: true })
  }

  const created = await prisma.aiShadowAction.create({
    data: {
      organizationId: auth.orgId,
      featureName: "advisor_signal",
      entityType: signal.entityType,
      entityId: signal.entityId,
      actionType: action.actionType,
      riskLevel: action.risk,
      sourceSignalId: signal.id,
      evidenceSnapshot: {
        title: signal.title,
        summary: signal.summary,
        facts: signal.facts,
        sources: signal.sources,
        detectedAt: signal.detectedAt,
      },
      executionStatus: "pending",
      payload: {
        ...action.payload,
        advisor: {
          signalId: signal.id,
          domain: signal.domain,
          severity: signal.severity,
          ownerId: signal.ownerId || null,
          ownerLabel: signal.ownerLabel || null,
          title: signal.title,
          summary: signal.summary,
          facts: signal.facts,
          sources: signal.sources,
          actionLabel: action.label,
          risk: action.risk,
          autonomy,
          queuedAt: new Date().toISOString(),
        },
      },
    },
  })

  return NextResponse.json({ data: created }, { status: 201 })
})
