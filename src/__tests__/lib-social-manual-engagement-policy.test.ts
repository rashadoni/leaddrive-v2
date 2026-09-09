import { describe, expect, it } from "vitest"
import {
  assessManualEngagementRisk,
  isManualEngagementRiskCandidate,
} from "@/lib/social/manual-engagement-policy"

describe("manual engagement risk policy", () => {
  it("accepts a harmful negative video publication", () => {
    const assessment = assessManualEngagementRisk({
      platform: "facebook",
      sourceType: "post",
      contentKind: "VIDEO",
      sentiment: "negative",
      text: "Baku Electronics-dən aldığı iPhone 17 Pro-da donma problemi olduğunu iddia edir.",
    })

    expect(assessment.eligible).toBe(true)
    expect(assessment.reasons).toEqual(["negative_sentiment", "brand_harm_text"])
  })

  it("rejects promotional media when only the sentiment label is negative", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "tiktok",
      sourceType: "post",
      contentKind: "VIDEO",
      sentiment: "negative",
      text: "Endirimlər haqqında paylaşımımız üçün təşəkkür edirik! Kampaniyalar barədə məlumat üçün DM yaza bilərsiniz.",
    })).toBe(false)
  })

  it("does not mistake a promotional 'do not be late' call to action for a delivery delay", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "tiktok",
      sourceType: "post",
      contentKind: "VIDEO",
      sentiment: "neutral",
      text: "Təklifləri dəyərləndirmək üçün tələs! Gecikmə, mobil tətbiq və bakuelectronics.az saytında endirimlərdən yararlan.",
    })).toBe(false)
  })

  it("keeps a real delivery delay in the negative-risk queue", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "tiktok",
      sourceType: "post",
      contentKind: "VIDEO",
      sentiment: "neutral",
      text: "Sifarişin çatdırılması yenə gecikib və heç kim cavab vermir.",
    })).toBe(true)
    expect(isManualEngagementRiskCandidate({
      platform: "instagram",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "neutral",
      text: "Çatdırılma gecikib, sifarişim hələ gəlməyib.",
    })).toBe(true)
  })

  it("rejects neutral and positive comments without a brand-risk signal", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "facebook",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "neutral",
      text: "What time do you open?",
    })).toBe(false)
    expect(isManualEngagementRiskCandidate({
      platform: "instagram",
      sourceType: "reply",
      contentKind: "REPLY",
      sentiment: "positive",
      text: "Thank you, great service",
    })).toBe(false)
  })

  it("accepts a negative external comment", () => {
    expect(assessManualEngagementRisk({
      platform: "facebook",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "negative",
      text: "I am disappointed",
    })).toEqual({
      eligible: true,
      reasons: ["negative_sentiment"],
    })
  })

  it("accepts complaint and harmful-topic comments even when sentiment is neutral", () => {
    const assessment = assessManualEngagementRisk({
      platform: "instagram",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "neutral",
      text: "This is a complaint: the device is not working",
    })

    expect(assessment.eligible).toBe(true)
    expect(assessment.reasons).toContain("harmful_topic")
  })

  it("accepts a warning publication about a fake brand campaign", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "tiktok",
      sourceType: "post",
      contentKind: "VIDEO",
      sentiment: "neutral",
      text: "Araz Supermarket adından yayılan saxta kampaniyaya inanmayın.",
    })).toBe(true)
  })

  it("accepts a triaged high-risk comment but not an unrelated escalation flag", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "tiktok",
      sourceType: "reply",
      contentKind: "REPLY",
      sentiment: "neutral",
      text: "Please review this",
      sourceMetadata: {
        socialTriage: {
          prRisk: "high",
          recommendedAction: "escalate",
          reasons: ["negative_sentiment", "pr_risk_high"],
        },
      },
    })).toBe(true)

    expect(isManualEngagementRiskCandidate({
      platform: "tiktok",
      sourceType: "reply",
      contentKind: "REPLY",
      sentiment: "neutral",
      text: "Please review this",
      sourceMetadata: {
        socialTriage: { prRisk: "low", recommendedAction: "escalate" },
      },
    })).toBe(false)
  })

  it("does not treat ordinary pricing or legal-information questions as brand harm", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "facebook",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "neutral",
      text: "What is the price?",
    })).toBe(false)
    expect(isManualEngagementRiskCandidate({
      platform: "instagram",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "neutral",
      text: "Where can I read the legal terms?",
    })).toBe(false)
  })

  it("rejects unsupported platforms from this Meta and TikTok manual queue", () => {
    expect(isManualEngagementRiskCandidate({
      platform: "youtube",
      sourceType: "comment",
      contentKind: "COMMENT",
      sentiment: "negative",
      text: "Bad service",
    })).toBe(false)
  })
})
