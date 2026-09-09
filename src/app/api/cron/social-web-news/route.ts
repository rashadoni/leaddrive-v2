import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { runMonitoringSourceNow } from "@/lib/social/monitoring-collector"
import {
  getMonitoringScenariosUncached,
  syncMonitoringScenarioSources,
} from "@/lib/social/monitoring-scenarios"
import { syncGoogleAlertsRssSource } from "@/lib/social/google-alerts-rss"
import { monitoringSourceIdentityRole } from "@/lib/social/monitoring-source-identity"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

const MAX_WEB_SCENARIOS_PER_RUN = 100
const MAX_WEB_SOURCES_PER_RUN = MAX_WEB_SCENARIOS_PER_RUN * 2

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sourceScenarioIds(source: {
  settings: unknown
  subjectSources: Array<{ scenarioId: string | null }>
}): string[] {
  const settings = record(source.settings)
  const scenarioLinks = Array.isArray(settings.scenarioLinks) ? settings.scenarioLinks : []
  return Array.from(new Set([
    ...source.subjectSources.map(link => link.scenarioId),
    typeof settings.scenarioId === "string" ? settings.scenarioId : null,
    ...scenarioLinks.map(link => {
      const scenarioId = record(link).scenarioId
      return typeof scenarioId === "string" ? scenarioId : null
    }),
  ].filter((scenarioId): scenarioId is string => Boolean(scenarioId))))
}

