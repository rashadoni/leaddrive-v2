import { describe, expect, it } from "vitest"
import {
  SOCIAL_COMMENT_RELEVANCE_VERSION,
  classifySocialCommentThread,
  classifyTikTokCommentThread,
  hasCommentComplaintSignal,
  hasCommentEngagementSignal,
} from "@/lib/social/tiktok-comment-relevance"

describe("Social comment relevance", () => {
  it("exposes a platform-neutral classifier without breaking the TikTok alias", () => {
    const rows = [{ externalId: "facebook-comment", engagementSignal: true }]
    expect(SOCIAL_COMMENT_RELEVANCE_VERSION).toBe("social-comment-relevance-v2")
    expect(classifySocialCommentThread(rows)).toEqual(classifyTikTokCommentThread(rows))
  })

  it("accepts own terms, enabled scenarios and deterministic subject context", () => {
    expect(classifyTikTokCommentThread([
      { externalId: "term", matchedTerm: "Araz" },
      { externalId: "scenario", enabledScenarioMatch: true },
      { externalId: "subject", subjectContextMatch: true },
    ])).toEqual([
      { externalId: "term", classification: "ACTIONABLE", reason: "OWN_TENANT_TERM" },
      { externalId: "scenario", classification: "ACTIONABLE", reason: "ENABLED_SCENARIO_MATCH" },
      { externalId: "subject", classification: "ACTIONABLE", reason: "SUBJECT_CONTEXT_MATCH" },
    ])
  })

  it("promotes replies to actionable comments but not generic publication comments", () => {
    const decisions = classifyTikTokCommentThread([
      { externalId: "generic" },
      { externalId: "actionable", matchedTerm: "Araz" },
      { externalId: "reply", parentExternalId: "actionable" },
      { externalId: "nested", parentExternalId: "reply" },
    ])
    expect(decisions.map(item => item.classification)).toEqual(["REJECTED", "ACTIONABLE", "ACTIONABLE", "ACTIONABLE"])
    expect(decisions[2].reason).toBe("REPLY_TO_ACTIONABLE_COMMENT")
  })

  it("retains only the minimum ancestor chain as context", () => {
    expect(classifyTikTokCommentThread([
      { externalId: "root" },
      { externalId: "middle", parentExternalId: "root" },
      { externalId: "actionable", parentExternalId: "middle", enabledScenarioMatch: true },
      { externalId: "neighbor", parentExternalId: "root" },
    ])).toEqual([
      { externalId: "root", classification: "CONTEXT", reason: "THREAD_CONTEXT_FOR_ACTIONABLE_DESCENDANT" },
      { externalId: "middle", classification: "CONTEXT", reason: "THREAD_CONTEXT_FOR_ACTIONABLE_DESCENDANT" },
      { externalId: "actionable", classification: "ACTIONABLE", reason: "ENABLED_SCENARIO_MATCH" },
      { externalId: "neighbor", classification: "REJECTED", reason: "NO_ACTIONABLE_SIGNAL" },
    ])
  })

  it("rejects duplicate identities before classification", () => {
    expect(() => classifyTikTokCommentThread([{ externalId: "same" }, { externalId: "same" }]))
      .toThrow("Social comment relevance requires unique external IDs")
  })

  it("accepts engagement signals on matched publications without a keyword (owner option 2)", () => {
    expect(classifyTikTokCommentThread([
      { externalId: "complaint", engagementSignal: true },
      { externalId: "praise" },
    ])).toEqual([
      { externalId: "complaint", classification: "ACTIONABLE", reason: "ENGAGEMENT_SIGNAL" },
      { externalId: "praise", classification: "REJECTED", reason: "NO_ACTIONABLE_SIGNAL" },
    ])
  })

  it("keyword match wins over engagement signal as the recorded reason", () => {
    expect(classifyTikTokCommentThread([
      { externalId: "both", matchedTerm: "Araz", engagementSignal: true },
    ])[0]).toEqual({ externalId: "both", classification: "ACTIONABLE", reason: "OWN_TENANT_TERM" })
  })

  it("detects complaint, lead, urgency and question signals across az/ru/en", () => {
    expect(hasCommentEngagementSignal("qiymət neçədi?")).toBe(true)          // lead + question (az)
    expect(hasCommentEngagementSignal("плохой сервис, верните возврат")).toBe(true) // complaint (ru)
    expect(hasCommentEngagementSignal("bad service, i want a refund")).toBe(true)   // complaint (en)
    expect(hasCommentEngagementSignal("təcili kömək lazımdır")).toBe(true)   // urgency (az)
    expect(hasCommentEngagementSignal("yardım edin")).toBe(true)             // help request (az)
    expect(hasCommentEngagementSignal("kömək lazımdır")).toBe(true)          // help request (az)
    expect(hasCommentEngagementSignal("Sagol Kamiş")).toBe(false)            // praise, no signal
    expect(hasCommentEngagementSignal("xanımın nə gözəl danışıq qabiliyyəti var")).toBe(false)
    expect(hasCommentEngagementSignal("")).toBe(false)
    expect(hasCommentEngagementSignal(null)).toBe(false)
  })

  it("flags complaint/negative comments but not neutral questions or price chatter", () => {
    expect(hasCommentComplaintSignal("bizi aldatdılar, pulu qaytarın")).toBe(true)   // cheated (az)
    expect(hasCommentComplaintSignal("Araz qədər məsuliyyətsiz ikinci mağaza da olmadı")).toBe(true)
    expect(hasCommentComplaintSignal("Qara çörəyin də tərkibinə palma yağı vururlar")).toBe(true)
    expect(hasCommentComplaintSignal("нас надули, ужасный сервис")).toBe(true)        // cheated (ru)
    expect(hasCommentComplaintSignal("worst service ever, total scam")).toBe(true)    // (en)
    // Negative-only: questions / price / praise must NOT be complaints.
    expect(hasCommentComplaintSignal("qiymət neçədi?")).toBe(false)                   // price question
    expect(hasCommentComplaintSignal("Sagol Kamiş")).toBe(false)                      // praise
    // Regression: the "наду" complaint stem must not fire on neutral "надувные".
    expect(hasCommentComplaintSignal("есть надувные шары и бассейны?")).toBe(false)
    expect(hasCommentComplaintSignal("")).toBe(false)
  })
})
