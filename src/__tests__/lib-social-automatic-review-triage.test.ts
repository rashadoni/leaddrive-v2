import { describe, expect, it, vi } from "vitest"
import {
  AUTOMATIC_REVIEW_AI_VERSION,
  AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON,
  AUTOMATIC_REVIEW_COMMENT_SUBJECT_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_DISCOVERY_IDENTITY_REJECTION_REASON,
  AUTOMATIC_REVIEW_DISCOVERY_MISSING_DATE_REJECTION_REASON,
  AUTOMATIC_REVIEW_DISCOVERY_RECOVERY_FALLBACK_REJECTION_REASON,
  AUTOMATIC_REVIEW_RULES_VERSION,
  AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
  AUTOMATIC_REVIEW_TRIAGE_VERSION,
  AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
  classifyAutomaticReviewText,
  recoverableAutomaticReviewV3DiscoveryOriginalReason,
  resolveAutomaticReviewTriage,
} from "@/lib/social/automatic-review-triage"

type AutomaticReviewInput = Parameters<typeof resolveAutomaticReviewTriage>[0]
type AutomaticReviewSubjectDecision = NonNullable<AutomaticReviewInput["subjectDecision"]>

const providerWindow = {
  since: "2026-07-01T00:00:00.000Z",
  until: "2026-08-01T23:59:59.000Z",
}

function reviewDecision(reason = "discovery_missing_published_at") {
  return {
    status: "REVIEW" as const,
    reason,
    confidence: 0.4,
    matchedTerms: ["Araz"],
  }
}

function acceptedSubject(
  overrides: Partial<AutomaticReviewSubjectDecision> = {},
): AutomaticReviewSubjectDecision {
  return {
    status: "ACCEPTED" as const,
    reason: "subject_alias_match",
    confidence: 0.9,
    matchedTerms: ["Araz"],
    matches: [{
      subjectId: "subject-araz",
      status: "MATCHED" as const,
      confidence: 0.9,
      matchedTerms: ["Araz"],
      contextSignals: {},
    }],
    ...overrides,
  }
}

function resolve(overrides: Partial<AutomaticReviewInput> = {}) {
  return resolveAutomaticReviewTriage({
    decision: reviewDecision(),
    subjectDecision: acceptedSubject(),
    text: "Araz mağazası bu gün saat 22:00-dək açıqdır",
    sentiment: null,
    url: "https://www.facebook.com/groups/123/posts/456/",
    canonicalUrl: null,
    parentPostUrl: null,
    publishedAt: null,
    rawPayload: {
      title: "Araz supermarket haqqında paylaşım",
      createdAt: "2026-07-31T12:00:00.000Z",
    },
    policySnapshot: { leadDriveProviderWindow: providerWindow },
    ...overrides,
  })
}