function currentWebRouteKind(source: {
  platform: string
  sourceType: string
  collectionMode: string
  query: string | null
  settings: unknown
}, scenarioId: string): "direct" | "rss" | null {
  if (source.platform !== "web") return null
  const settings = record(source.settings)
  if (
    source.sourceType === "notification_inbox"
    && source.collectionMode === "notification_inbox"
    && source.query === `google-alerts-rss:${scenarioId}`
    && settings.managedBy === "google_alerts_rss"
    && settings.scenarioId === scenarioId
  ) return "rss"
  if (
    source.sourceType === "keyword"
    && source.collectionMode === "search_index"
    && Boolean(source.query?.trim())
    && settings.canonicalBrandQuery === true
  ) return "direct"
  return null
}

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    const organizationSlug = new URL(req.url).searchParams.get("organizationSlug")?.trim()
    if (!organizationSlug) {
      return NextResponse.json({ error: "organizationSlug is required" }, { status: 400 })
    }

    try {
      const organization = await prisma.organization.findFirst({
        where: { slug: organizationSlug },
        select: { id: true },
      })
      if (!organization) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 })
      }

      const scenarios = await getMonitoringScenariosUncached(organization.id)
      const activeWebScenarios = scenarios.filter(scenario =>
        scenario.status === "active" && scenario.platforms.includes("web"))
      const subjectIds = activeWebScenarios
        .map(scenario => scenario.subjectId)
        .filter((subjectId): subjectId is string => Boolean(subjectId))
      const activeSubjects = subjectIds.length === 0
        ? []
        : await prisma.monitoringSubject.findMany({
          where: {
            organizationId: organization.id,
            id: { in: subjectIds },
            status: "active",
          },
          select: { id: true },
        })
      const activeSubjectIds = new Set(activeSubjects.map(subject => subject.id))
      const runnableScenarios = activeWebScenarios.filter(scenario =>
        !scenario.subjectId || activeSubjectIds.has(scenario.subjectId))
      const pausedSubjectScenarios = activeWebScenarios
        .filter(scenario => scenario.subjectId && !activeSubjectIds.has(scenario.subjectId))
        .map(scenario => ({ id: scenario.id, name: scenario.name }))

      // Scenario CRUD already performs this synchronization. Repeating it here
      // repairs legacy rows created before that invariant existed and makes a
      // production run self-healing after interrupted edits.
      const sourceSync = await withSocialMonitoringTenantCollectionFence(
        organization.id,
        async () => {
          for (const scenario of runnableScenarios) {
            await syncMonitoringScenarioSources(organization.id, scenario)
            // The generic sync rebuilds subject links for ordinary sources. Restore
            // the dedicated encrypted RSS source immediately afterwards so the
            // same cron pass can select it, and preserve its hidden feed URL.
            await syncGoogleAlertsRssSource(organization.id, scenario, undefined)
          }
        },
      )
      if (!sourceSync.allowed) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: sourceSync.reason,
          data: {
            organizationId: organization.id,
            activeWebScenarioCount: activeWebScenarios.length,
            runnableWebScenarioCount: runnableScenarios.length,
          },
        })
      }

      const candidates = await prisma.monitoringSource.findMany({
        where: {
          organizationId: organization.id,
          platform: "web",
          status: { in: ["active", "limited", "needs_setup"] },
          // Filter before the bounded take. Otherwise hundreds of legacy or
          // independent Web rows with older/null lastCheckedAt can occupy the
          // whole candidate window and starve every current scenario route.
          OR: [
            {
              sourceType: "keyword",
              collectionMode: "search_index",
              settings: { path: ["canonicalBrandQuery"], equals: true },
            },
            {
              sourceType: "notification_inbox",
              collectionMode: "notification_inbox",
              settings: { path: ["managedBy"], equals: "google_alerts_rss" },
            },
          ],
          subjectSources: {
            some: {
              relationType: "MONITORS",
              scenarioId: { not: null },
              subject: { status: "active" },
            },
          },
        },
        orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }],
        take: 500,
        select: {
          id: true,
          platform: true,
          sourceType: true,
          collectionMode: true,
          query: true,
          handle: true,
          url: true,
          settings: true,
          subjectSources: {
            select: {
              scenarioId: true,
              relationType: true,
              subject: { select: { status: true } },
            },
          },
        },
      })

      const runnableScenarioIds = new Set(runnableScenarios.map(scenario => scenario.id))
      const candidateRoutes = candidates.map(source => ({
        source,
        routes: sourceScenarioIds(source).flatMap((scenarioId) => {
          if (!runnableScenarioIds.has(scenarioId)) return []
          const kind = currentWebRouteKind(source, scenarioId)
          return kind ? [{ scenarioId, kind }] : []
        }),
      }))
      // Candidates are ordered oldest-first by lastCheckedAt. Selecting the
      // first 100 distinct scenarios from that queue rotates every subsequent
      // cron pass instead of permanently pinning the same slice(0, 100).
      const scheduledScenarioIds = new Set<string>()
      for (const candidate of candidateRoutes) {
        for (const { scenarioId } of candidate.routes) {
          if (scheduledScenarioIds.size >= MAX_WEB_SCENARIOS_PER_RUN) break
          scheduledScenarioIds.add(scenarioId)
        }
        if (scheduledScenarioIds.size >= MAX_WEB_SCENARIOS_PER_RUN) break
      }
      // WEB покрывается только лентой Google Alerts (решение владельца
      // 2026-08-01), поэтому сценарий без подключённой ленты источника не
      // имеет и иметь не может — это не сбой синхронизации, а незавершённая
      // настройка. Отделяем его, чтобы он не занимал слот и не ронял прогон.
      const scenariosWithoutFeed = runnableScenarios
        .filter(scenario => scenario.web?.googleAlertsRssConfigured !== true)
        .map(scenario => ({ id: scenario.id, name: scenario.name }))
      const withoutFeedIds = new Set(scenariosWithoutFeed.map(scenario => scenario.id))
      // У синхронизированного сценария с лентой источник обязан быть. Добираем
      // оставшиеся слоты такими сценариями, чтобы сломанная синхронизация
      // попадала в missing, а не молча числилась отложенной.
      for (const scenario of runnableScenarios) {
        if (scheduledScenarioIds.size >= MAX_WEB_SCENARIOS_PER_RUN) break
        if (withoutFeedIds.has(scenario.id)) continue
        scheduledScenarioIds.add(scenario.id)
      }
      const deferredScenarios = runnableScenarios
        .filter(scenario => !scheduledScenarioIds.has(scenario.id))
        .filter(scenario => !withoutFeedIds.has(scenario.id))
        .map(scenario => ({ id: scenario.id, name: scenario.name }))
      const selectedScenarioIds = new Set<string>()
      const selectedRouteKeys = new Set<string>()
      const eligibleSources: Array<{
        id: string
        label: string
        scenarioIds: string[]
      }> = []

      for (const { source, routes } of candidateRoutes) {
        if (monitoringSourceIdentityRole(source.subjectSources) !== "external") continue
        if (!source.subjectSources.some(link => link.subject.status === "active")) continue
        const selectedRoutes = routes.filter(({ scenarioId, kind }) => {
          if (!scheduledScenarioIds.has(scenarioId)) return false
          return !selectedRouteKeys.has(`${scenarioId}:${kind}`)
        })
        const scenarioIds = Array.from(new Set(selectedRoutes.map(route => route.scenarioId)))
        if (scenarioIds.length === 0) continue
        selectedRoutes.forEach(({ scenarioId, kind }) =>
          selectedRouteKeys.add(`${scenarioId}:${kind}`))
        eligibleSources.push({
          id: source.id,
          label: source.query ?? source.handle ?? source.url ?? source.id,
          scenarioIds,
        })
      }

      const results = []
      const failedAttempts: Array<{
        sourceId: string
        scenarioIds: string[]
        error: string
      }> = []
      for (const source of eligibleSources.slice(0, MAX_WEB_SOURCES_PER_RUN)) {
        const result = await runMonitoringSourceNow(organization.id, source.id, {
          onlyCapability: "DISCOVER_POSTS",
        })
        if (!("runId" in result)) {
          failedAttempts.push({
            sourceId: source.id,
            scenarioIds: source.scenarioIds,
            error: result.error,
          })
          continue
        }
        source.scenarioIds.forEach(id => selectedScenarioIds.add(id))
        results.push({ ...source, result })
      }

      const missingScenarios = runnableScenarios
        .filter(scenario => scheduledScenarioIds.has(scenario.id))
        .filter(scenario => !selectedScenarioIds.has(scenario.id))
        .map(scenario => ({ id: scenario.id, name: scenario.name }))
      const summaries = results.map(item => item.result)
      const degradedResults = summaries.filter(item => item.status !== "success")
      const failed = [
        ...failedAttempts,
        ...degradedResults.map(item => ({
          sourceId: item.sourceId,
          scenarioIds: eligibleSources.find(source => source.id === item.sourceId)?.scenarioIds ?? [],
          error: item.error ?? `source_${item.status}`,
        })),
      ]

      return NextResponse.json({
        success: failed.length === 0 && missingScenarios.length === 0,
        data: {
          organizationId: organization.id,
          activeWebScenarioCount: activeWebScenarios.length,
          runnableWebScenarioCount: runnableScenarios.length,
          pausedSubjectScenarios,
          scenariosWithoutFeed,
          selectedSourceCount: results.length,
          attemptedSourceCount: Math.min(eligibleSources.length, MAX_WEB_SOURCES_PER_RUN),
          coveredScenarioCount: selectedScenarioIds.size,
          missingScenarios,
          deferredScenarios,
          failed: failed.map(item => ({
            sourceId: item.sourceId,
            scenarioIds: item.scenarioIds,
            error: item.error,
          })),
          totals: {
            found: summaries.reduce((sum, item) => sum + item.foundCount, 0),
            new: summaries.reduce((sum, item) => sum + item.newCount, 0),
            duplicate: summaries.reduce((sum, item) => sum + item.duplicateCount, 0),
            ignored: summaries.reduce((sum, item) => sum + item.ignoredCount, 0),
          },
          results: summaries.map(item => ({
            runId: item.runId,
            sourceId: item.sourceId,
            status: item.status,
            foundCount: item.foundCount,
            newCount: item.newCount,
            duplicateCount: item.duplicateCount,
            ignoredCount: item.ignoredCount,
            error: item.error,
          })),
        },
      })
    } catch (error) {
      console.error("[cron/social-web-news] error", error)
      return NextResponse.json({ error: "WEB news collector failed" }, { status: 500 })
    }
  })
}
