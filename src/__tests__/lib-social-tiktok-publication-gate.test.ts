import { describe, expect, it, vi } from "vitest"

const updateMany = vi.hoisted(() => vi.fn())
const findFirst = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: { ingestEnvelope: { updateMany, findFirst } } }))
import { buildTikTokApprovedParentDispatch, decideTikTokPublication, isTikTokPublicationEligibleForComments, persistTikTokPublicationDecision } from "@/lib/social/tiktok-publication-gate"

const base = { query: "LeadDrive", scenarioIds: ["scn-1"], provider: "bright-data", observedAt: new Date("2026-07-18T12:00:00Z"), publishedAt: new Date("2026-07-18T10:00:00Z"), freshnessSince: new Date("2026-07-17T12:00:00Z"), caption: "LeadDrive CRM review", positiveTerms: ["LeadDrive"], negativeTerms: [] }

describe("TikTok publication relevance gate", () => {
  it.each([
    [{}, "MATCHED", "DETERMINISTIC_TERM_MATCH"],
    [{ negativeTerms: ["review"] }, "REJECTED", "NEGATIVE_TERM"],
    [{ caption: "Acme update", positiveTerms: ["Acme"], ambiguous: true }, "REVIEW", "AMBIGUOUS_EVIDENCE"],
    [{ publishedAt: new Date("2026-07-01T00:00:00Z") }, "REJECTED", "STALE_PUBLICATION"],
    [{ publishedAt: null }, "REVIEW", "MISSING_PUBLISHED_AT"],
    [{ caption: "context suggests it", aiConfidence: 0.9, probableOptIn: true }, "PROBABLE", "AI_CONTEXT_PROBABLE"],
    [{ caption: "unrelated", positiveTerms: [] }, "REJECTED", "INSUFFICIENT_EVIDENCE"],
  ])("classifies fixtures", (overrides, status, reasonCode) => {
    expect(decideTikTokPublication({ ...base, ...overrides })).toMatchObject({ status, reasonCode, query: "LeadDrive", scenarioIds: ["scn-1"] })
  })

  it("allows comments only for MATCHED and opted-in PROBABLE", () => {
    const matched = decideTikTokPublication(base)
    const probable = decideTikTokPublication({ ...base, caption: "context", positiveTerms: [], aiConfidence: 0.9, probableOptIn: true })
    const review = decideTikTokPublication({ ...base, caption: "Acme", positiveTerms: ["Acme"], ambiguous: true })
    expect(isTikTokPublicationEligibleForComments(matched)).toBe(true)
    expect(isTikTokPublicationEligibleForComments(probable)).toBe(true)
    expect(isTikTokPublicationEligibleForComments({ ...probable, policySnapshot: { ...probable.policySnapshot, probableOptIn: false } })).toBe(false)
    expect(isTikTokPublicationEligibleForComments(review)).toBe(false)
  })

  it("binds provider input to one canonical approved parent and tenant policy", () => {
    const decision = decideTikTokPublication(base)
    const input = buildTikTokApprovedParentDispatch({ organizationId: "org-1", parent: { canonicalUrl: "https://tiktok.com/@brand/video/123?utm_source=x", videoId: "123", decision }, maxItems: 200 })
    expect(input.postURLs).toEqual(["https://tiktok.com/@brand/video/123"])
    expect(input.leadDrivePolicy).toMatchObject({ organizationId: "org-1", videoId: "123", decision: "MATCHED", liveReplies: false })
    expect(() => buildTikTokApprovedParentDispatch({ organizationId: "org-1", parent: { canonicalUrl: "https://tiktok.com/@brand/video/123", videoId: "123", decision: { ...decision, status: "REVIEW" } }, maxItems: 1 })).toThrow(/approved publication/)
  })
  it("registers revisit state only after an eligible decision is persisted", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    const registerRevisit = vi.fn(async () => true)
    await expect(persistTikTokPublicationDecision({ organizationId: "org-1", envelopeId: "env-1", decision: decideTikTokPublication(base) }, { registerRevisit })).resolves.toBe("applied")
    expect(registerRevisit).toHaveBeenCalledWith({ organizationId: "org-1", envelopeId: "env-1" })

    registerRevisit.mockClear()
    const review = decideTikTokPublication({ ...base, ambiguous: true })
    await persistTikTokPublicationDecision({ organizationId: "org-1", envelopeId: "env-2", decision: review }, { registerRevisit })
    expect(registerRevisit).not.toHaveBeenCalled()
  })

  it("registers an eligible publication that subject matching already accepted", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    const registerRevisit = vi.fn(async () => true)

    await persistTikTokPublicationDecision({
      organizationId: "org-1",
      envelopeId: "env-already-accepted",
      decision: decideTikTokPublication(base),
    }, { registerRevisit })

    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ relevanceStatus: { in: ["PENDING", "REVIEW", "ACCEPTED"] } }),
    }))
    expect(registerRevisit).toHaveBeenCalledWith({ organizationId: "org-1", envelopeId: "env-already-accepted" })
  })

  it("does not downgrade an accepted publication after an ineligible decision", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    findFirst.mockResolvedValueOnce(null)
    const registerRevisit = vi.fn(async () => true)

    await persistTikTokPublicationDecision({
      organizationId: "org-1",
      envelopeId: "env-already-accepted",
      decision: decideTikTokPublication({ ...base, caption: "unrelated", positiveTerms: [] }),
    }, { registerRevisit })

    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ relevanceStatus: { in: ["PENDING", "REVIEW"] } }),
    }))
    expect(registerRevisit).not.toHaveBeenCalled()
  })

  // #657: одна повторно встреченная отклонённая запись роняла импорт всего
  // набора. Терминальный конверт — не сбой записи: продвигать нечего и
  // ревизита у него быть не может.
  it("reports a terminally rejected envelope as skipped, not as a write failure", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    findFirst.mockResolvedValueOnce({ id: "env-rejected" })
    const registerRevisit = vi.fn(async () => true)

    await expect(persistTikTokPublicationDecision({
      organizationId: "org-1",
      envelopeId: "env-rejected",
      decision: decideTikTokPublication(base),
    }, { registerRevisit })).resolves.toBe("skipped_terminal")

    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        relevanceStatus: { in: ["REJECTED", "POLICY_DENIED", "DELETED_AT_SOURCE", "PURGED"] },
      }),
    }))
    expect(registerRevisit).not.toHaveBeenCalled()
  })

  it("still reports a real write failure so the importer can fail closed", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    findFirst.mockResolvedValueOnce(null)
    const registerRevisit = vi.fn(async () => true)

    await expect(persistTikTokPublicationDecision({
      organizationId: "org-1",
      envelopeId: "env-live",
      decision: decideTikTokPublication(base),
    }, { registerRevisit })).resolves.toBe("failed")
    expect(registerRevisit).not.toHaveBeenCalled()
  })
})
