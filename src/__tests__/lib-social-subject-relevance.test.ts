import { beforeEach, describe, expect, it, vi } from "vitest"

const { findMany, subjectMatchCreate, subjectMatchUpsert, subjectMatchUpdateMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
  subjectMatchCreate: vi.fn(),
  subjectMatchUpsert: vi.fn(),
  subjectMatchUpdateMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: { findMany },
    socialMentionSubjectMatch: {
      create: subjectMatchCreate,
      upsert: subjectMatchUpsert,
      updateMany: subjectMatchUpdateMany,
    },
  },
}))

import { decideSubjectRelevance, evaluateSubjectRelevance, persistSubjectMatches, SUBJECT_MATCHER_VERSION } from "@/lib/social/subject-relevance"
import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"

function input(text: string, sourceId?: string, extra: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    platform: "instagram",
    externalId: "comment-1",
    sourceType: "comment",
    text,
    sentiment: null,
    matchedTerm: null,
    sourceMetadata: {},
    observation: sourceId ? { sourceId } : undefined,
    ...extra,
  }
}

function parentMatchContext(overrides: Record<string, unknown> = {}) {
  return {
    parentMentionId: "mention-parent-1",
    matchedTerm: "LeadDrive",
    subjectIds: ["subject-1"],
    parentSentiment: null,
    inheritAllCommentSubjectIds: [],
    ...overrides,
  }
}

function subject(overrides: Record<string, unknown> = {}) {
  return {
    id: "subject-1",
    organizationId: "org-1",
    type: "BRAND",
    name: "LeadDrive",
    status: "active",
    requiredContext: [],
    exclusions: [],
    aliases: [{
      id: "alias-1",
      subjectId: "subject-1",
      organizationId: "org-1",
      kind: "NAME",
      value: "LeadDrive",
      normalizedValue: "leaddrive",
      language: null,
      weight: 1,
      isNegative: false,
      isAmbiguous: false,
    }],
    sources: [],
    ...overrides,
  }
}

function googleAlertsRssFixture(options: {
  alias?: string
  aliasAmbiguous?: boolean
  matchedTerm?: string
  metadataMatchedVia?: string
  policyMatchedVia?: string
  sourceOverrides?: Record<string, unknown>
} = {}) {
  const sourceId = "source-google-alerts-rss"
  const alias = options.alias ?? "Oba Market"
  const metadataMatchedVia = options.metadataMatchedVia ?? "google_alerts_feed_snippet"
  const policyMatchedVia = options.policyMatchedVia ?? metadataMatchedVia
  const monitored = subject({
    name: alias,
    requiredContext: ["Azərbaycan", "Bakı", "manat", "endirim"],
    aliases: [{
      ...subject().aliases[0],
      value: alias,
      normalizedValue: normalizeSubjectTerm(alias),
      isAmbiguous: options.aliasAmbiguous ?? false,
    }],
    sources: [{
      id: "link-google-alerts-rss",
      sourceId,
      relationType: "MONITORS",
      trustWeight: 0.98,
      source: {
        id: sourceId,
        platform: "web",
        sourceType: "notification_inbox",
        collectionMode: "notification_inbox",
        query: "google-alerts-rss:scenario-1",
        ownership: "external",
        status: "active",
        settings: {
          managedBy: "google_alerts_rss",
          googleAlertsRss: {
            configured: true,
            policyVersion: "google-alerts-rss-v1",
          },
        },
        handle: null,
        url: null,
        ...options.sourceOverrides,
      },
    }],
  })
  const article = input(`${alias} festivalın tərəfdaşıdır`, sourceId, {
    platform: "web",
    sourceType: "mention",
    contentKind: "ARTICLE",
    sourceProvider: "notification_inbox",
    matchedTerm: options.matchedTerm ?? alias,
    sourceMetadata: {
      monitoringSourceId: sourceId,
      collector: "google_alerts_rss",
      policyVersion: "google-alerts-rss-v1",
      matchedVia: metadataMatchedVia,
    },
    observation: {
      sourceId,
      providerKey: "google_alerts",
      relevanceStatus: "ACCEPTED",
      relevanceReason: "google_alerts_rss_verified_newsarticle",
      policySnapshot: {
        policyVersion: "google-alerts-rss-v1",
        transport: "rss",
        matchedVia: policyMatchedVia,
      },
    },
  })
  return { monitored, article }
}

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
  subjectMatchCreate.mockResolvedValue({ id: "match-1" })
  subjectMatchUpsert.mockResolvedValue({ id: "match-1" })
  subjectMatchUpdateMany.mockResolvedValue({ count: 0 })
})

