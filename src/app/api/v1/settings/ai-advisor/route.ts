import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isManagerOrAbove } from "@/lib/constants"
import { withRlsAuth } from "@/lib/with-rls"
import {
  DEFAULT_ADVISOR_EXECUTION_ACTION_TYPE_DAILY_LIMIT,
  DEFAULT_ADVISOR_EXECUTION_DAILY_LIMIT,
  parseAdvisorExecutionSettings,
} from "@/lib/ai/advisor/execution-guardrails"
import { listAdvisorPlaybookCandidates, listAdvisorPlaybooksWithGovernance, promoteAdvisorPlaybook } from "@/lib/ai/advisor/playbooks"
import { parseAdvisorTenantAutonomySettings, type AdvisorAutonomyLevel } from "@/lib/ai/advisor/autonomy"
import { getAdvisorPayload } from "@/lib/ai/advisor/service"
import type { AdvisorPayload } from "@/lib/ai/advisor/types"

const LOOKBACK_DAYS = 90
const AUTONOMY_LEVELS = new Set(["L0", "L1", "L2", "L3", "L4"])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function candidateSince(now = new Date()) {
  return new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
}

function normalizePositiveInt(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function assertAdvisorAdmin(role: string) {
  return role === "admin" || role === "superadmin"
}

function buildAdvisorReadinessSummary(payload: AdvisorPayload) {
  const enabledModules = payload.capabilities.filter((capability) => capability.status === "active").length
  const disabledModules = payload.capabilities.filter((capability) => capability.status === "locked").length
  const noAccessModules = payload.capabilities.filter((capability) => capability.status === "no_access").length
  const activeCollectors = payload.collectorHealth.filter((health) => health.status === "active").length
  const noDataCollectors = payload.collectorHealth.filter((health) => health.status === "no_data").length
  const failedCollectors = payload.collectorHealth.filter((health) => health.status === "collector_failed").length
  const disabledCollectors = payload.collectorHealth.filter((health) => health.status === "disabled").length
  const noPermissionCollectors = payload.collectorHealth.filter((health) => health.status === "no_permission").length

  return {
    enabledModules,
    disabledModules,
    noAccessModules,
    activeCollectors,
    noDataCollectors,
    failedCollectors,
    disabledCollectors,
    noPermissionCollectors,
    overallStatus: failedCollectors > 0
      ? "collector_failed"
      : activeCollectors > 0
        ? "active"
        : noDataCollectors > 0
          ? "no_data"
          : noPermissionCollectors > 0
            ? "no_permission"
            : "disabled",
  }
}

function buildAdvisorHealthSnapshot(payload: AdvisorPayload) {
  const checkedTimes = payload.collectorHealth
    .map((health) => new Date(health.checkedAt).getTime())
    .filter(Number.isFinite)
  const generatedAt = checkedTimes.length > 0 ? new Date(Math.max(...checkedTimes)).toISOString() : new Date().toISOString()
  return {
    generatedAt,
    overallStatus: buildAdvisorReadinessSummary(payload).overallStatus,
    totalCollectors: payload.collectorHealth.length,
    failedDomains: payload.collectorHealth
      .filter((health) => health.status === "collector_failed")
      .map((health) => ({ domain: health.domain, label: health.domainLabel, reason: health.reason || null, checkedAt: health.checkedAt })),
    noDataDomains: payload.collectorHealth
      .filter((health) => health.status === "no_data")
      .map((health) => ({ domain: health.domain, label: health.domainLabel, reason: health.reason || null, checkedAt: health.checkedAt })),
  }
}

function buildCollectorFailureAlerts(payload: AdvisorPayload) {
  return payload.collectorHealth
    .filter((health) => health.status === "collector_failed")
    .map((health) => ({
      id: `collector_failed:${health.domain}`,
      domain: health.domain,
      domainLabel: health.domainLabel,
      severity: "critical" as const,
      message: health.reason || `${health.domainLabel} collector failed during the latest Advisor refresh.`,
      checkedAt: health.checkedAt,
    }))
}

function formatFailedExecution(row: {
  id: string
  actionType: string
  entityType: string
  entityId: string
  payload: unknown
  failureReason: string | null
  createdAt: Date
  executedAt: Date | null
  reviewedAt: Date | null
}) {
  const payload = asRecord(row.payload)
  const advisor = asRecord(payload.advisor)
  return {
    id: row.id,
    actionType: row.actionType,
    entityType: row.entityType,
    entityId: row.entityId,
    domain: stringValue(advisor.domain) || "advisor",
    title: stringValue(advisor.title) || stringValue(payload.title) || stringValue(payload.subject) || row.actionType.replace(/_/g, " "),
    failureReason: row.failureReason || "Execution failed without a recorded reason.",
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() || null,
    executedAt: row.executedAt?.toISOString() || null,
  }
}

async function buildAdvisorSettingsPayload(organizationId: string, role: string, userId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  const settings = (org?.settings as Record<string, unknown>) || {}
  const [playbooks, candidates, payload, failedExecutionRows] = await Promise.all([
    listAdvisorPlaybooksWithGovernance(organizationId).catch(() => []),
    listAdvisorPlaybookCandidates(organizationId, candidateSince()).catch(() => []),
    getAdvisorPayload(organizationId, role, userId),
    prisma.aiShadowAction.findMany({
      where: {
        organizationId,
        featureName: "advisor_signal",
        executionStatus: "failed",
      },
      select: {
        id: true,
        actionType: true,
        entityType: true,
        entityId: true,
        payload: true,
        failureReason: true,
        createdAt: true,
        reviewedAt: true,
        executedAt: true,
      },
      orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
    }).catch(() => []),
  ])
  const execution = parseAdvisorExecutionSettings(settings)
  const autonomy = parseAdvisorTenantAutonomySettings(settings)
  const summary = buildAdvisorReadinessSummary(payload)

  return {
    settings: {
      executionEnabled: execution.executionEnabled,
      dailyLimit: execution.dailyLimit,
      actionTypeDailyLimit: execution.actionTypeDailyLimit,
      maxAutonomyLevel: autonomy.maxAutonomyLevel,
    },
    readiness: {
      summary,
      overview: payload.overview,
      capabilities: payload.capabilities,
      collectorHealth: payload.collectorHealth,
      healthSnapshot: buildAdvisorHealthSnapshot(payload),
    },
    monitoring: {
      collectorAlerts: buildCollectorFailureAlerts(payload),
      failedExecutions: failedExecutionRows.map(formatFailedExecution),
    },
    playbooks,
    candidates,
  }
}

export const GET = withRlsAuth("settings", "read", async (_req, auth) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return NextResponse.json({ data: await buildAdvisorSettingsPayload(auth.orgId, auth.role, auth.userId) })
})

