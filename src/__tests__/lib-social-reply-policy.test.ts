import { describe, expect, it } from "vitest"
import { evaluateSocialReplyPolicy } from "@/lib/social/reply-policy"

describe("social reply policy", () => {
  it("allows live reply only for supported official owned sources with live tenant flag", () => {
    const decision = evaluateSocialReplyPolicy(
      {
        platform: "facebook",
        sourceType: "comment",
        sourceProvider: "native",
        sourceMetadata: {},
        text: "Thanks for the update",
        sentiment: "neutral",
        hasConnectedAccount: true,
      },
      { liveRepliesEnabled: true },
    )

    expect(decision).toMatchObject({
      liveAllowed: true,
      reason: "allowed",
      sourceTier: "official_owned",
      draftOnly: false,
    })
  })

  it("keeps search, provider, browser, and manual sources as draft/open-original only", () => {
    for (const provider of ["provider_api", "search_index", "browser_capture", "manual"]) {
      const decision = evaluateSocialReplyPolicy(
        {
          platform: "instagram",
          sourceType: "mention",
          sourceProvider: provider,
          sourceMetadata: {},
          text: "Please contact me",
          hasConnectedAccount: true,
        },
        { liveRepliesEnabled: true },
      )

      expect(decision.liveAllowed).toBe(false)
      expect(decision.reason).toBe("source_requires_human_action")
      expect(decision.draftOnly).toBe(true)
      expect(decision.openOriginalRequired).toBe(true)
    }
  })

  it("allows provider API live reply only with explicit approved reply capability", () => {
    const decision = evaluateSocialReplyPolicy(
      {
        platform: "tiktok",
        sourceType: "comment",
        sourceProvider: "provider_api",
        sourceMetadata: {
          replyCapability: {
            approved: true,
            provider: "approved-listener",
            endpoint: "https://reply.example.com/comments/reply",
            targetId: "comment-1",
          },
        },
        text: "Safe neutral mention",
        hasConnectedAccount: false,
      },
      { liveRepliesEnabled: true },
    )

    expect(decision).toMatchObject({
      liveAllowed: true,
      reason: "allowed",
      sourceTier: "provider_api",
      supportedProvider: true,
      draftOnly: false,
    })
  })

  it("blocks official live replies when the tenant live flag is off", () => {
    const decision = evaluateSocialReplyPolicy(
      {
        platform: "twitter",
        sourceType: "mention",
        sourceProvider: "native",
        sourceMetadata: {},
        text: "Safe neutral mention",
        hasConnectedAccount: true,
      },
      { liveRepliesEnabled: false },
    )

    expect(decision).toMatchObject({
      liveAllowed: false,
      reason: "live_reply_disabled",
      draftOnly: true,
    })
  })

  it("requires approval for complaints and other forbidden topics even when live is enabled", () => {
    const blocked = evaluateSocialReplyPolicy(
      {
        platform: "facebook",
        sourceType: "comment",
        sourceProvider: "native",
        sourceMetadata: {},
        text: "Bu rəsmi şikayətdir",
        sentiment: "negative",
        hasConnectedAccount: true,
      },
      { liveRepliesEnabled: true },
    )

    expect(blocked).toMatchObject({
      liveAllowed: false,
      reason: "approval_required",
      approvalRequired: true,
      forbiddenReason: "complaint",
    })

    const approved = evaluateSocialReplyPolicy(
      {
        platform: "facebook",
        sourceType: "comment",
        sourceProvider: "native",
        sourceMetadata: {},
        text: "Bu rəsmi şikayətdir",
        sentiment: "negative",
        hasConnectedAccount: true,
      },
      { liveRepliesEnabled: true, approvedPolicy: true },
    )

    expect(approved.liveAllowed).toBe(true)
  })
})
