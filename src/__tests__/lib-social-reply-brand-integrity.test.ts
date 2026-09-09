import { describe, expect, it } from "vitest"
import {
  assessManualTaskIntegrity,
  findForeignBrandMentions,
  isExternalCommentOrReply,
  isOwnedSocialContent,
  normalizeBrandName,
  TENANT_RESPONDER_REPLY_PROMPT_VERSION,
} from "@/lib/social/reply-brand-integrity"

describe("social reply brand integrity", () => {
  it("normalizes punctuation and diacritics for comparison", () => {
    expect(normalizeBrandName("  Bakı.Electronics™ ")).toBe("baki electronics")
  })

  it("detects another monitored brand in a reply", () => {
    expect(findForeignBrandMentions(
      "Bu paylaşım PharmaStore və PharmOnline brendlərinə aid deyil.",
      "Baku Electronics",
      ["Baku Electronics", "PharmaStore", "PharmOnline"],
    )).toEqual(["PharmaStore", "PharmOnline"])
  })

  it("does not treat the target brand as foreign", () => {
    expect(findForeignBrandMentions(
      "Baku Electronics olaraq müraciətinizi yoxlayacağıq.",
      "Baku Electronics",
      ["Baku Electronics", "Baku"],
    )).toEqual([])
  })

  it("allows manual reply work only for comments and replies", () => {
    expect(isExternalCommentOrReply({ contentKind: "COMMENT" })).toBe(true)
    expect(isExternalCommentOrReply({ sourceType: "reply" })).toBe(true)
    expect(isExternalCommentOrReply({ contentKind: "POST", sourceType: "post" })).toBe(false)
  })

  it("detects owned content from metadata or a connected reply identity", () => {
    expect(isOwnedSocialContent({
      sourceMetadata: { ownership: "owned" },
    })).toBe(true)
    expect(isOwnedSocialContent({
      accountId: "brand-account",
      replyIdentityAccountIds: ["brand-account"],
    })).toBe(true)
    expect(isOwnedSocialContent({
      accountId: null,
      sourceMetadata: { ownership: "external" },
      replyIdentityAccountIds: ["brand-account"],
    })).toBe(false)
    expect(isOwnedSocialContent({
      accountId: "brand-account",
      contentKind: "COMMENT",
      sourceType: "comment",
      sourceMetadata: {
        ownership: "owned",
        authorScope: "official",
        officialArchive: true,
        relevanceReason: "official_author",
      },
      replyIdentityAccountIds: ["brand-account"],
    })).toBe(false)
    expect(isOwnedSocialContent({
      contentKind: "REPLY",
      sourceType: "reply",
      sourceMetadata: { owner: true, officialCollector: true },
    })).toBe(true)
  })

  it("treats official archive and official-author stamps as owned only for direct publications", () => {
    expect(isOwnedSocialContent({
      contentKind: "POST",
      sourceType: "post",
      sourceMetadata: { officialArchive: true },
    })).toBe(true)
    expect(isOwnedSocialContent({
      contentKind: "VIDEO",
      sourceType: "post",
      sourceMetadata: { relevanceReason: "official_author_excluded_backfill" },
    })).toBe(true)
    expect(isOwnedSocialContent({
      contentKind: "MENTION",
      sourceType: "mention",
      sourceMetadata: { officialArchive: true, relevanceReason: "official_author" },
    })).toBe(true)
    expect(isOwnedSocialContent({
      contentKind: "DM",
      sourceType: "dm",
      sourceMetadata: { officialArchive: true, relevanceReason: "official_author" },
    })).toBe(false)
    expect(isOwnedSocialContent({
      contentKind: "REPLY",
      sourceType: "reply",
      sourceMetadata: { officialArchive: true, relevanceReason: "official_author" },
    })).toBe(false)
  })

  it("quarantines a legacy prompt even when its subject agent binding matches", () => {
    expect(assessManualTaskIntegrity({
      mention: { contentKind: "COMMENT", sourceType: "comment" },
      subjectId: "subject-baku",
      subjectName: "Baku Electronics",
      draftSubjectId: "subject-baku",
      draftReplyText: "Bu paylaşım PharmaStore brendinə aid deyil.",
      draftPromptVersion: "social-reply-v2-subject-bound",
      draftAgentId: "subject-agent",
      draftAgentBinding: "SUBJECT",
      subjectAssignedAgentId: "subject-agent",
      draftSenderAccountId: "official-account",
      channelSenderAccountId: "official-account",
    }, ["Baku Electronics", "PharmaStore"])).toEqual({
      safe: false,
      reasons: ["legacy_brand_binding"],
      foreignBrandNames: [],
    })
  })

  it("accepts a current draft bound to the subject's assigned agent", () => {
    expect(assessManualTaskIntegrity({
      mention: { contentKind: "COMMENT", sourceType: "comment" },
      subjectId: "subject-baku",
      subjectName: "Baku Electronics",
      draftSubjectId: "subject-baku",
      draftReplyText: "Müraciətiniz üçün təşəkkür edirik. Zəhmət olmasa DM ilə əlaqə saxlayın.",
      draftPromptVersion: TENANT_RESPONDER_REPLY_PROMPT_VERSION,
      draftAgentId: "subject-agent",
      draftAgentBinding: "SUBJECT",
      subjectAssignedAgentId: "subject-agent",
      draftSenderAccountId: "official-account",
      channelSenderAccountId: "official-account",
    }, ["Baku Electronics", "PharmaStore"])).toEqual({
      safe: true,
      reasons: [],
      foreignBrandNames: [],
    })
  })

  it("accepts a current safe-default draft when the subject has no assigned agent", () => {
    expect(assessManualTaskIntegrity({
      mention: {
        contentKind: "VIDEO",
        sourceType: "post",
        sourceMetadata: { ownership: "external" },
      },
      subjectId: "subject-baku",
      subjectName: "Baku Electronics",
      draftSubjectId: "subject-baku",
      draftReplyText: "Məlumat üçün təşəkkür edirik. Məsələni yoxlayırıq.",
      draftPromptVersion: TENANT_RESPONDER_REPLY_PROMPT_VERSION,
      draftAgentId: null,
      draftAgentBinding: "SAFE_DEFAULT",
      subjectAssignedAgentId: null,
      draftSenderAccountId: "official-account",
      channelSenderAccountId: "official-account",
    }, ["Baku Electronics", "PharmaStore"])).toEqual({
      safe: true,
      reasons: [],
      foreignBrandNames: [],
    })
  })

  it("quarantines stale and legacy organization agent bindings", () => {
    const base = {
      mention: { contentKind: "COMMENT", sourceType: "comment" },
      subjectId: "subject-baku",
      subjectName: "Baku Electronics",
      draftSubjectId: "subject-baku",
      draftReplyText: "Müraciətiniz üçün təşəkkür edirik.",
      draftPromptVersion: TENANT_RESPONDER_REPLY_PROMPT_VERSION,
      draftSenderAccountId: "official-account",
      channelSenderAccountId: "official-account",
    }

    expect(assessManualTaskIntegrity({
      ...base,
      draftAgentId: "old-subject-agent",
      draftAgentBinding: "SUBJECT",
      subjectAssignedAgentId: "current-subject-agent",
    }, ["Baku Electronics"])).toMatchObject({
      safe: false,
      reasons: ["subject_agent_mismatch"],
    })

    expect(assessManualTaskIntegrity({
      ...base,
      draftAgentId: "other-company-agent",
      draftAgentBinding: "ORGANIZATION",
      subjectAssignedAgentId: null,
    }, ["Baku Electronics"])).toMatchObject({
      safe: false,
      reasons: ["subject_agent_mismatch"],
    })
  })

  it("quarantines a draft attached to the brand's own content", () => {
    expect(assessManualTaskIntegrity({
      mention: {
        contentKind: "POST",
        sourceType: "post",
        accountId: "brand-account",
        sourceMetadata: { ownership: "owned" },
      },
      replyIdentityAccountIds: ["brand-account"],
      subjectId: "subject-baku",
      subjectName: "Baku Electronics",
      draftSubjectId: "subject-baku",
      draftReplyText: "Məlumat üçün təşəkkür edirik.",
      draftPromptVersion: TENANT_RESPONDER_REPLY_PROMPT_VERSION,
      draftAgentId: "subject-agent",
      draftAgentBinding: "SUBJECT",
      subjectAssignedAgentId: "subject-agent",
      draftSenderAccountId: "official-account",
      channelSenderAccountId: "official-account",
    }, ["Baku Electronics"])).toEqual({
      safe: false,
      reasons: ["owned_source"],
      foreignBrandNames: [],
    })
  })
})
