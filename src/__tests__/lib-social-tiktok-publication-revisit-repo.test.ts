import { describe, expect, it, vi } from "vitest"
const prismaMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  createMany: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: prismaMocks.queryRaw,
    tikTokPublicationRevisit: { createMany: prismaMocks.createMany },
  },
}))
import {
  dueTikTokPublicationRevisits,
  reactivateTikTokPublication,
  reconcileTikTokPublicationRevisits,
  reconcileTikTokPublicationRevisitsForSource,
  recordTikTokPublicationRevisit,
  registerTikTokPublicationRevisit,
  type TikTokPublicationRevisitStore,
} from "@/lib/social/tiktok-publication-revisit-repo"

function store(overrides: Partial<TikTokPublicationRevisitStore> = {}): TikTokPublicationRevisitStore {
  return {
    findApprovedEnvelope: vi.fn(async () => null),
    findActiveSourceSubjectIds: vi.fn(async () => []),
    findApprovedPublicationsWithoutRevisit: vi.fn(async () => []),
    createMany: vi.fn(async () => ({ count: 0 })),
    upsert: vi.fn(async () => ({})), findDue: vi.fn(async () => []),
    findStateByPost: vi.fn(async () => null), findState: vi.fn(async () => null), update: vi.fn(async () => ({})), reactivate: vi.fn(async () => 0), ...overrides,
  }
}

