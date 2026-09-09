import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}))

const mocks = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/secure-token", () => ({
  decryptToken: mocks.decryptToken,
  encryptToken: mocks.encryptToken,
}))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mocks.findMatchedKeyword,
  ingestMentionWithResult: mocks.ingestMentionWithResult,
}))
vi.mock("@/lib/social/collector-observation-context", () => ({
  observationContextForCollector: vi.fn(() => ({ collectorRunId: "collector-1" })),
  routeExecutionMetadata: vi.fn(() => ({ collectorRunId: "collector-1" })),
}))

import { runXOfficialCollector } from "@/lib/social/twitter-poller"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-x",
  organizationId: "org-1",
  platform: "twitter",
  sourceType: "profile",
  ownership: "external",
  collectionMode: "official_api",
  status: "active",
  cadenceMinutes: 60,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: { socialAccountId: "account-x" },
  keywords: ["LeadDrive"],
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-x",
    capability: "DISCOVER_POSTS",
    adapterKey: "X_API",
    acquisitionMode: "OFFICIAL_API",
    maxItems: 10,
    timeoutSeconds: 1,
  },
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-x",
    organizationId: "org-1",
    platform: "twitter",
    isActive: true,
    handle: "leaddrive",
    keywords: ["LeadDrive"],
    accessToken: "encrypted-token",
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  }
}

function abortAwareNever(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"))
    }, { once: true })
  })
}

async function flushAsyncCalls() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  mockPrisma.socialAccount.findFirst.mockResolvedValue({ id: "account-x" })
  mockPrisma.socialAccount.findUnique.mockResolvedValue(account())
  mockPrisma.socialAccount.update.mockResolvedValue({ id: "account-x" })
  mocks.decryptToken.mockReturnValue("access-token::refresh-token")
  mocks.encryptToken.mockReturnValue("encrypted-refreshed-token")
  mocks.findMatchedKeyword.mockReturnValue("LeadDrive")
  mocks.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("X official monitoring collector provider boundary", () => {
  it("reports no provider dispatch when the official account is missing", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runXOfficialCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "x_official_account_missing",
      rawStats: {
        providerRequestDispatched: false,
        dispatchUnknown: false,
      },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("passes a real abort signal through the successful search request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(init?.signal?.aborted).toBe(false)
      return new Response(JSON.stringify({
        data: [{ id: "tweet-1", text: "LeadDrive mention", author_id: "user-1" }],
        includes: { users: [{ id: "user-1", username: "person", name: "Person" }] },
        meta: {},
      }), { status: 200, headers: { "content-type": "application/json" } })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runXOfficialCollector(source)).resolves.toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      rawStats: {
        providerRequestDispatched: true,
        dispatchUnknown: false,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns a pre-dispatch refresh timeout without deactivating the account or searching", async () => {
    vi.useFakeTimers()
    vi.stubEnv("TWITTER_CLIENT_ID", "client-x")
    mockPrisma.socialAccount.findUnique.mockResolvedValue(account({
      tokenExpiresAt: new Date(Date.now() - 60_000),
    }))
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return abortAwareNever(init?.signal as AbortSignal)
    })
    vi.stubGlobal("fetch", fetchMock)

    const pending = runXOfficialCollector(source)
    await flushAsyncCalls()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/oauth2/token")
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: "x_token_refresh_timeout",
      rawStats: {
        providerRequestDispatched: false,
        dispatchUnknown: false,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockPrisma.socialAccount.update).not.toHaveBeenCalled()
  })

  it("returns an unknown dispatched outcome when the paid search times out", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return abortAwareNever(init?.signal as AbortSignal)
    })
    vi.stubGlobal("fetch", fetchMock)

    const pending = runXOfficialCollector(source)
    await flushAsyncCalls()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/tweets/search/recent")
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      foundCount: 0,
      error: "x_api_timeout",
      rawStats: {
        providerRequestDispatched: true,
        dispatchUnknown: true,
      },
    })
    expect(mockPrisma.socialAccount.update).not.toHaveBeenCalled()
  })

  it("stops paid pagination when X repeats a next token", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ data: [], meta: { next_token: "repeat-token" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runXOfficialCollector(source)).resolves.toMatchObject({
      status: "failed",
      error: "x_pagination_token_repeated",
      rawStats: {
        providerRequestDispatched: true,
        dispatchUnknown: false,
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
