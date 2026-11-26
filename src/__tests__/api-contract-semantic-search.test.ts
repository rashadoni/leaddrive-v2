/**
 * «Ağıllı axtarış» on the contracts page, at the routes (owner 2026-11-26:
 * «Довести до работы»). The SQL — vectors, staleness, tenant isolation, the
 * search by words — is proven on a real Postgres with pgvector in
 * contract-search-postgres.test.ts; here the routes' decisions:
 *   - switched off → 403 SEMANTIC_SEARCH_OFF, which the page turns into words;
 *   - no Voyage vector for the query → a search by words, said so (mode: words),
 *     and nothing indexed — never a vector made of character codes again;
 *   - with Voyage → up to ten contracts brought up to date, then by meaning;
 *   - the card's reindex: 404, 503 VOYAGE_UNAVAILABLE without storing, or done;
 *   - the hourly job: only organizations with the switch on, a cap per run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))
vi.mock("@/lib/ai/budget", () => ({ isAiFeatureEnabled: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true), RATE_LIMIT_CONFIG: { ai: {} } }))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/cron/job-lease", () => ({
  withJobLease: vi.fn(async (_options: unknown, job: () => Promise<unknown>) => ({ status: "completed", value: await job() })),
}))
vi.mock("@/lib/ai/voyage-embedding", () => ({ voyageEmbedding: vi.fn(), VOYAGE_MODEL: "voyage-3-lite" }))
vi.mock("@/lib/clm/contract-search-index", () => ({
  indexContracts: vi.fn(),
  indexOneContract: vi.fn(),
  searchByMeaning: vi.fn(),
  searchByWords: vi.fn(),
}))

import { POST as searchPOST } from "@/app/api/v1/contracts/search/semantic/route"
import { POST as reindexPOST } from "@/app/api/v1/contracts/[id]/reindex/route"
import { POST as cronPOST } from "@/app/api/cron/contract-embeddings/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { voyageEmbedding } from "@/lib/ai/voyage-embedding"
import { indexContracts, indexOneContract, searchByMeaning, searchByWords } from "@/lib/clm/contract-search-index"

const ORG = "org-1"
const hit = { contractId: "c1", contractNumber: "AS/1", title: "Alğı-satqı", status: "active", valueAmount: null, currency: "AZN", similarity: 0.82 }
const search = (body: unknown) =>
  searchPOST(new NextRequest("http://localhost/api/v1/contracts/search/semantic", { method: "POST", body: JSON.stringify(body) }))
const reindex = (id = "c1") =>
  reindexPOST(new NextRequest(`http://localhost/api/v1/contracts/${id}/reindex`, { method: "POST" }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "u1", role: "admin", email: "a@x.az", name: "A" } as never)
  vi.mocked(isAiFeatureEnabled).mockResolvedValue(true)
  vi.mocked(indexContracts).mockResolvedValue({ indexed: 3, unavailable: false })
  vi.mocked(searchByMeaning).mockResolvedValue([hit])
  vi.mocked(searchByWords).mockResolvedValue([{ ...hit, similarity: 1 }])
})

describe("the search", () => {
  it("switched off: a code the page can say in words, and no paid call", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false)
    const res = await search({ query: "icarə" })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("SEMANTIC_SEARCH_OFF")
    expect(voyageEmbedding).not.toHaveBeenCalled()
  })

  it("with Voyage: brings ten contracts up to date, then searches by meaning", async () => {
    vi.mocked(voyageEmbedding).mockResolvedValue([0.1, 0.2])
    const res = await search({ query: "ofis icarəsi Fərid +994501234567" })
    const json = await res.json()
    expect(json).toMatchObject({ success: true, mode: "meaning", count: 1, indexedNow: 3 })
    expect(vi.mocked(indexContracts).mock.calls[0][0]).toBe(ORG)
    expect(vi.mocked(indexContracts).mock.calls[0][1]).toMatchObject({ limit: 10 })
    expect(searchByMeaning).toHaveBeenCalledWith(ORG, [0.1, 0.2], 10, 0.3)
    // the query goes out with personal data masked
    expect(vi.mocked(voyageEmbedding).mock.calls[0][1]).not.toContain("+994501234567")
    expect(searchByWords).not.toHaveBeenCalled()
  })

  it("without a Voyage vector: by words, said so, and nothing is indexed", async () => {
    vi.mocked(voyageEmbedding).mockResolvedValue(null)
    const json = await (await search({ query: "Kaspi icarə", limit: 5 })).json()
    expect(json).toMatchObject({ success: true, mode: "words", count: 1 })
    expect(searchByWords).toHaveBeenCalledWith(ORG, "Kaspi icarə", 5)
    expect(indexContracts).not.toHaveBeenCalled()
    expect(searchByMeaning).not.toHaveBeenCalled()
  })

  it("a custom threshold reaches the search", async () => {
    vi.mocked(voyageEmbedding).mockResolvedValue([0.3])
    await search({ query: "x", threshold: 0.5, limit: 3 })
    expect(searchByMeaning).toHaveBeenCalledWith(ORG, [0.3], 3, 0.5)
  })

  it("a bad body is a 400, before anything is paid for", async () => {
    expect((await search({ query: "" })).status).toBe(400)
    expect(voyageEmbedding).not.toHaveBeenCalled()
  })
})

describe("the card's reindex", () => {
  it("switched off → 403 with the code", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false)
    const res = await reindex()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("SEMANTIC_SEARCH_OFF")
    expect(indexOneContract).not.toHaveBeenCalled()
  })

  it("404 for a contract that is not this organization's; 503 without Voyage; done otherwise", async () => {
    vi.mocked(indexOneContract).mockResolvedValueOnce("not_found")
    expect((await reindex("foreign")).status).toBe(404)
    vi.mocked(indexOneContract).mockResolvedValueOnce("unavailable")
    const unavailable = await reindex()
    expect(unavailable.status).toBe(503)
    expect((await unavailable.json()).code).toBe("VOYAGE_UNAVAILABLE")
    vi.mocked(indexOneContract).mockResolvedValueOnce("indexed")
    expect(await (await reindex()).json()).toEqual({ success: true, contractId: "c1" })
    expect(vi.mocked(indexOneContract).mock.calls.every(([org]) => org === ORG)).toBe(true)
  })
})

describe("the hourly job", () => {
  it("indexes only for organizations with the switch on, and counts who had no Voyage", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "on-1" }, { id: "off" }, { id: "on-2" }] as never)
    vi.mocked(isAiFeatureEnabled).mockImplementation(async (orgId) => orgId !== "off")
    vi.mocked(indexContracts).mockResolvedValueOnce({ indexed: 5, unavailable: false }).mockResolvedValueOnce({ indexed: 0, unavailable: true })
    const json = await (await cronPOST(new NextRequest("http://localhost/api/cron/contract-embeddings", { method: "POST" }))).json()
    expect(json.data).toEqual({ status: "completed", value: { indexed: 5, organizations: 2, unavailable: 1 } })
    expect(vi.mocked(indexContracts).mock.calls.map(([org]) => org)).toEqual(["on-1", "on-2"])
    expect(vi.mocked(indexContracts).mock.calls[1][1]).toMatchObject({ limit: 195 })
  })
})