export const PATCH = withRlsAuth("settings", "write", async (req, auth) => {
  if (!assertAdvisorAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as {
    executionEnabled?: boolean
    dailyLimit?: number
    actionTypeDailyLimit?: number
    maxAutonomyLevel?: AdvisorAutonomyLevel
    playbookId?: string
    playbookStatus?: "disabled" | "enabled"
  } | null
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (body.playbookId) {
    if (body.playbookStatus !== "disabled" && body.playbookStatus !== "enabled") {
      return NextResponse.json({ error: "playbookStatus must be disabled or enabled" }, { status: 400 })
    }
    const updated = await prisma.advisorPlaybook.updateMany({
      where: { id: body.playbookId, organizationId: auth.orgId },
      data: { status: body.playbookStatus },
    })
    if (updated.count !== 1) return NextResponse.json({ error: "Playbook not found" }, { status: 404 })
    return NextResponse.json({ data: await buildAdvisorSettingsPayload(auth.orgId, auth.role, auth.userId) })
  }

  const org = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { settings: true },
  })
  const settings = { ...((org?.settings as Record<string, unknown>) || {}) }

  if (typeof body.executionEnabled === "boolean") {
    settings.aiAdvisorExecutionEnabled = body.executionEnabled
    settings.aiAdvisorExecutionDisabled = !body.executionEnabled
  }
  if (body.dailyLimit !== undefined) {
    settings.aiAdvisorExecutionDailyLimit = normalizePositiveInt(body.dailyLimit, DEFAULT_ADVISOR_EXECUTION_DAILY_LIMIT, 500)
  }
  if (body.actionTypeDailyLimit !== undefined) {
    settings.aiAdvisorActionTypeDailyLimit = normalizePositiveInt(body.actionTypeDailyLimit, DEFAULT_ADVISOR_EXECUTION_ACTION_TYPE_DAILY_LIMIT, 100)
  }
  if (body.maxAutonomyLevel !== undefined) {
    if (!AUTONOMY_LEVELS.has(body.maxAutonomyLevel)) {
      return NextResponse.json({ error: "Invalid maxAutonomyLevel" }, { status: 400 })
    }
    settings.aiAdvisorMaxAutonomyLevel = body.maxAutonomyLevel
  }

  await prisma.organization.update({
    where: { id: auth.orgId },
    data: { settings },
  })

  return NextResponse.json({ data: await buildAdvisorSettingsPayload(auth.orgId, auth.role, auth.userId) })
})

export const POST = withRlsAuth("settings", "write", async (req, auth) => {
  if (!assertAdvisorAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { patternKey?: string } | null
  if (!body?.patternKey) {
    return NextResponse.json({ error: "patternKey is required" }, { status: 400 })
  }

  const playbook = await promoteAdvisorPlaybook({
    organizationId: auth.orgId,
    patternKey: body.patternKey,
    promotedBy: auth.userId,
    since: candidateSince(),
  })
  if (!playbook) {
    return NextResponse.json({ error: "No promotable playbook candidate found" }, { status: 404 })
  }

  return NextResponse.json({ data: playbook }, { status: 201 })
})
