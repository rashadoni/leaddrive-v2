import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findManySources: vi.fn(),
  findFirstRun: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (req: NextRequest, auth: { orgId: string }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { orgId: "org-1" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSource: { findMany: mocks.findManySources },
    collectorRun: { findFirst: mocks.findFirstRun },
  },
}))
vi.mock("@/lib/social/google-alerts-address", () => ({
  buildGoogleAlertsAddress: () => "google-alerts+org-1.abc@example.test",
}))
vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenarios: vi.fn(async () => []),
}))

import { GET } from "@/app/api/v1/social/google-alerts/route"

const request = () => ({} as NextRequest)

function run(overrides: Partial<{
  status: string
  lastCheckedAt: Date | null
  lastSuccessfulAt: Date | null
  lastError: string | null
  latestRun: Record<string, unknown> | null
}> = {}) {
  return {
    status: "active",
    lastCheckedAt: new Date("2026-07-31T18:00:00.000Z"),
    lastSuccessfulAt: new Date("2026-07-31T18:00:00.000Z"),
    lastError: null,
    ...overrides,
    collectorRuns: overrides.latestRun === null
      ? []
      : [overrides.latestRun ?? { status: "success", startedAt: new Date(), finishedAt: new Date(), foundCount: 4, newCount: 2, error: null }],
  }
}

function mockSources(rssRows: unknown[]) {
  mocks.findManySources.mockImplementation(async (args: { where: { collectionMode: string } }) =>
    args.where.collectionMode === "notification_inbox"
      ? rssRows
      : [],
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findFirstRun.mockResolvedValue(null)
})

describe("GET /api/v1/social/google-alerts", () => {
  // Регрессия: карточка считала только бесплатный новостной канал
  // (search_index), поэтому подключённые RSS-ленты в ней не отражались.
  it("reports connected RSS feeds separately from the free news channel", async () => {
    mockSources([run(), run({ status: "paused" })])

    const res = await GET(request())
    const { data } = await res.json()

    expect(data.rssFeeds).toMatchObject({ connectedCount: 2, activeCount: 1, failingCount: 0 })
    // Прямой обход изданий выключен: маршрут больше не читает search_index —
    // остаётся только пустышка для старых закэшированных бандлов PWA.
    expect(data.automaticCollection).toMatchObject({ sourceCount: 0, publishers: [] })
    expect(mocks.findManySources.mock.calls.every(call => call[0].where.collectionMode === "notification_inbox")).toBe(true)
    expect(mocks.findFirstRun).not.toHaveBeenCalled()

    const rssQuery = mocks.findManySources.mock.calls
      .map(call => call[0].where)
      .find(where => where.collectionMode === "notification_inbox")
    expect(rssQuery).toMatchObject({
      platform: "web",
      settings: { path: ["managedBy"], equals: "google_alerts_rss" },
      // Отвязанная лента остаётся строкой с managedBy — фильтруем по флагу
      // configured, иначе карточка вечно показывала бы «подключено».
      AND: [{ settings: { path: ["googleAlertsRss", "configured"], equals: true } }],
    })
  })

  it("derives failure from the feed's own last run, not from the wipe-prone lastError", async () => {
    // Сохранение сценария обнуляет source.lastError, но прогон остаётся failed.
    mockSources([run({ lastError: null, latestRun: { status: "failed", startedAt: new Date(), finishedAt: new Date(), foundCount: 0, newCount: 0, error: "google_alerts_rss_http_404" } })])

    const res = await GET(request())
    const { data } = await res.json()

    expect(data.rssFeeds.failingCount).toBe(1)
    // Провалившийся прогон не должен читаться как «лента просто пуста».
    expect(data.rssFeeds.allEmpty).toBe(false)
  })

  it("flags empty feeds only when every feed ran clean and brought nothing", async () => {
    mockSources([
      run({ latestRun: { status: "success", startedAt: new Date(), finishedAt: new Date(), foundCount: 0, newCount: 0, error: null } }),
      run({ latestRun: { status: "success", startedAt: new Date(), finishedAt: new Date(), foundCount: 0, newCount: 0, error: null } }),
    ])
    expect((await (await GET(request())).json()).data.rssFeeds.allEmpty).toBe(true)

    // Одна здоровая лента с находками снимает предупреждение у всей организации.
    mockSources([
      run({ latestRun: { status: "success", startedAt: new Date(), finishedAt: new Date(), foundCount: 0, newCount: 0, error: null } }),
      run(),
    ])
    const { data } = await (await GET(request())).json()
    expect(data.rssFeeds.allEmpty).toBe(false)
    expect(data.rssFeeds).toMatchObject({ foundOnLastRuns: 4, createdOnLastRuns: 2, hasRuns: true })
  })

  it("reports zero connected feeds when only the free news channel exists", async () => {
    mockSources([])
    const { data } = await (await GET(request())).json()
    expect(data.rssFeeds).toMatchObject({ connectedCount: 0, activeCount: 0, failingCount: 0, allEmpty: false, hasRuns: false })
  })
})