describe("TikTok publication revisit repository", () => {
  it("backfills negative matched parents with a bounded tenant/subject-scoped add-only insert", async () => {
    const approvedAt = new Date("2026-07-18T00:00:00Z")
    const now = new Date("2026-08-01T00:00:00Z")
    const findApprovedPublicationsWithoutRevisit = vi.fn(async () => [{
      id: "env-old",
      postExternalId: "video-old",
      externalId: null,
      canonicalUrl: "https://www.tiktok.com/@brand/video/video-old?utm_source=x",
      url: null,
      decidedAt: approvedAt,
      acceptedAt: approvedAt,
      createdAt: approvedAt,
    }])
    const createMany = vi.fn(async () => ({ count: 1 }))

    await expect(reconcileTikTokPublicationRevisits({
      organizationId: "org-1",
      subjectIds: ["subject-1"],
      now,
      limit: 500,
    }, store({ findApprovedPublicationsWithoutRevisit, createMany }))).resolves.toEqual({
      examined: 1,
      created: 1,
    })

    expect(findApprovedPublicationsWithoutRevisit).toHaveBeenCalledWith({
      organizationId: "org-1",
      subjectIds: ["subject-1"],
      limit: 100,
    })
    expect(createMany).toHaveBeenCalledWith({
      data: [{
        organizationId: "org-1",
        ingestEnvelopeId: "env-old",
        postExternalId: "video-old",
        canonicalUrl: "https://tiktok.com/@brand/video/video-old",
        approvedAt,
        lastActivityAt: approvedAt,
        nextDueAt: now,
        status: "ACTIVE",
      }],
      skipDuplicates: true,
    })
  })

  it("maps a current route to legacy negative parents through active subject lineage", async () => {
    const findActiveSourceSubjectIds = vi.fn(async () => [{ id: "subject-db" }, { id: "subject-route" }])
    const findApprovedPublicationsWithoutRevisit = vi.fn(async () => [])

    await expect(reconcileTikTokPublicationRevisitsForSource({
      organizationId: "org-1",
      sourceId: "active-source",
      sourceSettings: {
        scenarioLinks: [{ subjectId: "subject-settings" }],
      },
      targetSubjectId: "subject-route",
      now: new Date("2026-08-01T00:00:00Z"),
      limit: 20,
    }, store({ findActiveSourceSubjectIds, findApprovedPublicationsWithoutRevisit }))).resolves.toEqual({
      subjectIds: ["subject-db", "subject-route"],
      examined: 0,
      created: 0,
    })

    expect(findActiveSourceSubjectIds).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "active-source",
      candidateSubjectIds: ["subject-route", "subject-settings"],
    })
    expect(findApprovedPublicationsWithoutRevisit).toHaveBeenCalledWith({
      organizationId: "org-1",
      subjectIds: ["subject-db", "subject-route"],
      limit: 20,
    })
  })

  it("uses a bounded database anti-join so cross-provider sibling posts cannot starve repair", async () => {
    const now = new Date("2026-08-01T00:00:00Z")
    const rawTikTokVideoId = "7665752426237988103"
    prismaMocks.queryRaw.mockResolvedValueOnce([{
      id: "env-later",
      postExternalId: null,
      externalId: `apify:${rawTikTokVideoId}`,
      canonicalUrl: `https://www.tiktok.com/@brand/video/${rawTikTokVideoId}`,
      url: null,
      decidedAt: now,
      acceptedAt: now,
      createdAt: now,
    }])
    prismaMocks.createMany.mockResolvedValueOnce({ count: 1 })

    await expect(reconcileTikTokPublicationRevisits({
      organizationId: "org-1",
      subjectIds: ["subject-1"],
      now,
      limit: 1,
    })).resolves.toEqual({ examined: 1, created: 1 })

    const query = prismaMocks.queryRaw.mock.calls[0][0] as { strings?: readonly string[]; values?: unknown[] }
    const sql = query.strings?.join("?") ?? ""
    expect(sql).toContain('DISTINCT ON (COALESCE(')
    expect(sql).toContain(') AS "postExternalId"')
    expect(sql).toContain('NULLIF(SUBSTRING(NULLIF(BTRIM(e."canonicalUrl"), \'\') FROM \'/video/([^/?#]+)\'), \'\')')
    expect(sql).toContain('WHEN BTRIM(e."externalId") LIKE \'apify:%\'')
    expect(sql.match(/NULLIF\(BTRIM\(e\."postExternalId"\), ''\)/g)).toHaveLength(5)
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('FROM "tiktok_publication_revisits"')
    expect(sql).toContain('revisit."postExternalId" = COALESCE(')
    expect(sql).toContain('LIMIT')
    expect(prismaMocks.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ postExternalId: rawTikTokVideoId, ingestEnvelopeId: "env-later" })],
    }))
  })

  it("registers only a tenant-approved envelope and never broadens its URL", async () => {
    const upsert = vi.fn(async () => ({}))
    const deps = store({ findApprovedEnvelope: vi.fn(async input => ({ id: input.envelopeId, postExternalId: "video-1", externalId: null, canonicalUrl: "https://www.tiktok.com/@brand/video/1?utm_source=x", url: null, decidedAt: new Date("2026-07-18T00:00:00Z") })), upsert })
    await expect(registerTikTokPublicationRevisit({ organizationId: "org-1", envelopeId: "env-1" }, deps)).resolves.toBe(true)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ organizationId: "org-1", ingestEnvelopeId: "env-1", postExternalId: "video-1", canonicalUrl: "https://tiktok.com/@brand/video/1", nextDueAt: new Date("2026-07-18T00:00:00Z") }) }))
    await expect(registerTikTokPublicationRevisit({ organizationId: "org-2", envelopeId: "missing" }, store())).resolves.toBe(false)
  })
  it("registers a legacy provider-prefixed envelope under the raw TikTok video id", async () => {
    const rawTikTokVideoId = "7665752426237988103"
    const upsert = vi.fn(async () => ({}))
    const deps = store({
      findApprovedEnvelope: vi.fn(async input => ({
        id: input.envelopeId,
        postExternalId: null,
        externalId: `apify:${rawTikTokVideoId}`,
        canonicalUrl: `https://www.tiktok.com/@brand/video/${rawTikTokVideoId}`,
        url: null,
        decidedAt: new Date("2026-07-18T00:00:00Z"),
      })),
      upsert,
    })

    await expect(registerTikTokPublicationRevisit({
      organizationId: "org-1",
      envelopeId: "env-legacy",
    }, deps)).resolves.toBe(true)

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_postExternalId: {
          organizationId: "org-1",
          postExternalId: rawTikTokVideoId,
        },
      },
      create: expect.objectContaining({
        ingestEnvelopeId: "env-legacy",
        postExternalId: rawTikTokVideoId,
      }),
    }))
  })
  it("selects due rows inside one tenant and a bounded limit", async () => {
    const findDue = vi.fn(async () => [])
    await dueTikTokPublicationRevisits("org-1", new Date("2026-07-20T00:00:00Z"), 250, store({ findDue }))
    expect(findDue).toHaveBeenCalledWith({ organizationId: "org-1", now: new Date("2026-07-20T00:00:00Z"), limit: 100 })
  })
  it("advances activity only when the observed comment count grows", async () => {
    const update = vi.fn(async () => ({})); const lastActivityAt = new Date("2026-07-10T00:00:00Z")
    const deps = store({ findState: vi.fn(async () => ({ id: "rev-1", approvedAt: new Date("2026-07-01T00:00:00Z"), lastActivityAt, lastCheckedAt: null, status: "ACTIVE", reactivationGeneration: 0, lastSeenCommentCount: 10 })), update })
    await recordTikTokPublicationRevisit({ organizationId: "org-1", id: "rev-1", observedCommentCount: 10, coverageClass: "COMPLETE", now: new Date("2026-07-13T00:00:00Z") }, deps)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastActivityAt, lastSeenCommentCount: 10 }) }))
  })
  it("reactivates through an organization-scoped atomic update", async () => {
    const reactivate = vi.fn(async () => 1)
    await expect(reactivateTikTokPublication({ organizationId: "org-1", id: "rev-1", now: new Date("2026-08-01T00:00:00Z") }, store({ reactivate }))).resolves.toBe(true)
    expect(reactivate).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", id: "rev-1" }))
  })
})
