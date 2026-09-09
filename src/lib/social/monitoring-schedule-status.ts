import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSocialMonitoringSettings } from "@/lib/social/monitoring-settings"
import { automaticSourceCollectionDecision } from "@/lib/social/automatic-collection-policy"
import { SOURCE_ROUTE_POLICY_VERSION } from "@/lib/social/source-route-plan"

/**
 * Имя строки пульса в `system_job_leases`. Планировщик отмечается в ней на
 * каждом тике; это единственное доказательство, что системная строка
 * планировщика до приложения доходит.
 *
 * Строка живёт в той же таблице, что и лизы задач, но лизой НЕ является:
 * `status` остаётся idle, `leaseUntil` — NULL. Иначе карантин деплоя
 * (`scripts/server-deploy.sh`, считает running-лизы) видел бы её как занятую
 * задачу.
 */
export const SOCIAL_MONITORING_SCHEDULE_JOB = "social-monitoring-sources"

/**
 * Планировщик стучится каждые 5 минут. Порог намеренно выше: одиночный
 * пропущенный тик — норма (деплой, долгий обход), а полчаса тишины уже
 * означает, что расписание не работает.
 */
export const SCHEDULE_HEARTBEAT_STALE_MINUTES = 30

/**
 * Запас поверх каденции, после которого источник считается просроченным.
 * Обход берёт ограниченную порцию за тик и уважает бэкофф после неудач,
 * поэтому небольшое опоздание штатно. Час отделяет его от настоящего застоя.
 */
export const SOURCE_OVERDUE_GRACE_MINUTES = 60

/** Потолок выборки: панель показывает счётчики, а не список. */
const STATUS_SOURCE_SCAN_LIMIT = 500

const SCHEDULABLE_SOURCE_STATUSES = ["active", "limited", "needs_setup"]

export type SocialMonitoringScheduleStatus = {
  /** Разрешён ли сбор по расписанию для этого клиента. */
  enabled: boolean
  /** Каденция расписания тенанта — именно она, а не поле карточки источника. */
  cadenceMinutes: number
  /** Когда планировщик последний раз доходил до приложения. */
  lastTickAt: string | null
  lastTickMinutesAgo: number | null
  /** Планировщик отвечает. false = он снят на сервере или падает. */
  responding: boolean
  /** Источники, которые обход реально берёт по расписанию. */
  scheduledSources: number
  /**
   * Источники, которые обход не берёт вообще: помеченные «только вручную»,
   * исторические web-строки сценария, постоянные отказы политики автосбора.
   * Без этого счётчика они исчезают из панели совсем — и «TikTok не
   * собирается четыре дня» снова выглядит как тишина (#665).
   */
  excludedSources: number
  /** Из них просрочены сверх запаса. */
  overdueSources: number
  maxOverdueMinutes: number | null
  /** Никогда не собирались, хотя созданы давно. */
  neverCollectedSources: number
  /**
   * Собираются, но последний прогон закончился ошибкой. Без этого счётчика
   * панель зеленела бы при стабильно падающем сборе: отметка проверки
   * обновляется при любом исходе, включая неудачный.
   */
  failingSources: number
  nextDueAt: string | null
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
}

/**
 * Отмечает приход планировщика. Вызывается маршрутом крона до обхода.
 */