describe("subject relevance", () => {
  it("normalizes uppercase Latin OCR text without losing Azerbaijani or Cyrillic letters", () => {
    expect(normalizeSubjectTerm("ACME ROBOTICS")).toBe("acme robotics")
    expect(normalizeSubjectTerm("Acme Robotics")).toBe("acme robotics")
    expect(normalizeSubjectTerm("İLHAM ƏLİYEV — qırmızı ŞÖBƏ")).toBe("ilham əliyev — qırmızı şöbə")
    expect(normalizeSubjectTerm("БРЕНД МОНИТОРИНГ")).toBe("бренд мониторинг")
  })

  it("matches an all-caps Latin OCR mention against a mixed-case alias", async () => {
    findMany.mockResolvedValue([subject({
      name: "Acme Robotics",
      aliases: [{
        id: "alias-acme",
        subjectId: "subject-1",
        organizationId: "org-1",
        kind: "NAME",
        value: "Acme Robotics",
        normalizedValue: "acme robotics",
        language: "en",
        weight: 1,
        isNegative: false,
        isAmbiguous: false,
      }],
    })])

    await expect(evaluateSubjectRelevance(input("ACME ROBOTICS"))).resolves.toMatchObject({
      status: "ACCEPTED",
      matchedTerms: ["Acme Robotics"],
    })
  })

  it("preserves legacy relevance behavior when no subjects exist", async () => {
    await expect(evaluateSubjectRelevance(input("anything"))).resolves.toBeNull()
  })

  it("accepts a strong brand alias and records its provenance", async () => {
    findMany.mockResolvedValue([subject()])
    const result = await evaluateSubjectRelevance(input("LeadDrive barədə şikayətim var"))

    expect(result).toMatchObject({ status: "ACCEPTED", reason: "subject_alias_match", confidence: 1 })
    expect(result?.matches[0]).toMatchObject({ subjectId: "subject-1", matchedAliasIds: ["alias-1"] })
  })

  it("evaluates a profile-scoped provider result only for its selected monitoring", async () => {
    findMany.mockResolvedValue([
      subject(),
      subject({
        id: "subject-2",
        name: "Baku Electronics",
        aliases: [{
          ...subject().aliases[0],
          id: "alias-2",
          subjectId: "subject-2",
          value: "Baku Electronics",
          normalizedValue: "baku electronics",
        }],
      }),
    ])

    await expect(evaluateSubjectRelevance(input("LeadDrive barədə xəbər", undefined, {
      sourceMetadata: { targetSubjectId: "subject-2" },
    }))).resolves.toMatchObject({
      status: "REJECTED",
      reason: "no_monitoring_subject_match",
      matches: [],
    })
    await expect(evaluateSubjectRelevance(input("Baku Electronics barədə şikayət", undefined, {
      sourceMetadata: { targetSubjectId: "subject-2" },
    }))).resolves.toMatchObject({
      status: "ACCEPTED",
      matches: [expect.objectContaining({ subjectId: "subject-2" })],
    })
  })

  it("fails closed when a selected monitoring disappeared before provider import", async () => {
    findMany.mockResolvedValue([subject()])

    await expect(evaluateSubjectRelevance(input("LeadDrive barədə xəbər", undefined, {
      sourceMetadata: { targetSubjectId: "missing-subject" },
    }))).resolves.toMatchObject({
      status: "REJECTED",
      reason: "no_monitoring_subject_match",
      matches: [],
    })
  })

  it("routes a matched alias below the versioned auto-accept threshold to review", () => {
    const weakSubject = subject({
      aliases: [{
        ...subject().aliases[0],
        weight: 0.69,
      }],
    })

    expect(decideSubjectRelevance([weakSubject] as never, input("LeadDrive"))).toMatchObject({
      status: "REVIEW",
      confidence: 0.69,
    })
  })

  it("rejects a short ambiguous name until an independent context signal exists", async () => {
    findMany.mockResolvedValue([subject({
      name: "Ada",
      requiredContext: ["mathematician"],
      aliases: [{
        id: "alias-ada",
        subjectId: "subject-1",
        organizationId: "org-1",
        kind: "NAME",
        value: "Ada",
        normalizedValue: "ada",
        language: null,
        weight: 1,
        isNegative: false,
        isAmbiguous: true,
      }],
    })])

    await expect(evaluateSubjectRelevance(input("Ada published a note"))).resolves.toMatchObject({
      status: "REJECTED",
      reason: "required_context_missing",
    })
    await expect(evaluateSubjectRelevance(input("Ada was a mathematician"))).resolves.toMatchObject({ status: "ACCEPTED" })
  })

  it("accepts an exact brand alias from a verified scenario-linked Google Alerts RSS article", () => {
    const { monitored, article } = googleAlertsRssFixture()

    expect(decideSubjectRelevance([monitored] as never, article)).toMatchObject({
      status: "ACCEPTED",
      reason: "subject_alias_match",
      matches: [expect.objectContaining({
        contextSignals: expect.objectContaining({
          verifiedGoogleAlertsExactAlias: true,
          requiredContextMatches: [],
        }),
      })],
    })
  })

  it("does not bypass required context when the RSS matched term is not the exact alias", () => {
    const { monitored, article } = googleAlertsRssFixture({ matchedTerm: "festival" })

    expect(decideSubjectRelevance([monitored] as never, article)).toMatchObject({
      status: "REJECTED",
      reason: "required_context_missing",
    })
  })

  it("does not bypass required context when RSS provenance layers disagree", () => {
    const { monitored, article } = googleAlertsRssFixture({
      metadataMatchedVia: "google_alerts_feed_snippet",
      policyMatchedVia: "article_metadata",
    })

    expect(decideSubjectRelevance([monitored] as never, article)).toMatchObject({
      status: "REJECTED",
      reason: "required_context_missing",
    })
  })

  it("does not let Google Alerts provenance bypass context for an ambiguous alias", () => {
    const { monitored, article } = googleAlertsRssFixture({
      alias: "Oba",
      aliasAmbiguous: true,
    })

    expect(decideSubjectRelevance([monitored] as never, article)).toMatchObject({
      status: "REJECTED",
      reason: "required_context_missing",
      matches: [expect.objectContaining({
        contextSignals: expect.objectContaining({
          verifiedGoogleAlertsExactAlias: false,
        }),
      })],
    })
  })

  it("does not trust Google Alerts-shaped metadata from a non-RSS source", () => {
    const { monitored, article } = googleAlertsRssFixture({
      sourceOverrides: {
        sourceType: "keyword",
        collectionMode: "search_index",
      },
    })

    expect(decideSubjectRelevance([monitored] as never, article)).toMatchObject({
      status: "REJECTED",
      reason: "required_context_missing",
    })
  })

  it("rejects ambiguous aliases until an independent context signal exists", () => {
    const ambiguousBravo = subject({
      name: "Bravo Supermarket",
      aliases: [
        { ...subject().aliases[0], id: "alias-bravo-name", value: "Bravo Supermarket", normalizedValue: "bravo supermarket", isAmbiguous: true },
        { ...subject().aliases[0], id: "alias-bravo-hashtag", kind: "HASHTAG", value: "bravosupermarket", normalizedValue: "bravosupermarket", isAmbiguous: true },
        { ...subject().aliases[0], id: "alias-bravo-az", kind: "HASHTAG", value: "bravosupermarketaz", normalizedValue: "bravosupermarketaz", isAmbiguous: false },
      ],
    })

    expect(decideSubjectRelevance([ambiguousBravo] as never, input("Tour Bravo Supermarket West Palm Beach"))).toMatchObject({
      status: "REJECTED",
      reason: "ambiguous_alias_requires_second_signal",
    })
    expect(decideSubjectRelevance([ambiguousBravo] as never, input("#bravosupermarket grocery sale"))).toMatchObject({
      status: "REJECTED",
      reason: "ambiguous_alias_requires_second_signal",
    })
    expect(decideSubjectRelevance([ambiguousBravo] as never, input("#bravosupermarketaz endirimləri"))).toMatchObject({
      status: "ACCEPTED",
    })
  })

  it("rejects posts authored by an explicitly official subject source", () => {
    const monitored = subject({
      aliases: [{ ...subject().aliases[0], value: "Bravo Supermarket", normalizedValue: "bravo supermarket" }],
      sources: [{
        id: "link-official",
        sourceId: "source-official",
        relationType: "OFFICIAL",
        trustWeight: 1,
        source: {
          id: "source-official",
          handle: "Bravo Supermarket Azerbaijan",
          url: "https://www.youtube.com/channel/UCUDPswYmu2SCJQCr7qDdtwA",
        },
      }],
    })

    expect(decideSubjectRelevance([monitored] as never, input("Bravo Supermarket endirimləri", undefined, {
      contentKind: "POST",
      authorName: "Bravo Supermarket Azerbaijan",
    }))).toMatchObject({ status: "REJECTED", reason: "official_author" })
    expect(decideSubjectRelevance([monitored] as never, input("Bravo Supermarket endirimləri", undefined, {
      contentKind: "POST",
      authorHandle: "UCUDPswYmu2SCJQCr7qDdtwA",
    }))).toMatchObject({ status: "REJECTED", reason: "official_author" })
    expect(decideSubjectRelevance([monitored] as never, input("Bravo Supermarket haqqında müştəri rəyi", undefined, {
      contentKind: "POST",
      authorName: "Ya v Baku",
    }))).toMatchObject({ status: "ACCEPTED" })
  })

  it("rejects an official handle alias without requiring a page source", () => {
    const monitored = subject({
      name: "Araz Supermarket",
      aliases: [
        {
          ...subject().aliases[0],
          value: "Araz Supermarket",
          normalizedValue: "araz supermarket",
        },
        {
          ...subject().aliases[0],
          id: "alias-handle",
          kind: "HANDLE",
          value: "@arazsupermarket",
          normalizedValue: "arazsupermarket",
        },
      ],
      sources: [],
    })

    expect(decideSubjectRelevance([monitored] as never, input("Araz Supermarket endirimləri", undefined, {
      platform: "facebook",
      sourceType: "post",
      contentKind: "POST",
      authorHandle: "arazsupermarket",
    }))).toMatchObject({ status: "REJECTED", reason: "official_author" })
    expect(decideSubjectRelevance([monitored] as never, input("Araz Supermarket haqqında rəy", undefined, {
      platform: "facebook",
      sourceType: "post",
      contentKind: "POST",
      authorHandle: "arazsupermarket_fans",
      authorName: "arazsupermarket",
    }))).toMatchObject({ status: "ACCEPTED" })
  })

  it("does not infer an official author from a hashtag alias", () => {
    const monitored = subject({
      name: "Araz Supermarket",
      aliases: [
        {
          ...subject().aliases[0],
          value: "Araz Supermarket",
          normalizedValue: "araz supermarket",
        },
        {
          ...subject().aliases[0],
          id: "alias-hashtag",
          kind: "HASHTAG",
          value: "arazsupermarket",
          normalizedValue: "arazsupermarket",
        },
      ],
      sources: [],
    })

    expect(decideSubjectRelevance([monitored] as never, input("Araz Supermarket haqqında rəy", undefined, {
      platform: "facebook",
      sourceType: "post",
      contentKind: "POST",
      authorHandle: "arazsupermarket",
    }))).toMatchObject({ status: "ACCEPTED" })
  })

  it("rejects a subject match when an exclusion or negative alias is present", async () => {
    findMany.mockResolvedValue([subject({ exclusions: ["car dealership"] })])
    await expect(evaluateSubjectRelevance(input("LeadDrive car dealership"))).resolves.toMatchObject({
      status: "REJECTED",
      reason: "excluded_term",
    })
  })

  it("accepts comments from an explicitly owned subject source without a repeated brand name", async () => {
    findMany.mockResolvedValue([subject({
      aliases: [],
      sources: [{ id: "link-1", sourceId: "source-1", relationType: "OWNED", trustWeight: 1 }],
    })])
    await expect(evaluateSubjectRelevance(input("I need support", "source-1", {
      contentKind: "COMMENT",
      sourceProvider: "native",
    }))).resolves.toMatchObject({
      status: "ACCEPTED",
      reason: "trusted_subject_source",
    })
  })

  it("rejects a keyword-less external comment even when its parent post matched", async () => {
    findMany.mockResolvedValue([subject()])
    const result = await evaluateSubjectRelevance(input("спасибо, очень полезно 👍", undefined, {
      contentKind: "COMMENT",
      parentMatchContext: parentMatchContext(),
    }))

    expect(result).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match", matches: [] })
  })

  it.each([
    { contentKind: "COMMENT", sourceType: "comment" },
    { contentKind: "REPLY", sourceType: "reply" },
  ])("accepts every third-party $contentKind under a matched negative parent", async ({ contentKind, sourceType }) => {
    findMany.mockResolvedValue([subject({ exclusions: ["off topic"] })])
    const result = await evaluateSubjectRelevance(input("thanks, off topic 👍", undefined, {
      contentKind,
      sourceType,
      sourceProvider: "provider_api",
      observation: { requireMatchedTerm: true },
      parentMatchContext: parentMatchContext({
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-1"],
      }),
    }))

    expect(result).toMatchObject({
      status: "ACCEPTED",
      reason: "negative_parent_post_inheritance",
      confidence: 1,
    })
    expect(result?.matches[0]).toMatchObject({
      subjectId: "subject-1",
      status: "MATCHED",
      matchedTerms: [],
      contextSignals: {
        inheritedFromParent: true,
        parentMentionId: "mention-parent-1",
        parentSentiment: "negative",
        inheritancePolicy: "all_comments_v1",
      },
    })
  })

  it("does not inherit complete-thread relevance from a neutral parent or a different subject", async () => {
    findMany.mockResolvedValue([subject()])
    const neutral = await evaluateSubjectRelevance(input("thanks", undefined, {
      contentKind: "COMMENT",
      parentMatchContext: parentMatchContext({
        parentSentiment: "neutral",
        inheritAllCommentSubjectIds: ["subject-1"],
      }),
    }))
    const wrongSubject = await evaluateSubjectRelevance(input("thanks", undefined, {
      contentKind: "COMMENT",
      parentMatchContext: parentMatchContext({
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-other"],
      }),
    }))

    expect(neutral).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match" })
    expect(wrongSubject).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match" })
  })

  it("never lets parent context override an exclusion on the comment", async () => {
    findMany.mockResolvedValue([subject({ exclusions: ["car dealership"] })])
    await expect(evaluateSubjectRelevance(input("nice car dealership btw", undefined, {
      contentKind: "COMMENT",
      parentMatchContext: parentMatchContext(),
    }))).resolves.toMatchObject({ status: "REJECTED", reason: "excluded_term" })
  })

  it("does not inherit parent relevance for non-comment content", async () => {
    findMany.mockResolvedValue([subject()])
    await expect(evaluateSubjectRelevance(input("unrelated repost", undefined, {
      contentKind: "POST",
      parentMatchContext: parentMatchContext(),
    }))).resolves.toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match" })
  })

  it("prefers the comment's own alias match over the inherited parent decision", async () => {
    findMany.mockResolvedValue([subject()])
    const result = await evaluateSubjectRelevance(input("LeadDrive ən yaxşısıdır", undefined, {
      contentKind: "COMMENT",
      parentMatchContext: parentMatchContext(),
    }))

    expect(result).toMatchObject({ status: "ACCEPTED", reason: "subject_alias_match", confidence: 1 })
    // Own match wins; no duplicate inherited entry for the same subject.
    expect(result?.matches).toHaveLength(1)
    expect(result?.matches[0].matchedAliasIds).toEqual(["alias-1"])
  })

  it("uses a direct subject signal as the aggregate reason when another subject is inherited", () => {
    const direct = subject()
    const inherited = subject({
      id: "subject-2",
      name: "Other Brand",
      aliases: [{
        ...subject().aliases[0],
        id: "alias-2",
        subjectId: "subject-2",
        value: "Other Brand",
        normalizedValue: "other brand",
      }],
    })
    const mention = input("LeadDrive ən yaxşısıdır", undefined, {
      contentKind: "COMMENT",
      parentMatchContext: parentMatchContext({
        subjectIds: ["subject-1", "subject-2"],
        parentSentiment: "negative",
        inheritAllCommentSubjectIds: ["subject-1", "subject-2"],
      }),
    })

    expect(decideSubjectRelevance([inherited, direct] as never, mention as never)).toMatchObject({
      status: "ACCEPTED",
      reason: "subject_alias_match",
      confidence: 1,
    })
  })

  it("does not match an external comment from the parent URL or page metadata", async () => {
    findMany.mockResolvedValue([subject()])
    const result = await evaluateSubjectRelevance(input("xanımın nə gözəl danışıq qabiliyyəti var 🥰", undefined, {
      contentKind: "COMMENT",
      sourceProvider: "search_index",
      parentPostUrl: "https://tiktok.com/@leaddrive/video/123",
      sourceMetadata: { pageName: "LeadDrive" },
      observation: { requireMatchedTerm: true },
      parentMatchContext: parentMatchContext(),
    }))

    expect(result).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match", matches: [] })
  })

  it("does not match a native comment from the parent video URL when its body is keyword-less", async () => {
    // Production false positive: neutral TikTok comments under an @arazsupermarket
    // video were labeled "brand alias matched · 100%" because the parent URL — not
    // the comment body — carried the brand handle. native provider + no
    // requireMatchedTerm previously skipped the direct-comment-text guard.
    findMany.mockResolvedValue([subject({
      aliases: [{
        id: "alias-handle", subjectId: "subject-1", organizationId: "org-1",
        kind: "HANDLE", value: "arazsupermarket", normalizedValue: "arazsupermarket",
        language: null, weight: 1, isNegative: false, isAmbiguous: false,
      }],
    })])
    const result = await evaluateSubjectRelevance(input("Sagol Kamiş 😄", undefined, {
      contentKind: "COMMENT",
      sourceProvider: "native",
      parentPostUrl: "https://www.tiktok.com/@arazsupermarket/video/123",
      sourceMetadata: { channelTitle: "arazsupermarket" },
    }))

    expect(result).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match", matches: [] })
  })

  it("still surfaces a native comment on an owned source as trusted, not a fake alias match", async () => {
    findMany.mockResolvedValue([subject({
      aliases: [{
        id: "alias-handle", subjectId: "subject-1", organizationId: "org-1",
        kind: "HANDLE", value: "arazsupermarket", normalizedValue: "arazsupermarket",
        language: null, weight: 1, isNegative: false, isAmbiguous: false,
      }],
      sources: [{ id: "link-1", sourceId: "source-1", relationType: "OWNED", trustWeight: 1 }],
    })])
    const result = await evaluateSubjectRelevance(input("Sagol Kamiş 😄", "source-1", {
      contentKind: "COMMENT",
      sourceProvider: "native",
      parentPostUrl: "https://www.tiktok.com/@arazsupermarket/video/123",
    }))

    expect(result).toMatchObject({ status: "ACCEPTED", reason: "trusted_subject_source" })
  })

  it("surfaces a keyword-less negative comment on the subject's own channel", async () => {
    // Owner decision 2026-07-19: a complaint under the brand's OWN channel is
    // actionable even when the comment body never repeats the brand name.
    findMany.mockResolvedValue([subject({
      aliases: [],
      sources: [{ id: "link-1", sourceId: "source-1", relationType: "OFFICIAL", trustWeight: 1 }],
    })])
    const result = await evaluateSubjectRelevance(input("ужасный сервис, обманули с заказом", "source-1", {
      contentKind: "COMMENT",
      sourceProvider: "provider_api",
    }))
    expect(result).toMatchObject({ status: "ACCEPTED", reason: "comment_negative_in_brand_context", confidence: 0.8 })
  })

  it("surfaces a keyword-less negative comment under a post matched to the subject", async () => {
    findMany.mockResolvedValue([subject()])
    const result = await evaluateSubjectRelevance(input("terrible service, I want a refund", undefined, {
      contentKind: "COMMENT",
      sourceProvider: "provider_api",
      parentMatchContext: parentMatchContext(),
    }))
    expect(result).toMatchObject({ status: "ACCEPTED", reason: "comment_negative_in_brand_context", confidence: 0.75 })
  })

  it("still drops a neutral keyword-less comment on the subject's own channel", async () => {
    // #434 must hold: no complaint / negative signal → not surfaced.
    findMany.mockResolvedValue([subject({
      aliases: [],
      sources: [{ id: "link-1", sourceId: "source-1", relationType: "OFFICIAL", trustWeight: 1 }],
    })])
    const result = await evaluateSubjectRelevance(input("спасибо большое, супер 👍", "source-1", {
      contentKind: "COMMENT",
      sourceProvider: "provider_api",
    }))
    expect(result).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match" })
  })

  it("does not surface a negative keyword-less comment outside any brand context", async () => {
    // No owned source and parent not matched to this subject → #434 keeps it out.
    findMany.mockResolvedValue([subject()])
    const result = await evaluateSubjectRelevance(input("terrible service, total scam", undefined, {
      contentKind: "COMMENT",
      sourceProvider: "provider_api",
    }))
    expect(result).toMatchObject({ status: "REJECTED", reason: "no_monitoring_subject_match" })
  })

  it("overrides the blanket external-comment requireMatchedTerm for a negative comment on the brand's own channel", async () => {
    // The YouTube data API sets requireMatchedTerm on every external comment,
    // which is what kept brand-channel complaints invisible. A complaint in
    // owned/official brand context surfaces despite that blanket flag.
    findMany.mockResolvedValue([subject({
      aliases: [],
      sources: [{ id: "link-1", sourceId: "source-1", relationType: "OFFICIAL", trustWeight: 1 }],
    })])
    const result = await evaluateSubjectRelevance(input("terrible service, scam", "source-1", {
      contentKind: "COMMENT",
      sourceProvider: "provider_api",
      observation: { sourceId: "source-1", requireMatchedTerm: true },
    }))
    expect(result).toMatchObject({ status: "ACCEPTED", reason: "comment_negative_in_brand_context" })
  })

  it("recognizes normalized official URLs and official website domains", () => {
    const monitored = subject({
      aliases: [{ ...subject().aliases[0], value: "LeadDrive", normalizedValue: "leaddrive" }],
      sources: [{ id: "link-official", sourceId: "source-official", relationType: "OFFICIAL", trustWeight: 1, source: { id: "source-official", platform: "web", sourceType: "page", handle: null, url: "https://www.leaddrive.example/about/" } }],
    })
    expect(decideSubjectRelevance([monitored] as never, input("LeadDrive news", undefined, {
      contentKind: "POST", sourceMetadata: { authorUrl: "https://leaddrive.example/team?utm_source=test" },
    }))).toMatchObject({ status: "REJECTED", reason: "official_author" })
  })

  it("recognizes an official TikTok post from its permalink when the provider returns only a display name", () => {
    const monitored = subject({
      aliases: [{ ...subject().aliases[0], value: "Araz Supermarket", normalizedValue: "araz supermarket" }],
      sources: [{ id: "link-official", sourceId: "source-official", relationType: "OFFICIAL", trustWeight: 1, source: { id: "source-official", platform: "tiktok", sourceType: "profile", handle: "arazsupermarket", url: "https://tiktok.com/@arazsupermarket" } }],
    })
    expect(decideSubjectRelevance([monitored] as never, input("Araz Supermarket endirim", undefined, {
      platform: "tiktok",
      contentKind: "VIDEO",
      sourceType: "post",
      authorName: "Araz Supermarket",
      authorHandle: "Araz Supermarket",
      url: "https://tiktok.com/@arazsupermarket/video/123",
    }))).toMatchObject({ status: "REJECTED", reason: "official_author" })
  })

  it("does not treat an external comment as official from the official parent permalink", () => {
    const monitored = subject({
      aliases: [{ ...subject().aliases[0], value: "Araz Supermarket", normalizedValue: "araz supermarket" }],
      sources: [{ id: "link-official", sourceId: "source-official", relationType: "OFFICIAL", trustWeight: 1, source: { id: "source-official", platform: "tiktok", sourceType: "profile", handle: "arazsupermarket", url: "https://tiktok.com/@arazsupermarket" } }],
    })
    expect(decideSubjectRelevance([monitored] as never, input("Araz Supermarket xidməti pisdir", "source-official", {
      platform: "tiktok",
      contentKind: "COMMENT",
      sourceType: "comment",
      sourceProvider: "provider_api",
      authorHandle: "external_customer",
      url: "https://tiktok.com/@arazsupermarket/video/123",
      parentPostUrl: "https://tiktok.com/@arazsupermarket/video/123",
    }))).toMatchObject({ status: "ACCEPTED" })
  })

  it("does not count overlapping ambiguous aliases as independent signals", () => {
    const monitored = subject({
      aliases: [
        { ...subject().aliases[0], id: "alias-bravo", value: "Bravo", normalizedValue: "bravo", isAmbiguous: true },
        { ...subject().aliases[0], id: "alias-bravo-market", value: "Bravo Market", normalizedValue: "bravo market", isAmbiguous: true },
      ],
    })
    expect(decideSubjectRelevance([monitored] as never, input("Bravo Market"))).toMatchObject({
      status: "REJECTED",
      reason: "ambiguous_alias_requires_second_signal",
    })
  })

  it("keeps a matching external comment under an official post", () => {
    const monitored = subject({
      aliases: [{ ...subject().aliases[0], value: "Bravo Supermarket", normalizedValue: "bravo supermarket" }],
      sources: [{ id: "link-official", sourceId: "source-official", relationType: "OFFICIAL", trustWeight: 1, source: { id: "source-official", handle: "bravosupermarketaz", url: "https://instagram.com/bravosupermarketaz" } }],
    })
    expect(decideSubjectRelevance([monitored] as never, input("Bravo Supermarket endirimi yaxşıdır", "source-official", {
      contentKind: "COMMENT", sourceProvider: "official_discovery", authorHandle: "external_customer", parentPostUrl: "https://instagram.com/p/official-post",
    }))).toMatchObject({ status: "ACCEPTED" })
  })

  it("does not classify an external repost as an official post", () => {
    const monitored = subject({
      aliases: [{ ...subject().aliases[0], value: "Bravo Supermarket", normalizedValue: "bravo supermarket" }],
      sources: [{ id: "link-official", sourceId: "source-official", relationType: "OFFICIAL", trustWeight: 1, source: { id: "source-official", handle: "bravosupermarketaz", url: "https://tiktok.com/@bravosupermarketaz" } }],
    })
    expect(decideSubjectRelevance([monitored] as never, input("Bravo Supermarket endirim", undefined, {
      contentKind: "POST", authorHandle: "external_duet_author", parentPostUrl: "https://tiktok.com/@bravosupermarketaz/video/1",
    }))).toMatchObject({ status: "ACCEPTED" })
  })

  it("upserts matched and official-archive subject links with matcher version", async () => {
    await persistSubjectMatches("org-1", "mention-1", [
      {
        subjectId: "subject-1",
        status: "MATCHED",
        reason: "subject_alias_match",
        confidence: 0.95,
        matchedAliasIds: ["alias-1"],
        matchedTerms: ["LeadDrive"],
        contextSignals: { sourceId: "source-1" },
      },
      {
        subjectId: "subject-official",
        status: "REJECTED",
        reason: "official_author",
        confidence: 1,
        matchedAliasIds: [],
        matchedTerms: [],
        contextSignals: { officialAuthor: true },
      },
      {
        subjectId: "subject-2",
        status: "REVIEW",
        reason: "ambiguous",
        confidence: 0.4,
        matchedAliasIds: [],
        matchedTerms: [],
        contextSignals: {},
      },
    ])

    expect(subjectMatchUpsert).not.toHaveBeenCalled()
    expect(subjectMatchCreate).toHaveBeenCalledTimes(2)
    expect(subjectMatchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ matcherVersion: SUBJECT_MATCHER_VERSION, subjectId: "subject-1", status: "MATCHED" }),
    })
    expect(subjectMatchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ matcherVersion: SUBJECT_MATCHER_VERSION, subjectId: "subject-official", status: "REJECTED", reason: "official_author" }),
    })
    expect(subjectMatchUpdateMany).toHaveBeenCalledTimes(3)
    expect(subjectMatchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        mentionId: "mention-1",
        subjectId: "subject-2",
        reason: { not: "operator_review_accept" },
      },
      data: expect.objectContaining({ matcherVersion: SUBJECT_MATCHER_VERSION, status: "REVIEW", reason: "ambiguous" }),
    }))
  })

  it("downgrades an existing client-visible match without creating a new rejected row", async () => {
    subjectMatchUpdateMany.mockResolvedValue({ count: 1 })

    await persistSubjectMatches("org-1", "mention-foreign", [{
      subjectId: "subject-1",
      status: "REJECTED",
      reason: "required_context_missing",
      confidence: 0.75,
      matchedAliasIds: ["alias-1"],
      matchedTerms: ["Oba Market"],
      contextSignals: { requiredContextMatches: [] },
    }])

    expect(subjectMatchUpsert).not.toHaveBeenCalled()
    expect(subjectMatchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        mentionId: "mention-foreign",
        subjectId: "subject-1",
        reason: { not: "operator_review_accept" },
      },
      data: expect.objectContaining({
        status: "REJECTED",
        reason: "required_context_missing",
        matcherVersion: SUBJECT_MATCHER_VERSION,
      }),
    }))
  })

  it("keeps a manual operator match authoritative during later automatic reevaluation", async () => {
    subjectMatchUpdateMany.mockResolvedValue({ count: 0 })
    subjectMatchCreate.mockRejectedValue(Object.assign(new Error("unique row"), { code: "P2002" }))

    await persistSubjectMatches("org-1", "mention-manual", [{
      subjectId: "subject-1",
      status: "REJECTED",
      reason: "required_context_missing",
      confidence: 0.75,
      matchedAliasIds: [],
      matchedTerms: [],
      contextSignals: {},
    }])

    expect(subjectMatchUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reason: { not: "operator_review_accept" } }),
    }))
    expect(subjectMatchUpsert).not.toHaveBeenCalled()
  })
  // География объекта («Azərbaycan») — второй подтверждающий сигнал против
  // зарубежных тёзок: «Grandmart» и «Bravo Supermarket» встречаются в Камбодже,
  // Испании и США, и письменностью их не отличить.
  describe("география как второй сигнал", () => {
    const ambiguousBrand = (overrides: Record<string, unknown> = {}) => subject({
      name: "Grandmart",
      geographies: ["Azərbaycan"],
      aliases: [{
        id: "alias-grandmart",
        subjectId: "subject-1",
        organizationId: "org-1",
        kind: "NAME",
        value: "Grandmart",
        normalizedValue: "grandmart",
        language: null,
        weight: 1,
        isNegative: false,
        isAmbiguous: true,
      }],
      ...overrides,
    })

    it("подтверждает неоднозначный алиас, когда география названа", async () => {
      findMany.mockResolvedValue([ambiguousBrand()])
      await expect(
        evaluateSubjectRelevance(input("Grandmart Azərbaycan üzrə yeni mağaza açır")),
      ).resolves.toMatchObject({ status: "ACCEPTED" })
    })

    it("не подтверждает, когда географии в тексте нет", async () => {
      findMany.mockResolvedValue([ambiguousBrand()])
      // Тот самый индонезийский тёзка: имя совпало, страны нет.
      await expect(
        evaluateSubjectRelevance(input("Lomba mewarnai di Grandmart Bojonegoro")),
      ).resolves.toMatchObject({
        status: "REJECTED",
        reason: "ambiguous_alias_requires_second_signal",
      })
    })

    it("пустой список географий ничего не меняет", async () => {
      findMany.mockResolvedValue([ambiguousBrand({ geographies: [] })])
      // Бренд без заданной географии ведёт себя как раньше — гейт не включается
      // сам по себе и ничего не теряет.
      await expect(
        evaluateSubjectRelevance(input("Grandmart Azərbaycan üzrə yeni mağaza açır")),
      ).resolves.toMatchObject({
        status: "REJECTED",
        reason: "ambiguous_alias_requires_second_signal",
      })
    })

    // Ключевое ограничение: география НЕ подменяет явно заданный обязательный
    // контекст, он строже по замыслу оператора.
    it("не обходит обязательный контекст", async () => {
      findMany.mockResolvedValue([ambiguousBrand({ requiredContext: ["endirim"] })])
      await expect(
        evaluateSubjectRelevance(input("Grandmart Azərbaycan üzrə yeni mağaza açır")),
      ).resolves.toMatchObject({
        status: "REJECTED",
        reason: "required_context_missing",
      })
      await expect(
        evaluateSubjectRelevance(input("Grandmart Azərbaycan endirim elan etdi")),
      ).resolves.toMatchObject({ status: "ACCEPTED" })
    })

    it("не ломает провенанс Google Alerts RSS", async () => {
      // Точный неоднозначный алиас из проверенной RSS-ленты принимался и до
      // правки — география не должна была на это повлиять.
      findMany.mockResolvedValue([ambiguousBrand({ geographies: ["Azərbaycan"] })])
      const decision = await evaluateSubjectRelevance(
        input("Lomba mewarnai di Grandmart Bojonegoro"),
      )
      expect(decision).toMatchObject({ status: "REJECTED" })
      expect(decision?.reason).not.toBe("required_context_missing")
    })
  })

  // Языки объекта задаёт оператор. Несовпадение ПОМЕЧАЕТСЯ, но не отклоняет:
  // язык — не признак релевантности, и метка слишком шаткая для необратимого
  // решения (см. subject-relevance.ts). Отбор по языку живёт на показе.
  describe("языки объекта", () => {
    const azOnly = (overrides: Record<string, unknown> = {}) => subject({
      languages: ["az"],
      ...overrides,
    })
    const withLanguage = (language: string | null) => ({
      sourceMetadata: language ? { socialTriage: { language } } : {},
    })

    it("пропускает находку на заявленном языке и не поднимает флаг", async () => {
      findMany.mockResolvedValue([azOnly()])
      const decision = await evaluateSubjectRelevance(
        input("LeadDrive çox yaxşı xidmət göstərir", undefined, withLanguage("az")),
      )
      expect(decision).toMatchObject({ status: "ACCEPTED" })
      expect(decision?.matches[0]?.contextSignals).toMatchObject({ languageMismatch: false })
    })

    // Ключевое отличие от прежнего поведения: находка на чужом языке остаётся
    // релевантной, если совпали алиасы. Язык лишь помечается, чтобы по нему
    // можно было отфильтровать показ — обратимо и заметно, в отличие от
    // отклонения, после которого возврат требует полного пересчёта.
    it("НЕ отклоняет находку на чужом языке, а помечает её", async () => {
      findMany.mockResolvedValue([azOnly()])
      const decision = await evaluateSubjectRelevance(
        input("LeadDrive tiene una oferta especial", undefined, withLanguage("es")),
      )
      expect(decision).toMatchObject({ status: "ACCEPTED" })
      expect(decision?.reason).not.toBe("subject_language_mismatch")
      expect(decision?.matches[0]?.contextSignals).toMatchObject({ languageMismatch: true })
    })

    // Неизвестный язык флага не поднимает: «не знаю» — не то же самое, что
    // «не тот». На проде метки нет у 18.6% находок.
    it("не поднимает флаг, когда язык не определён", async () => {
      findMany.mockResolvedValue([azOnly()])
      const decision = await evaluateSubjectRelevance(
        input("LeadDrive 👍", undefined, withLanguage(null)),
      )
      expect(decision).toMatchObject({ status: "ACCEPTED" })
      expect(decision?.matches[0]?.contextSignals).toMatchObject({ languageMismatch: false })
    })

    it("пустой список языков ничего не меняет", async () => {
      findMany.mockResolvedValue([azOnly({ languages: [] })])
      await expect(evaluateSubjectRelevance(
        input("LeadDrive tiene una oferta especial", undefined, withLanguage("es")),
      )).resolves.toMatchObject({ status: "ACCEPTED" })
    })

    it("не путает регистр в списке языков", async () => {
      findMany.mockResolvedValue([azOnly({ languages: ["AZ", "RU"] })])
      await expect(evaluateSubjectRelevance(
        input("LeadDrive отличный сервис", undefined, withLanguage("ru")),
      )).resolves.toMatchObject({ status: "ACCEPTED" })
    })

    // Родовое имя вроде «Oba Market» есть и в Баку, и в Бенин-Сити, поэтому его
    // помечают неоднозначным — и тогда нужен второй сигнал. У короткой местной
    // жалобы нет ни географии в тексте, ни контекстного алиаса, ни собственного
    // источника; единственное, что отличает её от нигерийского тёзки, — язык.
    describe("язык как второй сигнал для неоднозначного алиаса", () => {
      const ambiguous = (overrides: Record<string, unknown> = {}) => subject({
        languages: ["az"],
        aliases: [{ ...subject().aliases[0], isAmbiguous: true }],
        ...overrides,
      })

      it("совпадение языка удерживает находку", async () => {
        findMany.mockResolvedValue([ambiguous()])
        const decision = await evaluateSubjectRelevance(
          input("LeadDrive çox mənasızdır", undefined, withLanguage("az")),
        )
        expect(decision).toMatchObject({ status: "ACCEPTED" })
        expect(decision?.matches[0]?.contextSignals).toMatchObject({ languageMatchesSubject: true })
      })

      it("чужой язык второго сигнала не даёт", async () => {
        findMany.mockResolvedValue([ambiguous()])
        await expect(evaluateSubjectRelevance(
          input("LeadDrive is the best store in Lagos", undefined, withLanguage("en")),
        )).resolves.toMatchObject({
          status: "REJECTED",
          reason: "ambiguous_alias_requires_second_signal",
        })
      })

      // Судья релевантности (#646) вторым сигналом НЕ считается: на проде это
      // вернуло в ленту чужих тёзок — «Bravo on 41» из США, «Oba market Benin
      // city» из Нигерии. Тест закрепляет откат, чтобы признак не вернули без
      // географии в промпте и без замера на выборке с тёзками.
      it("приговор судьи вторым сигналом не считается", async () => {
        findMany.mockResolvedValue([ambiguous()])
        const decision = await evaluateSubjectRelevance({
          ...input("Back To School Sale at your LeadDrive on 41", undefined, withLanguage("en")),
          aiRelevanceJudge: {
            version: "ai_relevance_judge_v2",
            verdicts: { "subject-1": "about_subject" },
          },
        })
        expect(decision).toMatchObject({
          status: "REJECTED",
          reason: "ambiguous_alias_requires_second_signal",
        })
        expect(decision?.matches[0]?.contextSignals).not.toHaveProperty("aiJudgeVerdict")
      })

      // Ключевая асимметрия: отсутствие метки ничего не подтверждает. Иначе
      // безметочные находки получали бы второй сигнал даром — а их 18.6%.
      it("отсутствие метки вторым сигналом НЕ считается", async () => {
        findMany.mockResolvedValue([ambiguous()])
        await expect(evaluateSubjectRelevance(
          input("LeadDrive 👍", undefined, withLanguage(null)),
        )).resolves.toMatchObject({
          status: "REJECTED",
          reason: "ambiguous_alias_requires_second_signal",
        })
      })

      it("без заданных языков объекта ничего не меняется", async () => {
        findMany.mockResolvedValue([ambiguous({ languages: [] })])
        await expect(evaluateSubjectRelevance(
          input("LeadDrive çox mənasızdır", undefined, withLanguage("az")),
        )).resolves.toMatchObject({
          status: "REJECTED",
          reason: "ambiguous_alias_requires_second_signal",
        })
      })
    })
  })
})
