import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { buildGoogleAlertsAddress } from "@/lib/social/google-alerts-address"
import { getMonitoringScenarios } from "@/lib/social/monitoring-scenarios"
import { prisma } from "@/lib/prisma"

function newestDate(values: Array<Date | null>): Date | null {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest
    return !latest || value.getTime() > latest.getTime() ? value : latest
  }, null)
}

export const GET = withRlsAuth("social", "read", async (_req, auth) => {
  const scenarios = (await getMonitoringScenarios(auth.orgId)).filter(scenario =>
    scenario.status === "active"
    && (scenario.platforms.length === 0 || scenario.platforms.includes("web")),
  )
  const terms = Array.from(new Set(scenarios.flatMap(scenario => [
    ...scenario.search.topics,
    ...scenario.search.keywords,
    ...scenario.search.hashtags,
    ...scenario.search.handles,
  ]).map(term => term.trim()).filter(Boolean)))
  // Подключённые RSS-ленты Google Alerts живут как notification_inbox и в
  // счётчики бесплатного новостного канала (search_index) не попадали — из-за
  // этого карточка не подтверждала, что лента вообще подключена и жива.
  // Отвязанные ленты остаются строкой с managedBy, поэтому фильтруем по
  // googleAlertsRss.configured — иначе карточка вечно показывала бы «подключено».
  const rssSources = await prisma.monitoringSource.findMany({
    where: {
      organizationId: auth.orgId,
      platform: "web",
      collectionMode: "notification_inbox",
      settings: { path: ["managedBy"], equals: "google_alerts_rss" },
      AND: [{ settings: { path: ["googleAlertsRss", "configured"], equals: true } }],
    },
    select: {
      status: true,
      lastCheckedAt: true,
      lastSuccessfulAt: true,
      lastError: true,
      // Последний прогон каждой ленты — единственный достоверный признак
      // здоровья: source.lastError обнуляется при любом сохранении сценария
      // и на каждом проходе крона, поэтому судить по нему нельзя.
      collectorRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          status: true,
          startedAt: true,
          finishedAt: true,
          foundCount: true,
          newCount: true,
          error: true,
        },
      },
    },
  })

  return NextResponse.json({
    success: true,
    data: {
      intakeAddress: buildGoogleAlertsAddress(auth.orgId),
      activeScenarioCount: scenarios.length,
      terms,
      autoSyncAvailable: false,
      automaticScenarioSyncAvailable: true,
      // Прямой обход изданий выведен из эксплуатации (веб = только ленты
      // Google Alerts). Пустышка остаётся в ответе, потому что приложение —
      // PWA: у клиента может быть закэширован старый бандл, который читает
      // это поле без защиты и без него уронил бы всю страницу.
      automaticCollection: {
        sourceCount: 0,
        activeSourceCount: 0,
        publishers: [],
        lastCheckedAt: null,
        lastSuccessfulAt: null,
        latestRun: null,
      },
      rssFeeds: {
        connectedCount: rssSources.length,
        // Собирает только живой статус; «paused» лента подключена, но не опрашивается.
        activeCount: rssSources.filter(source =>
          ["active", "limited", "needs_setup"].includes(source.status),
        ).length,
        // Ошибка — по последнему прогону ленты (source.lastError затирается
        // сохранением сценария), плюс ещё не затёртый lastError как запасной сигнал.
        failingCount: rssSources.filter(source =>
          source.collectorRuns[0]?.status === "failed"
          || Boolean(source.collectorRuns[0]?.error)
          || Boolean(source.lastError),
        ).length,
        // Лента считается пустой, только когда ВСЕ ленты успешно отработали и
        // не принесли ни одной записи — org-wide «последний прогон» врал бы
        // про здоровые ленты в организации с несколькими клиентами.
        allEmpty: rssSources.length > 0 && rssSources.every(source => {
          const run = source.collectorRuns[0]
          return run ? run.status !== "failed" && !run.error && run.foundCount === 0 : false
        }),
        lastCheckedAt: newestDate(rssSources.map(source => source.lastCheckedAt)),
        lastSuccessfulAt: newestDate(rssSources.map(source => source.lastSuccessfulAt)),
        foundOnLastRuns: rssSources.reduce((total, source) => total + (source.collectorRuns[0]?.foundCount ?? 0), 0),
        createdOnLastRuns: rssSources.reduce((total, source) => total + (source.collectorRuns[0]?.newCount ?? 0), 0),
        hasRuns: rssSources.some(source => source.collectorRuns.length > 0),
      },
      authenticationRequired: "google_dkim",
    },
  })
})
