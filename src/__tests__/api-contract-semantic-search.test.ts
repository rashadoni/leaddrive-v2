/**
 * CLM Slice 6c — Semantic Contract Search + Reindex + Backfill Cron
 *
 * Coverage (updated 2026-06-08 for Codex hardening):
 *   SEARCH POST — requireAuth read
 *   SEARCH POST — org-scoped ($queryRawUnsafe includes organizationId = orgId BOTH sides)
 *   SEARCH POST — empty query → 400
 *   SEARCH POST — rate-limited → 429
 *   SEARCH POST — feature flag disabled → 403
 *   SEARCH POST — budget exceeded → 429
 *   SEARCH POST — returns ranked results filtered by threshold
 *   SEARCH POST — logs AiInteractionLog (embedding spend) on success (FIX 1)
 *   REINDEX POST — requireAuth write
 *   REINDEX POST — generates embedding + atomic ON CONFLICT upsert (FIX 4)
 *   REINDEX POST — no contract body → 400
 *   REINDEX POST — contract not in org → 404
 *   REINDEX POST — logs AiInteractionLog on success (FIX 1)
 *   CRON POST — CRON_SECRET required (401 without)
 *   CRON POST — indexes missing contracts + returns {indexed, skipped, errors}
 *   CRON POST — skips org with feature flag OFF (FIX 3)
 *   CRON POST — skips org with budget exceeded (FIX 3)
 *   CRON POST — stale contract (version changed) selected by query (FIX 5)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ── Prisma mock ────────────────────────────────────────────────────────────────

// Production uses tagged parameterized calls; keep legacy assertions compatible
// by sharing the same mock implementation with the old unsafe names.
const queryRawMock = vi.hoisted(() => vi.fn())
const executeRawMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
    },
    contractEmbedding: {
      findUnique: vi.fn(),
    },
    aiInteractionLog: {
      create: vi.fn(),
    },
    $queryRaw: queryRawMock,
    $queryRawUnsafe: queryRawMock,
    $executeRaw: executeRawMock,
    $executeRawUnsafe: executeRawMock,
  },
}))

// ── Auth mock ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

// ── Budget + feature flag mocks ───────────────────────────────────────────────

vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: vi.fn(),
  checkAiBudget:      vi.fn(),
}))

// ── Rate-limit mock ───────────────────────────────────────────────────────────

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit:    vi.fn(),
  RATE_LIMIT_CONFIG: { ai: {} },
}))

// ── embedding-spend mock ──────────────────────────────────────────────────────

vi.mock("@/lib/ai/embedding-spend", () => ({
  logEmbeddingSpend: vi.fn().mockResolvedValue(undefined),
}))

// ── Import routes AFTER vi.mock calls ─────────────────────────────────────────

import { POST as searchPOST } from "@/app/api/v1/contracts/search/semantic/route"
import { POST as reindexPOST } from "@/app/api/v1/contracts/[id]/reindex/route"
import { POST as cronPOST } from "@/app/api/cron/contract-embeddings/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { isAiFeatureEnabled, checkAiBudget } from "@/lib/ai/budget"
import { checkRateLimit } from "@/lib/rate-limit"
import { logEmbeddingSpend } from "@/lib/ai/embedding-spend"

// ── Test data ──────────────────────────────────────────────────────────────────

const ORG_ID      = "org-test-1"
const ORG_ID_2    = "org-test-2"
const CONTRACT_ID = "ctr-test-1"
const USER_ID     = "user-test-1"

const GOOD_AUTH = { orgId: ORG_ID, userId: USER_ID }

// Canned search results from $queryRawUnsafe (as pgvector would return)
const CANNED_SEARCH_ROWS = [
  {
    contractId:     "ctr-a",
    contractNumber: "CTR-001",
    title:          "Master Services Agreement",
    status:         "active",
    valueAmount:    "50000.0000",
    currency:       "USD",
    similarity:     "0.92",
  },
  {
    contractId:     "ctr-b",
    contractNumber: "CTR-002",
    title:          "NDA — Germany Office",
    status:         "active",
    valueAmount:    null,
    currency:       "EUR",
    similarity:     "0.61",
  },
  {
    // below threshold 0.3
    contractId:     "ctr-c",
    contractNumber: "CTR-003",
    title:          "Old contract",
    status:         "expired",
    valueAmount:    "1000.0000",
    currency:       "USD",
    similarity:     "0.10",
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSearchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v1/contracts/search/semantic", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-organization-id": ORG_ID },
    body:    JSON.stringify(body),
  })
}

function makeReindexReq(contractId = CONTRACT_ID): NextRequest {
  return new NextRequest(`http://localhost/api/v1/contracts/${contractId}/reindex`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-organization-id": ORG_ID },
  })
}

function makeReindexParams(id = CONTRACT_ID) {
  return { params: Promise.resolve({ id }) }
}

function makeCronReq(secret: string | null = "correct-secret"): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["x-cron-secret"] = secret
  return new NextRequest("http://localhost/api/cron/contract-embeddings", {
    method: "POST",
    headers,
  })
}

function mockVoyageFetch() {
  const calls: unknown[] = []
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || "{}")))
    return {
      json: async () => ({ data: [{ embedding: Array.from({ length: 512 }, () => 0.02) }] }),
    } as Response
  }))
  return calls
}

// ── Default mock setup ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()

  // Default: auth OK
  vi.mocked(requireAuth).mockResolvedValue(GOOD_AUTH as any)

  // Default: rate-limit OK
  vi.mocked(checkRateLimit).mockReturnValue(true)

  // Default: feature enabled
  vi.mocked(isAiFeatureEnabled).mockResolvedValue(true)

  // Default: budget OK
  vi.mocked(checkAiBudget).mockResolvedValue({
    allowed: true,
    spent: 0.1,
    limit: 5.0,
    remaining: 4.9,
  } as any)

  // Default: search returns canned rows
  vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(CANNED_SEARCH_ROWS as any)

  // Default: no existing embedding
  vi.mocked(prisma.contractEmbedding.findUnique).mockResolvedValue(null as any)

  // Default: contract found with body
  vi.mocked(prisma.contract.findFirst).mockResolvedValue({
    id:               CONTRACT_ID,
    organizationId:   ORG_ID,
    renderedBody:     "This contract governs services in Germany with uncapped liability.",
    contractVersions: [],
  } as any)

  // Default: executeRaw succeeds
  vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1 as any)

  // Default: aiInteractionLog.create succeeds
  vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as any)

  // Set cron secret
  process.env.CRON_SECRET      = "correct-secret"
  process.env.VOYAGE_API_KEY   = ""  // force fallback embedding in tests
})

// ── SEARCH tests ──────────────────────────────────────────────────────────────

describe("POST /api/v1/contracts/search/semantic", () => {
  it("requireAuth read — returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any,
    )
    const res = await searchPOST(makeSearchReq({ query: "uncapped liability" }))
    expect(res.status).toBe(401)
  })

  it("empty query → 400", async () => {
    const res = await searchPOST(makeSearchReq({ query: "" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  it("missing query → 400", async () => {
    const res = await searchPOST(makeSearchReq({}))
    expect(res.status).toBe(400)
  })

  it("rate-limited → 429", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const res = await searchPOST(makeSearchReq({ query: "uncapped liability" }))
    expect(res.status).toBe(429)
  })

  it("feature flag disabled → 403", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false)
    const res = await searchPOST(makeSearchReq({ query: "uncapped liability" }))
    expect(res.status).toBe(403)
  })

  it("budget exceeded → 429", async () => {
    vi.mocked(checkAiBudget).mockResolvedValue({ allowed: false, spent: 5.0, limit: 5.0, remaining: 0 } as any)
    const res = await searchPOST(makeSearchReq({ query: "uncapped liability" }))
    expect(res.status).toBe(429)
  })

  it("FIX 2 — org-scoped: $queryRawUnsafe SQL org-scopes BOTH sides (ce AND c)", async () => {
    await searchPOST(makeSearchReq({ query: "uncapped liability" }))
    const [sql, ...args] = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0]
    const sqlStr = String(sql)
    // Both the embedding row (ce) and the joined contract (c) must be org-scoped
    expect(sqlStr).toContain('ce."organizationId"')
    expect(sqlStr).toContain('c."organizationId"')
    expect(args).toContain(ORG_ID)
  })

  it("FIX 1 — logs embedding spend (logEmbeddingSpend) after successful search", async () => {
    await searchPOST(makeSearchReq({ query: "uncapped liability in Germany" }))
    expect(logEmbeddingSpend).toHaveBeenCalledTimes(1)
    const [orgArg, , , contextArg] = vi.mocked(logEmbeddingSpend).mock.calls[0]
    expect(orgArg).toBe(ORG_ID)
    expect(contextArg).toContain("[contract-search]")
  })

  it("masks query PII before Voyage and spend logging", async () => {
    process.env.VOYAGE_API_KEY = "voyage-test-key"
    const calls = mockVoyageFetch()

    await searchPOST(makeSearchReq({ query: "Find contract for aysel@example.com, call +994 50 123 45 67" }))

    const input = (calls[0] as { input: string[] }).input[0]
    const [, loggedText] = vi.mocked(logEmbeddingSpend).mock.calls[0]
    expect(input).toContain("[EMAIL_")
    expect(input).toContain("[PHONE_")
    expect(input).not.toContain("aysel@example.com")
    expect(input).not.toContain("+994 50 123 45 67")
    expect(String(loggedText)).not.toContain("aysel@example.com")
  })

  it("returns ranked results filtered above threshold (default 0.3)", async () => {
    const res = await searchPOST(makeSearchReq({ query: "uncapped liability in Germany" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    // CANNED_SEARCH_ROWS[2] has similarity 0.10 which is < 0.3 → filtered out
    expect(json.results).toHaveLength(2)
    expect(json.results[0].contractId).toBe("ctr-a")
    expect(json.results[0].similarity).toBeCloseTo(0.92, 1)
    expect(json.results[1].contractId).toBe("ctr-b")
  })

  it("respects custom threshold", async () => {
    const res = await searchPOST(makeSearchReq({ query: "Germany", threshold: 0.8 }))
    const json = await res.json()
    // only ctr-a (0.92) passes threshold 0.8
    expect(json.results).toHaveLength(1)
    expect(json.results[0].contractId).toBe("ctr-a")
  })

  it("returns success: true with count", async () => {
    const res = await searchPOST(makeSearchReq({ query: "uncapped liability" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(typeof json.count).toBe("number")
    expect(json.query).toBe("uncapped liability")
  })
})

// ── REINDEX tests ─────────────────────────────────────────────────────────────

describe("POST /api/v1/contracts/[id]/reindex", () => {
  it("requireAuth write — returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any,
    )
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(res.status).toBe(401)
  })

  it("contract not found in org → 404", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null as any)
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(res.status).toBe(404)
  })

  it("no contract body → 400", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue({
      id:               CONTRACT_ID,
      organizationId:   ORG_ID,
      renderedBody:     "",
      contractVersions: [],
    } as any)
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(res.status).toBe(400)
  })

  it("rate-limited → 429", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false)
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(res.status).toBe(429)
  })

  it("feature flag disabled → 403", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false)
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(res.status).toBe(403)
  })

  it("FIX 4 — atomic upsert: uses ON CONFLICT (no findUnique-then-branch)", async () => {
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    // contractEmbedding.findUnique must NOT be called (old pattern)
    expect(prisma.contractEmbedding.findUnique).not.toHaveBeenCalled()
    // $executeRawUnsafe called with ON CONFLICT DO UPDATE
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1)
    const [sql] = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0]
    const sqlStr = String(sql).toLowerCase()
    expect(sqlStr).toContain("insert into")
    expect(sqlStr).toContain("on conflict")
    expect(sqlStr).toContain("do update")
    expect(sqlStr).toContain("contract_embeddings")
  })

  it("FIX 1 — logs embedding spend (logEmbeddingSpend) after successful reindex", async () => {
    await reindexPOST(makeReindexReq(), makeReindexParams())
    expect(logEmbeddingSpend).toHaveBeenCalledTimes(1)
    const [orgArg, , , contextArg] = vi.mocked(logEmbeddingSpend).mock.calls[0]
    expect(orgArg).toBe(ORG_ID)
    expect(contextArg).toContain("[contract-reindex]")
  })

  it("masks contract body PII before Voyage and embedding storage on reindex", async () => {
    process.env.VOYAGE_API_KEY = "voyage-test-key"
    const calls = mockVoyageFetch()
    vi.mocked(prisma.contract.findFirst).mockResolvedValue({
      id: CONTRACT_ID,
      organizationId: ORG_ID,
      renderedBody: "Contract for aysel@example.com. Phone +994 50 123 45 67. INN 1234567890.",
      contractVersions: [],
    } as any)

    await reindexPOST(makeReindexReq(), makeReindexParams())

    const input = (calls[0] as { input: string[] }).input[0]
    const storedContent = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][5]
    expect(input).toContain("[EMAIL_")
    expect(input).toContain("[PHONE_")
    expect(input).toContain("[TAXID_")
    expect(input).not.toContain("aysel@example.com")
    expect(input).not.toContain("+994 50 123 45 67")
    expect(String(storedContent)).not.toContain("aysel@example.com")
  })

  it("returns contentLength and model", async () => {
    const res = await reindexPOST(makeReindexReq(), makeReindexParams())
    const json = await res.json()
    expect(json.data.model).toBe("voyage-3-lite")
    expect(typeof json.data.contentLength).toBe("number")
    expect(json.data.contentLength).toBeGreaterThan(0)
  })
})

// ── CRON tests ─────────────────────────────────────────────────────────────────

describe("POST /api/cron/contract-embeddings", () => {
  it("CRON_SECRET required — wrong secret → 401", async () => {
    const res = await cronPOST(makeCronReq("wrong-secret"))
    expect(res.status).toBe(401)
  })

  it("CRON_SECRET required — no secret header → 401", async () => {
    const res = await cronPOST(makeCronReq(null))
    expect(res.status).toBe(401)
  })

  it("indexes missing contracts — returns {indexed, skipped, errors}", async () => {
    // Simulate 2 contracts without embeddings (ce.id IS NULL → latestCanonicalVersionId null too)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { id: "ctr-x", organizationId: ORG_ID, renderedBody: "Service agreement text.",         embeddedVersionId: null, latestCanonicalVersionId: null },
      { id: "ctr-y", organizationId: ORG_ID, renderedBody: "NDA agreement text for Germany.", embeddedVersionId: null, latestCanonicalVersionId: null },
    ] as any)
    vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1 as any)

    const res = await cronPOST(makeCronReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.indexed).toBe("number")
    expect(typeof json.skipped).toBe("number")
    expect(Array.isArray(json.errors)).toBe(true)
    expect(json.indexed).toBe(2)
  })

  it("masks contract body PII before Voyage and embedding storage in cron backfill", async () => {
    process.env.VOYAGE_API_KEY = "voyage-test-key"
    const calls = mockVoyageFetch()
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        id: "ctr-pii",
        organizationId: ORG_ID,
        renderedBody: "Contract contact aysel@example.com, phone +994 50 123 45 67, INN 1234567890.",
        embeddedVersionId: null,
        latestCanonicalVersionId: null,
      },
    ] as any)
    vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1 as any)

    const res = await cronPOST(makeCronReq())
    const json = await res.json()
    const input = (calls[0] as { input: string[] }).input[0]
    const storedContent = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][5]

    expect(res.status).toBe(200)
    expect(json.indexed).toBe(1)
    expect(input).toContain("[EMAIL_")
    expect(input).toContain("[PHONE_")
    expect(input).toContain("[TAXID_")
    expect(input).not.toContain("aysel@example.com")
    expect(input).not.toContain("+994 50 123 45 67")
    expect(String(storedContent)).not.toContain("aysel@example.com")
  })

  it("skips contracts with empty renderedBody", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { id: "ctr-z", organizationId: ORG_ID, renderedBody: "", embeddedVersionId: null, latestCanonicalVersionId: null },
    ] as any)
    const res = await cronPOST(makeCronReq())
    const json = await res.json()
    expect(json.indexed).toBe(0)
    expect(json.skipped).toBe(1)
  })

  it("correct CRON_SECRET → 200", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as any)
    const res = await cronPOST(makeCronReq("correct-secret"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.indexed).toBe(0)
  })

  it("FIX 3 — skips org with ai_semantic_search feature OFF", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { id: "ctr-x", organizationId: ORG_ID, renderedBody: "Service text.", embeddedVersionId: null, latestCanonicalVersionId: null },
    ] as any)
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false)

    const res = await cronPOST(makeCronReq())
    const json = await res.json()
    expect(json.indexed).toBe(0)
    expect(json.skipped).toBe(1)
    // $executeRawUnsafe must NOT be called (no embed for opted-out org)
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it("FIX 3 — skips org with budget exceeded", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { id: "ctr-x", organizationId: ORG_ID, renderedBody: "Service text.", embeddedVersionId: null, latestCanonicalVersionId: null },
    ] as any)
    vi.mocked(checkAiBudget).mockResolvedValue({ allowed: false, spent: 5.0, limit: 5.0, remaining: 0 } as any)

    const res = await cronPOST(makeCronReq())
    const json = await res.json()
    expect(json.indexed).toBe(0)
    expect(json.skipped).toBe(1)
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it("FIX 3 — two orgs: one enabled, one disabled — only enabled org's contracts indexed", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { id: "ctr-x", organizationId: ORG_ID,   renderedBody: "Enabled org contract.",   embeddedVersionId: null, latestCanonicalVersionId: null },
      { id: "ctr-y", organizationId: ORG_ID_2,  renderedBody: "Disabled org contract.",  embeddedVersionId: null, latestCanonicalVersionId: null },
    ] as any)
    // ORG_ID enabled, ORG_ID_2 disabled
    vi.mocked(isAiFeatureEnabled).mockImplementation(async (orgId) => orgId === ORG_ID)
    vi.mocked(checkAiBudget).mockResolvedValue({ allowed: true, spent: 0.1, limit: 5.0, remaining: 4.9 } as any)

    const res = await cronPOST(makeCronReq())
    const json = await res.json()
    expect(json.indexed).toBe(1)
    expect(json.skipped).toBe(1)
  })

  it("FIX 5 — stale contract (version changed) is included in candidates SQL", async () => {
    // Stale: embeddedVersionId != latestCanonicalVersionId
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        id: "ctr-stale",
        organizationId: ORG_ID,
        renderedBody: "Updated contract body after amendment.",
        embeddedVersionId: "ver-old",
        latestCanonicalVersionId: "ver-new",
      },
    ] as any)

    const res = await cronPOST(makeCronReq())
    const json = await res.json()
    // Cron should embed the stale contract (version differs)
    expect(json.indexed).toBe(1)
    // Verify ON CONFLICT used for the stale upsert
    const [sql] = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0]
    expect(String(sql).toLowerCase()).toContain("on conflict")
  })

  it("FIX 5 — cron candidate SQL uses LATERAL + IS DISTINCT FROM for stale detection", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as any)
    await cronPOST(makeCronReq())
    const [sql] = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0]
    const sqlStr = String(sql)
    // SQL must contain the IS DISTINCT FROM clause for stale detection
    expect(sqlStr).toContain("IS DISTINCT FROM")
    // And the LATERAL join for the latest canonical version
    expect(sqlStr).toContain("LATERAL")
  })
})
