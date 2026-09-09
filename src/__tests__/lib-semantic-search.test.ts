/**
 * Tests for H13 Einstein Semantic Search slice 1 — pure helpers.
 * No DB, deterministic embedder, pre-built candidate arrays.
 */
import { describe, it, expect, vi } from "vitest"
import {
  DimMismatchError,
  cosineSimilarity,
  topK,
} from "@/lib/semantic-search/similarity"
import {
  companyContent,
  contactContent,
  dealContent,
  extractContent,
  kbArticleContent,
  MAX_CONTENT_CHARS,
  ticketContent,
} from "@/lib/semantic-search/content-extractor"
import {
  embedAndHashContent,
  hashContent,
  rankCandidates,
} from "@/lib/semantic-search/engine"
import {
  DETERMINISTIC_DIM,
  DeterministicEmbedder,
} from "@/lib/semantic-search/deterministic-embedder"
import type {
  CandidateRow,
  SemanticEmbedClient,
} from "@/lib/semantic-search/types"

/* ─── cosineSimilarity ────────────────────────────────────────────────── */

describe("H13 — cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toBeCloseTo(1, 6)
  })

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it("returns -1 for antipodal vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6)
  })

  it("returns 0 when either side is a zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it("returns 0 when either side is empty", () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0)
    expect(cosineSimilarity([1, 2], [])).toBe(0)
  })

  it("throws DimMismatchError on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(DimMismatchError)
  })

  it("is scale-invariant (normalises internally)", () => {
    // [1,0] vs [10,0] should still be cosine 1 — same direction.
    expect(cosineSimilarity([1, 0], [10, 0])).toBeCloseTo(1, 6)
  })
})

/* ─── topK ────────────────────────────────────────────────────────────── */

describe("H13 — topK", () => {
  it("ranks by similarity descending", () => {
    const query = [1, 0]
    const cands = [
      { embedding: [0, 1], item: "orthogonal" }, // sim 0
      { embedding: [1, 0], item: "exact" }, // sim 1
      { embedding: [0.5, 0.5], item: "diagonal" }, // sim ~0.71
    ]
    const r = topK(query, cands, 3)
    expect(r.map(x => x.item)).toEqual(["exact", "diagonal", "orthogonal"])
  })

  it("limits to the requested top-k", () => {
    const query = [1, 0]
    const cands = [
      { embedding: [1, 0], item: "a" },
      { embedding: [0.9, 0.1], item: "b" },
      { embedding: [0.8, 0.2], item: "c" },
    ]
    const r = topK(query, cands, 2)
    expect(r).toHaveLength(2)
    expect(r[0].item).toBe("a")
  })

  it("filters by threshold", () => {
    const query = [1, 0]
    const cands = [
      { embedding: [1, 0], item: "high" },
      { embedding: [0, 1], item: "orthogonal" },
      { embedding: [-1, 0], item: "antipodal" },
    ]
    const r = topK(query, cands, 5, 0.5)
    expect(r.map(x => x.item)).toEqual(["high"])
  })

  it("dim-mismatched candidate is filtered, not thrown", () => {
    // Architect-flagged: a single corrupted DB row shouldn't 500 the entire search.
    const query = [1, 0]
    const cands = [
      { embedding: [1, 0], item: "good" },
      { embedding: [1, 0, 0], item: "bad-dim" }, // dim mismatch
      { embedding: [0.9, 0.1], item: "also-good" },
    ]
    const r = topK(query, cands, 5, 0)
    expect(r.map(x => x.item)).toEqual(["good", "also-good"])
  })

  it("propagates non-dim-mismatch errors (so genuine bugs aren't masked)", () => {
    // Construct a candidate whose `.embedding` getter throws something else.
    const query = [1, 0]
    const cands = [
      {
        get embedding() {
          throw new Error("kaboom")
        },
        item: "throws",
      } as unknown as { embedding: number[]; item: string },
      { embedding: [1, 0], item: "good" },
    ]
    expect(() => topK(query, cands, 5, 0)).toThrow(/kaboom/)
  })

  it("stable on equal similarity (input order preserved)", () => {
    const query = [1, 0]
    const cands = [
      { embedding: [0, 1], item: "first" }, // sim 0
      { embedding: [0, 1], item: "second" }, // sim 0
      { embedding: [0, 1], item: "third" }, // sim 0
    ]
    const r = topK(query, cands, 5, -1)
    expect(r.map(x => x.item)).toEqual(["first", "second", "third"])
  })
})

/* ─── content extractors ──────────────────────────────────────────────── */