export async function recordSocialMonitoringScheduleTick(now = new Date()): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "system_job_leases" (
      "name", "status", "lastStartedAt", "lastCompletedAt",
      "claimedCount", "completedCount", "skippedCount", "failedCount", "updatedAt"
    )
    VALUES (${SOCIAL_MONITORING_SCHEDULE_JOB}, 'idle', ${now}, ${now}, 0, 0, 0, 0, ${now})
    ON CONFLICT ("name") DO UPDATE
    SET "lastCompletedAt" = ${now},
        "lastStartedAt" = ${now},
        "updatedAt" = ${now}
  `
}

type ScheduleSourceRow = {
  createdAt: Date
  lastCheckedAt: Date | null
  lastError: string | null
  platform: string
  sourceType: string
  url: string | null
  handle: string | null
  ownership: string
  status: string
  collectionMode: string
  settings: Prisma.JsonValue
  routePlans: Array<{
    status: string
    capability: string
    primaryAdapter: string
    fallbackAdapters: string[]
    capabilityProofId: string | null
    budget: Prisma.JsonValue
    policyVersion: string | null
    dependsOnCapability: string | null
    lastFailureClass: string | null
  }>
  subjectSources: Array<{
    relationType: string
    scenarioId: string | null
    subject: { status: string }
  }>
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Берёт ли планировщик этот источник вообще.
 *
 * Зеркалит отбор `findDueMonitoringSources`, потому что иначе панель считала
 * бы просроченными строки, которые обход не берёт by design: исторические
 * web-строки (сценарию положена только лента Google Alerts) и источники с
 * постоянным отказом политики автосбора. Их `lastCheckedAt` заморожен
 * навсегда — панель светила бы «Отстаёт» вечно, и жёлтому предупреждению
 * перестали бы верить ровно так же, как раньше верили тишине.
 */
function participatesInSchedule(source: ScheduleSourceRow, organizationSettings: unknown): boolean {
  if (source.platform === "web") {
    const settings = recordFrom(source.settings)
    const scenarioLinked = source.subjectSources.some(link => link.scenarioId)
      || typeof settings.scenarioId === "string"
      || Array.isArray(settings.scenarioLinks) && settings.scenarioLinks.length > 0
    const googleAlertsInbox = source.sourceType === "notification_inbox"
      && source.collectionMode === "notification_inbox"
      && settings.managedBy === "google_alerts_rss"
    if (scenarioLinked && !googleAlertsInbox) return false
  }
  return automaticSourceCollectionDecision({
    settings: source.settings,
    platform: source.platform,
    sourceType: source.sourceType,
    url: source.url,
    handle: source.handle,
    ownership: source.ownership,
    linkedSubjectStatuses: source.subjectSources.map(link => link.subject.status),
    linkedSubjectRelations: source.subjectSources,
    routePlans: source.routePlans,
    organizationSettings,
    currentRoutePolicyVersion: SOURCE_ROUTE_POLICY_VERSION,
  }).allowed
}

/**
 * Состояние сбора по расписанию для страницы соцмониторинга (#665).
 *
 * Считает независимые вещи, потому что тишина в ленте означает любую из них:
 * настройка клиента выключена, планировщик не доходит до приложения, или он
 * работает, а сбор всё равно стоит (застрявшая очередь, исчерпанная квота,
 * снятая авторизация) либо идёт, но каждый прогон падает.
 */
export async function socialMonitoringScheduleStatus(
  organizationId: string,
  now = new Date(),
): Promise<SocialMonitoringScheduleStatus> {
  const [settings, heartbeat, organization, sources] = await Promise.all([
    getSocialMonitoringSettings(organizationId),
    prisma.systemJobLease.findUnique({
      where: { name: SOCIAL_MONITORING_SCHEDULE_JOB },
      select: { lastCompletedAt: true, lastStartedAt: true },
    }).catch(() => null),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    }),
    prisma.monitoringSource.findMany({
      where: { organizationId, status: { in: SCHEDULABLE_SOURCE_STATUSES } },
      take: STATUS_SOURCE_SCAN_LIMIT,
      select: {
        createdAt: true,
        lastCheckedAt: true,
        lastError: true,
        platform: true,
        sourceType: true,
        url: true,
        handle: true,
        ownership: true,
        status: true,
        collectionMode: true,
        settings: true,
        routePlans: {
          where: { status: { not: "INVALIDATED" } },
          select: {
            status: true,
            capability: true,
            primaryAdapter: true,
            fallbackAdapters: true,
            capabilityProofId: true,
            budget: true,
            policyVersion: true,
            dependsOnCapability: true,
            lastFailureClass: true,
          },
        },
        subjectSources: {
          select: {
            relationType: true,
            scenarioId: true,
            subject: { select: { status: true } },
          },
        },
      },
    }) as Promise<ScheduleSourceRow[]>,
  ])

  const cadenceMinutes = settings.schedule.cadenceMinutes
  const lastTick = heartbeat?.lastCompletedAt ?? heartbeat?.lastStartedAt ?? null
  const lastTickMinutesAgo = lastTick ? minutesBetween(lastTick, now) : null
  const graceMs = SOURCE_OVERDUE_GRACE_MINUTES * 60_000

  let scheduledSources = 0
  let excludedSources = 0
  let overdueSources = 0
  let neverCollectedSources = 0
  let failingSources = 0
  let maxOverdueMinutes: number | null = null
  let nextDueAt: Date | null = null

  for (const source of sources) {
    if (!participatesInSchedule(source, organization?.settings)) {
      excludedSources += 1
      continue
    }
    scheduledSources += 1
    if (source.lastError) failingSources += 1

    if (!source.lastCheckedAt) {
      // Только что заведённый источник ещё не просрочен: обход берёт такие в
      // первую очередь, но не мгновенно. Тревога — только когда он висит
      // несобранным дольше запаса от создания.
      if (source.createdAt.getTime() + graceMs <= now.getTime()) neverCollectedSources += 1
      continue
    }

    // Планировщик применяет каденцию тенанта, а не поле карточки: считаем по
    // той же величине, иначе панель обещала бы сроки, которых обход не знает.
    const dueAt = new Date(source.lastCheckedAt.getTime() + cadenceMinutes * 60_000)
    if (dueAt.getTime() + graceMs <= now.getTime()) {
      overdueSources += 1
      maxOverdueMinutes = Math.max(
        maxOverdueMinutes ?? 0,
        minutesBetween(dueAt, now) - SOURCE_OVERDUE_GRACE_MINUTES,
      )
      continue
    }
    if (!nextDueAt || dueAt < nextDueAt) nextDueAt = dueAt
  }

  return {
    enabled: settings.schedule.enabled,
    cadenceMinutes,
    lastTickAt: lastTick ? lastTick.toISOString() : null,
    lastTickMinutesAgo,
    responding: lastTickMinutesAgo !== null
      && lastTickMinutesAgo <= SCHEDULE_HEARTBEAT_STALE_MINUTES,
    scheduledSources,
    excludedSources,
    overdueSources,
    maxOverdueMinutes,
    neverCollectedSources,
    failingSources,
    nextDueAt: nextDueAt ? nextDueAt.toISOString() : null,
  }
}