describe("automatic REVIEW triage", () => {
  it("admits a relevant Azerbaijani complaint as negative", () => {
    expect(resolve({
      text: "Araz qədər məsuliyyətsiz ikinci mağaza da olmadı",
    })).toMatchObject({
      resolved: true,
      sentiment: "negative",
      originalReason: "discovery_missing_published_at",
      decision: {
        status: "ACCEPTED",
        reason: "automatic_review_negative",
      },
    })
  })

  it("admits relevant neutral content and keeps it separate from negative", () => {
    expect(resolve({
      sentiment: "neutral",
      sentimentClassification: {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      },
    })).toMatchObject({
      resolved: true,
      classification: "neutral",
      sentiment: "neutral",
      classifierSource: "AI",
      classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
      decision: {
        status: "ACCEPTED",
        reason: "automatic_review_neutral",
      },
    })
  })

  it("rejects relevant positive content instead of placing it in the main feed", () => {
    expect(resolve({
      text: "Araz mağazasında əla xidmət, təşəkkür edirəm",
    })).toMatchObject({
      resolved: true,
      sentiment: "positive",
      decision: {
        status: "REJECTED",
        reason: "automatic_review_positive",
      },
    })
  })

  it("lets complaint evidence win over incidental praise", () => {
    expect(resolve({
      text: "Mağaza yaxşıdır, amma məhsulun vaxtı keçmişdi və pulumu qaytarın",
    })).toMatchObject({
      resolved: true,
      sentiment: "negative",
      decision: { status: "ACCEPTED", reason: "automatic_review_negative" },
    })
  })

  it("lets explicit complaint evidence override a stale positive provider label", () => {
    expect(resolve({
      text: "Mağaza yaxşıdır, amma məhsulun vaxtı keçmişdi və pulumu qaytarın",
      sentiment: "positive",
    })).toMatchObject({
      resolved: true,
      sentiment: "negative",
      decision: { status: "ACCEPTED", reason: "automatic_review_negative" },
    })
  })

  it("honors an explicitly classified frozen sentiment decision", () => {
    expect(resolve({
      text: "Araz mağazası haqqında paylaşım",
      sentiment: "positive",
      sentimentClassification: {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      },
    })).toMatchObject({
      resolved: true,
      sentiment: "positive",
      classifierSource: "AI",
      decision: { status: "REJECTED", reason: "automatic_review_positive" },
    })
  })

  it("accepts a frozen AI-negative decision without reclassifying it as neutral", () => {
    expect(resolve({
      text: "Rəflər yenə boşdur",
      sentiment: "negative",
      sentimentClassification: {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      },
    })).toMatchObject({
      resolved: true,
      classification: "negative",
      sentiment: "negative",
      classifierSource: "AI",
      classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
      decision: { status: "ACCEPTED", reason: "automatic_review_negative" },
    })
  })

  it("does not invent neutral sentiment for ordinary semantic text", () => {
    expect(resolve()).toMatchObject({
      resolved: false,
      classification: "unknown",
      sentiment: "unknown",
      classifierEvidence: "semantic_text_requires_ai",
      decision: { status: "REVIEW" },
    })
  })

  it("classifies non-semantic noise separately from unknown semantic text", () => {
    expect(classifyAutomaticReviewText("🙄", null)).toMatchObject({
      classification: "unknown",
      sentiment: "unknown",
      classifierSource: "RULES",
      classifierEvidence: "ambiguous_emoji_requires_ai",
    })
    expect(classifyAutomaticReviewText("Yeni mağaza bu gün açılır", null)).toMatchObject({
      classification: "unknown",
      sentiment: "unknown",
      classifierEvidence: "semantic_text_requires_ai",
    })
  })

  it.each(["positive", "neutral", "negative"] as const)(
    "honors a versioned AI %s result for an ambiguous emoji",
    sentiment => {
      expect(classifyAutomaticReviewText("🙄", sentiment, {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      })).toMatchObject({
        classification: sentiment,
        sentiment,
        classifierSource: "AI",
        classifierVersion: AUTOMATIC_REVIEW_AI_VERSION,
        classifierEvidence: "ai_classification",
      })
    },
  )

  it("keeps strong emoji rules above a conflicting frozen AI result", () => {
    expect(classifyAutomaticReviewText("😡", "positive", {
      source: "AI",
      version: AUTOMATIC_REVIEW_AI_VERSION,
    })).toMatchObject({
      classification: "negative",
      classifierSource: "RULES",
      classifierEvidence: "negative_emoji",
    })
    expect(classifyAutomaticReviewText("👍", "negative", {
      source: "AI",
      version: AUTOMATIC_REVIEW_AI_VERSION,
    })).toMatchObject({
      classification: "positive",
      classifierSource: "RULES",
      classifierEvidence: "positive_emoji",
    })
  })

  it("does not trust provider or unversioned AI sentiment for an ambiguous emoji", () => {
    expect(classifyAutomaticReviewText("🙄", "positive", {
      source: "PROVIDED",
      version: "provider_sentiment_v1",
    })).toMatchObject({
      classification: "unknown",
      classifierEvidence: "ambiguous_emoji_requires_ai",
    })
    expect(classifyAutomaticReviewText("🙄", "positive", {
      source: "AI",
    })).toMatchObject({
      classification: "unknown",
      classifierEvidence: "ambiguous_emoji_requires_ai",
    })
  })

  it("keeps punctuation and mention-only noise irrelevant despite a frozen AI result", () => {
    expect(classifyAutomaticReviewText("...", "negative", {
      source: "AI",
      version: AUTOMATIC_REVIEW_AI_VERSION,
    })).toMatchObject({
      classification: "irrelevant",
      classifierEvidence: "non_semantic_noise",
    })
    expect(classifyAutomaticReviewText("Acme", "negative", {
      source: "AI",
      version: AUTOMATIC_REVIEW_AI_VERSION,
    }, ["Acme"])).toMatchObject({
      classification: "irrelevant",
      classifierEvidence: "mention_only",
    })
  })

  it("does not match positive fragments inside ordinary RU/AZ brand words", () => {
    expect(classifyAutomaticReviewText("Супермаркет закрывается в 22:00", null)).toMatchObject({
      classification: "unknown",
      classifierEvidence: "semantic_text_requires_ai",
    })
    expect(classifyAutomaticReviewText("Supermarket saat 22:00-da bağlanır", null)).toMatchObject({
      classification: "unknown",
      classifierEvidence: "semantic_text_requires_ai",
    })
    expect(classifyAutomaticReviewText("Əlavə məlumat sabah veriləcək", null)).toMatchObject({
      classification: "unknown",
      classifierEvidence: "semantic_text_requires_ai",
    })
  })

  it("does not treat a plea emoji inside semantic text as positive", () => {
    expect(classifyAutomaticReviewText("Пожалуйста, помогите 🙏", null)).toMatchObject({
      classification: "unknown",
      classifierEvidence: "semantic_text_requires_ai",
    })
    expect(classifyAutomaticReviewText("👍", null)).toMatchObject({
      classification: "positive",
      classifierEvidence: "positive_emoji",
    })
  })

  it("rejects a handle mention with no substantive content", () => {
    expect(resolve({ text: "@Araz" })).toMatchObject({
      resolved: true,
      classification: "irrelevant",
      sentiment: "unknown",
      decision: { status: "REJECTED", reason: "automatic_review_irrelevant" },
    })
    expect(classifyAutomaticReviewText("@super", null)).toMatchObject({
      classification: "irrelevant",
      classifierEvidence: "non_semantic_noise",
    })
  })

  it.each([
    "thread_context_for_actionable_descendant",
    "discovery_tiktok_video_without_caption",
    "mention_persistence_failed",
    "future_review_reason",
  ])("keeps technical or unsupported reason %s in REVIEW", reason => {
    expect(resolve({ decision: reviewDecision(reason) })).toMatchObject({
      resolved: false,
      sentiment: "unknown",
      decision: { status: "REVIEW", reason },
    })
  })

  it("terminally rejects discovery with unknown freshness evidence", () => {
    expect(resolve({
      publishedAt: null,
      rawPayload: { title: "Araz supermarket haqqında paylaşım" },
    })).toMatchObject({
      resolved: true,
      sentiment: "unknown",
      decision: {
        status: "REJECTED",
        reason: AUTOMATIC_REVIEW_DISCOVERY_MISSING_DATE_REJECTION_REASON,
      },
    })
  })

  it("terminally rejects snippet discovery without independent subject identity", () => {
    expect(resolve({
      publishedAt: new Date("2026-07-31T12:00:00.000Z"),
      rawPayload: {
        title: "Major summer discounts announced",
        snippet: "Araz appears only in the search-engine snippet",
      },
      url: "https://independent.example/posts/major-summer-discounts",
    })).toMatchObject({
      resolved: true,
      sentiment: "unknown",
      decision: {
        status: "REJECTED",
        reason: AUTOMATIC_REVIEW_DISCOVERY_IDENTITY_REJECTION_REASON,
      },
    })
  })

  it("keeps missing frozen provider windows in REVIEW", () => {
    expect(resolve({ policySnapshot: {} })).toMatchObject({
      resolved: false,
      sentiment: "unknown",
      decision: { status: "REVIEW" },
    })
  })

  it("keeps ambiguous and multi-subject matches in REVIEW", () => {
    expect(resolve({
      subjectDecision: acceptedSubject({ status: "REVIEW" }),
    })).toMatchObject({ resolved: false, decision: { status: "REVIEW" } })

    expect(resolve({
      subjectDecision: acceptedSubject({
        matches: [
          acceptedSubject().matches[0],
          {
            subjectId: "subject-other",
            status: "MATCHED",
            confidence: 0.9,
            matchedTerms: ["Araz"],
            contextSignals: {},
          },
        ],
      }),
    })).toMatchObject({ resolved: false, decision: { status: "REVIEW" } })
  })

  it("rejects an independently irrelevant subject", () => {
    expect(resolve({
      subjectDecision: {
        status: "REJECTED",
        reason: "no_monitoring_subject_match",
        confidence: 1,
        matchedTerms: [],
        matches: [],
      },
    })).toMatchObject({
      resolved: true,
      sentiment: "unknown",
      decision: { status: "REJECTED", reason: "automatic_review_irrelevant_subject" },
    })
  })

  it("rejects profile, directory, and official-domain URLs before sentiment admission", () => {
    expect(resolve({
      url: "https://facebook.com/arazsupermarket",
    })).toMatchObject({
      resolved: true,
      decision: { status: "REJECTED", reason: "discovery_auto_review_profile_or_channel" },
    })
    expect(resolve({
      url: "https://facebook.com/search/posts?q=araz",
    })).toMatchObject({
      resolved: true,
      decision: { status: "REJECTED", reason: "discovery_auto_review_evergreen_directory" },
    })
    expect(resolve({
      url: "https://news.araz.az/posts/store-hours",
      subjectDecision: acceptedSubject({
        matches: [{
          ...acceptedSubject().matches[0],
          contextSignals: { officialHosts: ["araz.az"] },
        }],
      }),
    })).toMatchObject({
      resolved: true,
      decision: { status: "REJECTED", reason: "discovery_auto_review_official_domain" },
    })
  })

  it("does not perform a provider fetch while resolving stored evidence", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    resolve({ text: "Araz mağazası bu gün saat 22:00-dək açıqdır" })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each([
    ["AI", AUTOMATIC_REVIEW_AI_VERSION],
    ["RULES", AUTOMATIC_REVIEW_RULES_VERSION],
  ] as const)("recognizes only exact v3 discovery recovery provenance from %s", (
    classifierSource,
    classifierVersion,
  ) => {
    const policySnapshot = {
      automaticReviewTriage: {
        version: AUTOMATIC_REVIEW_TRIAGE_VERSION,
        resolved: false,
        originalReason: "discovery_snippet_only_match",
        decisionStatus: "REVIEW",
        decisionReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
        classification: "unknown",
        sentiment: "unknown",
        classifierSource,
        classifierVersion,
        classifierEvidence: "technical_evidence_unresolved",
        providerFetchPerformed: false,
        attemptedAt: "2026-08-02T08:30:00.000Z",
      },
      replayResolution: {
        version: "stored-envelope-replay-v1",
        action: "automatic_review_unresolved",
        originalRelevance: {
          status: "REVIEW",
          reason: "discovery_snippet_only_match",
        },
        providerFetchPerformed: false,
      },
    }

    expect(recoverableAutomaticReviewV3DiscoveryOriginalReason({
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "VIDEO",
      policySnapshot,
    })).toBe("discovery_snippet_only_match")
    expect(recoverableAutomaticReviewV3DiscoveryOriginalReason({
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "COMMENT",
      policySnapshot,
    })).toBeNull()
    expect(recoverableAutomaticReviewV3DiscoveryOriginalReason({
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "video",
      policySnapshot,
    })).toBeNull()
    expect(recoverableAutomaticReviewV3DiscoveryOriginalReason({
      relevanceReason: AUTOMATIC_REVIEW_TECHNICAL_UNRESOLVED_REASON,
      contentKind: "VIDEO",
      policySnapshot: {
        ...policySnapshot,
        replayResolution: {
          ...policySnapshot.replayResolution,
          originalRelevance: {
            status: "REVIEW",
            reason: "discovery_missing_published_at",
          },
        },
      },
    })).toBeNull()
  })

  it("never releases a v3 technical recovery back into normal ingestion", () => {
    expect(resolve({
      sentiment: "negative",
      sentimentClassification: {
        source: "AI",
        version: AUTOMATIC_REVIEW_AI_VERSION,
      },
      policySnapshot: {
        leadDriveProviderWindow: providerWindow,
        automaticTriageRecovery: AUTOMATIC_REVIEW_V3_DISCOVERY_RECOVERY,
      },
    })).toMatchObject({
      resolved: true,
      decision: {
        status: "REJECTED",
        reason: AUTOMATIC_REVIEW_DISCOVERY_RECOVERY_FALLBACK_REJECTION_REASON,
      },
    })
  })

  describe("comments inherited from a negative parent", () => {
    it.each([
      ["positive", "Araz mağazasında əla xidmət, təşəkkür edirəm", "REJECTED", "automatic_review_positive_parent_comment"],
      ["negative", "Araz mağazasında məhsulun vaxtı keçmişdi", "ACCEPTED", "negative_parent_post_inheritance"],
      ["neutral", "Bu mağaza saat 22:00-də bağlanır", "ACCEPTED", "negative_parent_post_inheritance"],
    ] as const)("keeps %s content out of or in the feed according to policy", (
      sentiment,
      text,
      expectedStatus,
      expectedReason,
    ) => {
      expect(resolve({
        decision: {
          status: "ACCEPTED",
          reason: "negative_parent_post_inheritance",
          confidence: 1,
          matchedTerms: ["Araz"],
        },
        text,
        sentiment,
        ...(sentiment === "neutral" ? {
          sentimentClassification: {
            source: "AI" as const,
            version: AUTOMATIC_REVIEW_AI_VERSION,
          },
        } : {}),
        policySnapshot: {},
      })).toMatchObject({
        resolved: true,
        sentiment,
        decision: { status: expectedStatus, reason: expectedReason },
      })
    })

    it("keeps ambiguous emoji-only inherited content for AI instead of deleting it", () => {
      expect(resolve({
        decision: {
          status: "ACCEPTED",
          reason: "negative_parent_post_inheritance",
          confidence: 1,
          matchedTerms: ["Araz"],
        },
        text: "🙄",
        sentiment: null,
        policySnapshot: {},
      })).toMatchObject({
        resolved: false,
        classification: "unknown",
        sentiment: "unknown",
        decision: {
          status: "REVIEW",
          reason: "negative_parent_post_inheritance",
        },
      })
    })

    it("keeps undecidable inherited semantic text in REVIEW until AI classifies it", () => {
      expect(resolve({
        decision: {
          status: "ACCEPTED",
          reason: "negative_parent_post_inheritance",
          confidence: 1,
          matchedTerms: ["Araz"],
        },
        contentKind: "REPLY",
        text: "Mağaza saat 22:00-də bağlanır",
        sentiment: null,
        policySnapshot: {},
      })).toMatchObject({
        resolved: false,
        classification: "unknown",
        sentiment: "unknown",
        classifierEvidence: "semantic_text_requires_ai",
        decision: {
          status: "REVIEW",
          reason: "negative_parent_post_inheritance",
        },
      })
    })

    it.each([
      ["positive", "Əla xidmətdir, təşəkkür edirəm", "REJECTED", "automatic_review_positive_parent_comment"],
      ["negative", "Məhsulun vaxtı keçmişdi", "ACCEPTED", "automatic_review_parent_context_negative"],
      ["neutral", "Mağaza saat 22:00-də bağlanır", "ACCEPTED", "automatic_review_parent_context_neutral"],
    ] as const)("resolves a stored parent-context %s row for exactly one tenant subject", (
      sentiment,
      text,
      expectedStatus,
      expectedReason,
    ) => {
      expect(resolve({
        decision: reviewDecision("comment_on_verified_brand_parent"),
        subjectDecision: null,
        parentMatchContext: {
          parentMentionId: "parent-mention-1",
          subjectIds: ["subject-araz"],
        },
        text,
        sentiment,
        ...(sentiment === "neutral" ? {
          sentimentClassification: {
            source: "AI" as const,
            version: AUTOMATIC_REVIEW_AI_VERSION,
          },
        } : {}),
        policySnapshot: {},
      })).toMatchObject({
        resolved: true,
        sentiment,
        parentSubjectId: "subject-araz",
        decision: { status: expectedStatus, reason: expectedReason },
      })
    })

    it("fails closed when parent provenance is missing or spans multiple subjects", () => {
      const decision = reviewDecision("comment_on_verified_brand_parent")
      expect(resolve({
        decision,
        subjectDecision: null,
        parentMatchContext: null,
      })).toMatchObject({ resolved: false, decision: { status: "REVIEW" } })

      expect(resolve({
        decision,
        subjectDecision: null,
        parentMatchContext: {
          parentMentionId: "parent-mention-1",
          subjectIds: ["subject-araz", "subject-other"],
        },
      })).toMatchObject({ resolved: false, decision: { status: "REVIEW" } })
    })
  })

  describe("all comments", () => {
    const acceptedCommentDecision = {
      status: "ACCEPTED" as const,
      reason: "subject_alias_match",
      confidence: 0.9,
      matchedTerms: ["Araz"],
    }

    it("rejects direct positive comments regardless of collector reason", () => {
      expect(resolve({
        decision: acceptedCommentDecision,
        contentKind: "COMMENT",
        text: "Əla xidmətdir, təşəkkür edirəm",
        policySnapshot: {},
      })).toMatchObject({
        resolved: true,
        classification: "positive",
        decision: { status: "REJECTED", reason: "automatic_review_positive_comment" },
      })
    })

    it("queues unknown direct comments for bounded AI", () => {
      expect(resolve({
        decision: { ...acceptedCommentDecision, reason: "reply_to_actionable_comment" },
        contentKind: "REPLY",
        text: "Mağaza saat 22:00-də bağlanır",
        sentiment: null,
        policySnapshot: {},
      })).toMatchObject({
        resolved: false,
        classification: "unknown",
        decision: { status: "REVIEW", reason: AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON },
      })
    })

    it.each(["negative", "neutral"] as const)(
      "accepts an AI-classified direct %s comment",
      sentiment => {
        expect(resolve({
          decision: acceptedCommentDecision,
          contentKind: "COMMENT",
          text: "Mağaza haqqında müştəri rəyi",
          sentiment,
          sentimentClassification: {
            source: "AI",
            version: AUTOMATIC_REVIEW_AI_VERSION,
          },
          policySnapshot: {},
        })).toMatchObject({
          resolved: true,
          classification: sentiment,
          decision: { status: "ACCEPTED", reason: "subject_alias_match" },
        })
      },
    )

    it.each([
      ["positive", "REJECTED", "automatic_review_positive_comment"],
      ["negative", "ACCEPTED", "automatic_review_comment_negative"],
      ["neutral", "ACCEPTED", "automatic_review_comment_neutral"],
    ] as const)("resolves queued AI %s sentiment centrally", (sentiment, status, reason) => {
      expect(resolve({
        decision: reviewDecision(AUTOMATIC_REVIEW_COMMENT_SENTIMENT_REASON),
        contentKind: "COMMENT",
        text: "Mağaza haqqında müştəri rəyi",
        sentiment,
        sentimentClassification: {
          source: "AI",
          version: AUTOMATIC_REVIEW_AI_VERSION,
        },
        policySnapshot: {},
      })).toMatchObject({
        resolved: true,
        classification: sentiment,
        decision: { status, reason },
      })
    })

    it.each([
      ["positive", "REJECTED", "automatic_review_positive_comment"],
      ["negative", "ACCEPTED", "automatic_review_comment_negative"],
      ["neutral", "ACCEPTED", "automatic_review_comment_neutral"],
    ] as const)("automatically resolves arbitrary REVIEW comment %s sentiment", (
      sentiment,
      status,
      reason,
    ) => {
      expect(resolve({
        decision: reviewDecision("manual_review_required"),
        contentKind: "COMMENT",
        text: sentiment === "positive"
          ? "Əla xidmətdir, təşəkkür edirəm"
          : sentiment === "negative"
            ? "Məhsulun vaxtı keçmişdi"
            : "Mağaza haqqında müştəri rəyi",
        sentiment,
        sentimentClassification: {
          source: "AI",
          version: AUTOMATIC_REVIEW_AI_VERSION,
        },
        policySnapshot: {},
      })).toMatchObject({
        resolved: true,
        classification: sentiment,
        decision: { status, reason },
      })
    })

    it("terminally rejects an arbitrary comment whose subject cannot be resolved", () => {
      expect(resolve({
        decision: reviewDecision("subject_ambiguous"),
        subjectDecision: {
          ...acceptedSubject(),
          status: "REVIEW",
          reason: "subject_ambiguous",
        },
        contentKind: "REPLY",
        text: "Məhsulun vaxtı keçmişdi",
        policySnapshot: {},
      })).toMatchObject({
        resolved: true,
        decision: {
          status: "REJECTED",
          reason: AUTOMATIC_REVIEW_COMMENT_SUBJECT_UNRESOLVED_REASON,
        },
      })
    })

    it("does not apply the comment-only rule to a publication", () => {
      expect(resolve({
        decision: acceptedCommentDecision,
        contentKind: "POST",
        text: "Əla xidmətdir, təşəkkür edirəm",
      })).toMatchObject({
        resolved: false,
        decision: acceptedCommentDecision,
      })
    })
  })
})

/**
 * Прод 2026-08-04. Владелец открыл ленту с сортировкой «сначала негатив» и
 * первыми увидел соболезнования, включая прямую похвалу: «Məkanın cənnət olsun
 * Şəhidim. Halaldı sənə Araz market». Из 110 принятых находок-соболезнований 61
 * была помечена негативом — горе и 😭 читались как жалоба.
 *
 * Порядок проверок и есть правило, поэтому он закреплён здесь целиком.
 */
describe("соболезнование против негатива", () => {
  it.each([
    ["формула соболезнования", "Allah rəhmət eləsin, məkanı cənnət olsun"],
    ["соболезнование с похвалой бренду", "Mekanin cennet olsun Şehidim. Halaldi sene Araz market"],
    ["соболезнование с плачущими смайликами", "Allah rəhmət eləsin 😭😭😭 can ana"],
    ["дань шехиду", "Allah bütün Şəhidlərimizə Rəhmət eləsin Amin"],
  ])("не считает негативом: %s", (_label, text) => {
    const result = classifyAutomaticReviewText(text, null)
    expect(result).toMatchObject({
      classification: "irrelevant",
      sentiment: "neutral",
      classifierEvidence: "condolence_without_complaint",
    })
  })

  // Претензия важнее соболезнования: жалоба в траурной ветке остаётся жалобой.
  it("жалобу рядом с соболезнованием оставляет негативом", () => {
    const result = classifyAutomaticReviewText(
      "Allah rəhmət eləsin. Amma Arazda məhsulun vaxtı keçmişdi, xarab idi",
      null,
    )
    expect(result).toMatchObject({
      classification: "negative",
      classifierEvidence: "explicit_complaint",
    })
  })

  // Соболезнование важнее смайлика, но смайлик без соболезнования — прежний
  // признак негатива: 😡 под постом бренда по-прежнему повод посмотреть.
  it("негативный смайлик без соболезнования остаётся негативом", () => {
    expect(classifyAutomaticReviewText("😡😡😡", null)).toMatchObject({
      classification: "negative",
      classifierEvidence: "negative_emoji",
    })
  })
})