describe("H13 — content extractors", () => {
  it("dealContent concatenates only present fields", () => {
    const c = dealContent({
      name: "Acme renewal",
      customerNeed: "Pricing review",
      notes: null,
      lostReason: null,
      stage: "negotiation",
      tags: ["renewal", "enterprise"],
    })
    expect(c).toContain("Acme renewal")
    expect(c).toContain("Pricing review")
    expect(c).toContain("negotiation")
    expect(c).toContain("renewal")
    expect(c).not.toContain("null")
  })

  it("contactContent handles all-optional fields gracefully", () => {
    expect(contactContent({ fullName: "Jane Doe" })).toBe("Contact: Jane Doe")
    const full = contactContent({
      fullName: "Jane Doe",
      email: "jane@example.com",
      position: "VP of Sales",
      department: "Revenue",
    })
    expect(full).toContain("Jane Doe")
    expect(full).toContain("VP of Sales")
    expect(full).toContain("Revenue")
    expect(full).toContain("jane@example.com")
  })

  it("companyContent + ticketContent + kbArticleContent stable on minimal input", () => {
    expect(companyContent({ name: "Acme" })).toBe("Company: Acme")
    expect(ticketContent({ subject: "Login broken" })).toBe("Ticket: Login broken")
    expect(kbArticleContent({ title: "Reset", content: "Click here" })).toContain("Reset")
  })

  it("trims runs of whitespace + truncates to MAX_CONTENT_CHARS", () => {
    const huge = "Deal: " + "x ".repeat(5000)
    const c = dealContent({ name: huge })
    expect(c.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS)
    expect(c.includes("  ")).toBe(false) // multi-space collapsed
  })

  it("extractContent dispatches by type", () => {
    expect(extractContent("deal", { name: "X" })).toContain("Deal: X")
    expect(extractContent("contact", { fullName: "Y" })).toContain("Contact: Y")
    expect(extractContent("company", { name: "Z" })).toContain("Company: Z")
    expect(extractContent("ticket", { subject: "Q" })).toContain("Ticket: Q")
    expect(extractContent("kb_article", { title: "T", content: "B" })).toContain("Article: T")
  })
})

/* ─── DeterministicEmbedder ───────────────────────────────────────────── */

describe("H13 — DeterministicEmbedder", () => {
  it("returns DETERMINISTIC_DIM-length vector", async () => {
    const v = await DeterministicEmbedder.embed("hello world")
    expect(v).toHaveLength(DETERMINISTIC_DIM)
  })

  it("identical input → identical vector", async () => {
    const a = await DeterministicEmbedder.embed("Acme renewal pricing")
    const b = await DeterministicEmbedder.embed("Acme renewal pricing")
    expect(a).toEqual(b)
  })

  it("L2-normalised (magnitude ≈ 1 for non-empty input)", async () => {
    const v = await DeterministicEmbedder.embed("hello world example")
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(mag).toBeCloseTo(1, 6)
  })

  it("shared tokens produce non-zero cosine similarity", async () => {
    const a = await DeterministicEmbedder.embed("Acme renewal pricing review")
    const b = await DeterministicEmbedder.embed("Acme contract renewal next quarter")
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0) // share "acme" + "renewal"
    expect(sim).toBeLessThan(1) // not identical
  })

  it("disjoint vocabulary → low similarity", async () => {
    const a = await DeterministicEmbedder.embed("apple banana cherry")
    const b = await DeterministicEmbedder.embed("xyz qrs tuv")
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeLessThan(0.1)
  })

  it("model identifier is stable", () => {
    expect(DeterministicEmbedder.model).toBe("deterministic-fallback-v1")
  })
})

/* ─── embedAndHashContent ─────────────────────────────────────────────── */

function mockEmbedder(model = "test-model"): SemanticEmbedClient {
  return {
    model,
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  }
}

