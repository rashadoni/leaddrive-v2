import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  systemJobLease: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
  monitoringSource: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
}))
const deps = vi.hoisted(() => ({
  getSocialMonitoringSettings: vi.fn(),
  automaticSourceCollectionDecision: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/monitoring-settings", () => ({
  getSocialMonitoringSettings: deps.getSocialMonitoringSettings,
}))
vi.mock("@/lib/social/automatic-collection-policy", () => ({
  automaticSourceCollectionDecision: deps.automaticSourceCollectionDecision,
}))
vi.mock("@/lib/social/source-route-plan", () => ({
  SOURCE_ROUTE_POLICY_VERSION: "test-policy",
}))

import {
  SCHEDULE_HEARTBEAT_STALE_MINUTES,
  socialMonitoringScheduleStatus,
} from "@/lib/social/monitoring-schedule-status"

const NOW = new Date("2026-08-03T12:00:00.000Z")
const DAY = 1440

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: minutesAgo(10 * DAY),
    lastCheckedAt: minutesAgo(60),
    lastError: null,
    platform: "instagram",
    sourceType: "keyword",
    url: null,
    handle: null,
    ownership: "external",
    status: "active",
    collectionMode: "search_index",
    settings: {},
    routePlans: [],
    subjectSources: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.getSocialMonitoringSettings.mockResolvedValue({
    schedule: { enabled: true, cadenceMinutes: DAY },
  })
  deps.automaticSourceCollectionDecision.mockReturnValue({ allowed: true })
  mockPrisma.systemJobLease.findUnique.mockResolvedValue({
    lastCompletedAt: minutesAgo(3),
    lastStartedAt: minutesAgo(3),
  })
  mockPrisma.organization.findUnique.mockResolvedValue({ settings: {} })
  mockPrisma.monitoringSource.findMany.mockResolvedValue([])
})

describe("social monitoring schedule status", () => {
  it("reports a fresh heartbeat as responding", async () => {
    mockPrisma.monitoringSource.findMany.mockResolvedValue([source()])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      enabled: true,
      responding: true,
      lastTickMinutesAgo: 3,
      overdueSources: 0,
      scheduledSources: 1,
      nextDueAt: new Date(minutesAgo(60).getTime() + DAY * 60_000).toISOString(),
    })
  })

  // Тот самый случай, что стоил четырёх суток: настройка включена, частота
  // задана, а планировщик снят на сервере.
  it("reports a stale heartbeat as not responding even while the setting is on", async () => {
    mockPrisma.systemJobLease.findUnique.mockResolvedValue({
      lastCompletedAt: minutesAgo(SCHEDULE_HEARTBEAT_STALE_MINUTES + 1),
      lastStartedAt: null,
    })

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      enabled: true,
      responding: false,
    })
  })

  it("reports a scheduler that never ran", async () => {
    mockPrisma.systemJobLease.findUnique.mockResolvedValue(null)

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      lastTickAt: null,
      responding: false,
    })
  })

  it("counts overdue sources beyond the grace window while the heartbeat is fresh", async () => {
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      source({ lastCheckedAt: minutesAgo(DAY + 30) }),
      source({ lastCheckedAt: minutesAgo(DAY + 61) }),
      source({ lastCheckedAt: minutesAgo(4 * DAY) }),
      source({ lastCheckedAt: minutesAgo(10) }),
    ])

    const status = await socialMonitoringScheduleStatus("org-1", NOW)

    // 30 минут опоздания — в пределах запаса, поэтому не просрочка.
    expect(status).toMatchObject({ responding: true, overdueSources: 2, scheduledSources: 4 })
    expect(status.maxOverdueMinutes).toBe(3 * DAY - 60)
  })

  // Панель обязана считать просроченными только те строки, которые обход
  // реально берёт. Иначе она светит «Отстаёт» вечно и предупреждению
  // перестают верить — ровно как раньше верили тишине.
  it("ignores sources the sweep never takes", async () => {
    deps.automaticSourceCollectionDecision.mockImplementation((input: { platform?: string }) => ({
      allowed: input.platform !== "youtube",
    }))
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      // Постоянный отказ политики автосбора.
      source({ platform: "youtube", lastCheckedAt: minutesAgo(30 * DAY) }),
      // Историческая web-строка сценария: расписание ей не положено.
      source({
        platform: "web",
        sourceType: "keyword",
        lastCheckedAt: minutesAgo(30 * DAY),
        settings: { scenarioId: "scn-1" },
      }),
      source({ lastCheckedAt: minutesAgo(10) }),
    ])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      scheduledSources: 1,
      overdueSources: 0,
      // Исключённые не исчезают бесследно: иначе «TikTok не собирается
      // четыре дня» снова выглядит как тишина.
      excludedSources: 2,
    })
  })

  it("keeps the Google Alerts inbox of a scenario in the schedule", async () => {
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      source({
        platform: "web",
        sourceType: "notification_inbox",
        collectionMode: "notification_inbox",
        settings: { scenarioId: "scn-1", managedBy: "google_alerts_rss" },
        lastCheckedAt: minutesAgo(10),
      }),
    ])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      scheduledSources: 1,
    })
  })

  // Только что заведённый источник ещё не повод для тревоги.
  it("does not alarm on a source created moments ago", async () => {
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      source({ createdAt: minutesAgo(5), lastCheckedAt: null }),
    ])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      neverCollectedSources: 0,
      overdueSources: 0,
    })
  })

  it("flags a source that has never been collected long after it was created", async () => {
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      source({ createdAt: minutesAgo(3 * DAY), lastCheckedAt: null }),
    ])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      neverCollectedSources: 1,
      maxOverdueMinutes: null,
    })
  })

  // Отметка проверки обновляется при ЛЮБОМ исходе, включая неудачный, поэтому
  // без отдельного счётчика панель зеленела бы при стабильно падающем сборе.
  it("counts failing sources even though their check timestamp is fresh", async () => {
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      source({ lastCheckedAt: minutesAgo(10), lastError: "apify_provider_blocked" }),
      source({ lastCheckedAt: minutesAgo(10) }),
    ])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      overdueSources: 0,
      failingSources: 1,
    })
  })

  it("surfaces the tenant switch separately from the heartbeat", async () => {
    deps.getSocialMonitoringSettings.mockResolvedValue({
      schedule: { enabled: false, cadenceMinutes: 720 },
    })

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      enabled: false,
      responding: true,
      cadenceMinutes: 720,
    })
  })

  it("derives due times from the tenant cadence, not the per-source value", async () => {
    deps.getSocialMonitoringSettings.mockResolvedValue({
      schedule: { enabled: true, cadenceMinutes: 60 },
    })
    mockPrisma.monitoringSource.findMany.mockResolvedValue([
      source({ lastCheckedAt: minutesAgo(200) }),
    ])

    await expect(socialMonitoringScheduleStatus("org-1", NOW)).resolves.toMatchObject({
      overdueSources: 1,
    })
  })

  // Счётчики одного клиента не должны включать чужие строки.
  it("scopes the source scan to the organization and caps it", async () => {
    await socialMonitoringScheduleStatus("org-1", NOW)

    expect(mockPrisma.monitoringSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1" }),
        take: expect.any(Number),
      }),
    )
  })

  it("never exposes the shared scheduler error text to a tenant", async () => {
    const status = await socialMonitoringScheduleStatus("org-1", NOW)
    expect(status).not.toHaveProperty("lastError")
  })
})
