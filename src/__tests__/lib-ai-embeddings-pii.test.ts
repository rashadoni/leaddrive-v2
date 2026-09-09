import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  kbEmbeddingFindUnique: vi.fn(),
  executeRawUnsafe: vi.fn(),
  executeRaw: vi.fn(),
  queryRawUnsafe: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    kbEmbedding: { findUnique: db.kbEmbeddingFindUnique },
    $executeRawUnsafe: db.executeRawUnsafe,
    // The write moved from $executeRawUnsafe to the tagged-template $executeRaw
    // (a hardening: values are parameterised instead of interpolated). Reading
    // the old mock meant this test was asserting on a call that never happened.
    $executeRaw: db.executeRaw,
    $queryRawUnsafe: db.queryRawUnsafe,
  },
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: () => ({ messages: { create: vi.fn() } }),
}))

import { embedKbArticle, searchKbByVector } from "@/lib/ai/embeddings"

function mockVoyageFetch() {
  const calls: unknown[] = []
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || "{}")))
    return {
      json: async () => ({ data: [{ embedding: Array.from({ length: 512 }, () => 0.01) }] }),
    } as Response
  }))
  return calls
}

// Cleanup belongs AFTER as well as before. Unstubbing only in beforeEach leaves
// the stubbed fetch and VOYAGE_API_KEY in place once the last test here
// finishes, so whatever vitest runs next in the same worker inherits a fetch
// that answers like the Voyage embeddings API. Verified, not theorised: running
// this file alongside lib-ai-autoreply and lib-company-phone-policy fails those
// two, and passes once this hook exists.
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VOYAGE_API_KEY
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  process.env.VOYAGE_API_KEY = "voyage-test-key"
  db.kbEmbeddingFindUnique.mockResolvedValue(null)
  db.executeRawUnsafe.mockResolvedValue(1)
  db.executeRaw.mockResolvedValue(1)
  db.queryRawUnsafe.mockResolvedValue([])
})

describe("KB/vector embeddings PII masking", () => {
  it("masks KB article PII before Voyage and stores masked embedding content", async () => {
    const calls = mockVoyageFetch()

    await embedKbArticle(
      "article-1",
      "org-1",
      "Reset for aysel@example.com",
      "Call +994 50 123 45 67 and use https://example.com/hook?token=secret123.",
    )

    const input = (calls[0] as { input: string[] }).input[0]
    // $executeRaw is a tagged template: calls[0][0] is the strings array and
    // the interpolated values follow. For the INSERT branch the order is
    // id, orgId, articleId, text, vector — so the stored content is index 4.
    // Asserted by name below rather than trusted, so a reordered INSERT fails
    // loudly instead of silently checking the wrong value.
    const insertArgs = db.executeRaw.mock.calls[0] as unknown[]
    const storedContent = insertArgs[4] as string

    // Guard the index above: if the INSERT ever reorders, this catches it
    // before the masking assertions read a different column entirely.
    expect(insertArgs[2]).toBe("org-1")
    expect(insertArgs[3]).toBe("article-1")

    expect(input).toContain("[EMAIL_")
    expect(input).toContain("[PHONE_")
    expect(input).toContain("[URLCRED_")
    expect(input).not.toContain("aysel@example.com")
    expect(input).not.toContain("+994 50 123 45 67")
    expect(input).not.toContain("secret123")
    expect(storedContent).toContain("[EMAIL_")
    expect(storedContent).not.toContain("aysel@example.com")
  })

  it("masks raw vector search query PII before Voyage", async () => {
    const calls = mockVoyageFetch()

    await searchKbByVector("org-1", "Find customer@example.com or call +994 55 111 22 33", 3)

    const input = (calls[0] as { input: string[] }).input[0]
    expect(input).toContain("[EMAIL_")
    expect(input).toContain("[PHONE_")
    expect(input).not.toContain("customer@example.com")
    expect(input).not.toContain("+994 55 111 22 33")
  })
})