describe("H13 — embedAndHashContent", () => {
  it("throws on empty content", async () => {
    await expect(embedAndHashContent(mockEmbedder(), "")).rejects.toThrow(/empty content/)
    await expect(embedAndHashContent(mockEmbedder(), "   ")).rejects.toThrow(/empty content/)
  })

  it("calls embedder with the trimmed content", async () => {
    const e = mockEmbedder()
    await embedAndHashContent(e, "  hello world  ")
    expect(e.embed).toHaveBeenCalledWith("hello world")
  })

  it("returns embedding + contentHash + model triple", async () => {
    const e = mockEmbedder("voyage-3")
    const r = await embedAndHashContent(e, "Acme renewal")
    expect(r.embedding).toEqual([0.1, 0.2, 0.3])
    expect(r.model).toBe("voyage-3")
    expect(r.contentHash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex
  })

  it("identical content → identical hash", async () => {
    const r1 = await embedAndHashContent(mockEmbedder(), "Deal: Acme renewal")
    const r2 = await embedAndHashContent(mockEmbedder(), "Deal: Acme renewal")
    expect(r1.contentHash).toBe(r2.contentHash)
  })

  it("throws when embedder returns invalid vector", async () => {
    const bad: SemanticEmbedClient = {
      model: "broken",
      embed: vi.fn().mockResolvedValue([]),
    }
    await expect(embedAndHashContent(bad, "anything")).rejects.toThrow(/invalid vector/)
  })

  it("hashContent is deterministic SHA-256 hex", () => {
    const h = hashContent("hello")
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })
})

/* ─── rankCandidates ──────────────────────────────────────────────────── */

describe("H13 — rankCandidates", () => {
  const mkCandidate = (
    recordType: CandidateRow["recordType"],
    recordId: string,
    embedding: number[],
    content = "snippet"
  ): CandidateRow => ({
    recordType,
    recordId,
    content,
    embedding,
    embeddingVersion: 1,
  })

  it("returns hits sorted by similarity desc", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: [
        mkCandidate("deal", "d1", [0, 1]),
        mkCandidate("contact", "c1", [1, 0]),
        mkCandidate("company", "co1", [0.7, 0.7]),
      ],
      limit: 5,
      threshold: -1,
    })
    expect(r.hits.map(h => h.recordId)).toEqual(["c1", "co1", "d1"])
  })

  it("limit caps the hit count", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: Array.from({ length: 30 }, (_, i) =>
        mkCandidate("deal", `d${i}`, [1, 0])
      ),
      limit: 5,
      threshold: 0,
    })
    expect(r.hits).toHaveLength(5)
  })

  it("threshold drops low-similarity hits", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: [
        mkCandidate("deal", "high", [1, 0]),
        mkCandidate("deal", "low", [0, 1]),
      ],
      limit: 10,
      threshold: 0.5,
    })
    expect(r.hits.map(h => h.recordId)).toEqual(["high"])
  })

  it("byType count reflects all candidates (not just hits)", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: [
        mkCandidate("deal", "d1", [0, 1]), // low — filtered
        mkCandidate("deal", "d2", [1, 0]), // high — surfaces
        mkCandidate("contact", "c1", [0, 1]),
      ],
      limit: 10,
      threshold: 0.5,
    })
    expect(r.byType.deal).toBe(2) // both deals counted
    expect(r.byType.contact).toBe(1)
    expect(r.hits).toHaveLength(1)
  })

  it("contentSnippet truncates content to 240 chars", () => {
    const longContent = "x".repeat(500)
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: [mkCandidate("deal", "d1", [1, 0], longContent)],
      limit: 1,
      threshold: 0,
    })
    expect(r.hits[0].contentSnippet).toHaveLength(240)
  })

  it("candidateCount reports total considered", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: Array.from({ length: 7 }, (_, i) =>
        mkCandidate("deal", `d${i}`, [1, 0])
      ),
      limit: 3,
      threshold: 0,
    })
    expect(r.candidateCount).toBe(7)
  })

  it("non-finite threshold falls back to default 0", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: [
        mkCandidate("deal", "high", [1, 0]),
        mkCandidate("deal", "low", [-1, 0]),
      ],
      limit: 10,
      threshold: NaN,
    })
    expect(r.hits.map(h => h.recordId)).toEqual(["high"])
  })

  it("non-positive limit falls back to default 20", () => {
    const r = rankCandidates({
      queryEmbedding: [1, 0],
      candidates: Array.from({ length: 30 }, (_, i) =>
        mkCandidate("deal", `d${i}`, [1, 0])
      ),
      limit: 0,
      threshold: 0,
    })
    expect(r.hits).toHaveLength(20)
  })
})

/* ─── End-to-end: extract + embed + rank ──────────────────────────────── */

describe("H13 — end-to-end with DeterministicEmbedder", () => {
  it("query about 'Acme renewal pricing' surfaces the Acme deal over an unrelated ticket", async () => {
    const dealText = dealContent({
      name: "Acme renewal",
      customerNeed: "Pricing review for Q3",
      notes: "Discussing volume discounts and renewal terms.",
    })
    const ticketText = ticketContent({
      subject: "Login broken",
      description: "User cannot log in after password reset.",
    })
    const dealVec = await DeterministicEmbedder.embed(dealText)
    const ticketVec = await DeterministicEmbedder.embed(ticketText)
    const queryVec = await DeterministicEmbedder.embed("Acme renewal pricing")

    const r = rankCandidates({
      queryEmbedding: queryVec,
      candidates: [
        {
          recordType: "deal",
          recordId: "d1",
          content: dealText,
          embedding: [...dealVec],
          embeddingVersion: 1,
        },
        {
          recordType: "ticket",
          recordId: "t1",
          content: ticketText,
          embedding: [...ticketVec],
          embeddingVersion: 1,
        },
      ],
      limit: 5,
      threshold: 0,
    })

    expect(r.hits[0].recordType).toBe("deal")
    expect(r.hits[0].similarity).toBeGreaterThan(
      r.hits.find(h => h.recordType === "ticket")?.similarity ?? 0
    )
  })
})
