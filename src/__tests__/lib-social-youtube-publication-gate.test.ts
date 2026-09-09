import { describe, expect, it } from "vitest"
import {
  decideYouTubePublication,
  isYouTubePublicationEligibleForComments,
  YOUTUBE_PUBLICATION_GATE_VERSION,
} from "@/lib/social/youtube-publication-gate"

const observedAt = new Date("2026-07-18T12:00:00Z")
const freshnessSince = new Date("2026-07-11T12:00:00Z")

describe("YouTube publication gate", () => {
  it("allows comments for a deterministic tenant-term match inside the seven-day window", () => {
    const decision = decideYouTubePublication({
      observedAt,
      freshnessSince,
      publishedAt: new Date("2026-07-12T10:00:00Z"),
      title: "Independent ACME Robotics review",
      description: "Field test",
      channelTitle: "Reviewer",
      positiveTerms: ["Acme Robotics"],
    })

    expect(decision).toMatchObject({
      status: "MATCHED",
      reasonCode: "DETERMINISTIC_TERM_MATCH",
      matchedTerms: ["acme robotics"],
      policySnapshot: {
        version: "youtube-publication-gate-v3",
        commentsRequireMatched: true,
        liveReplies: false,
      },
    })
    expect(YOUTUBE_PUBLICATION_GATE_VERSION).toBe("youtube-publication-gate-v3")
    expect(isYouTubePublicationEligibleForComments(decision)).toBe(true)
  })

  it.each([
    {
      label: "missing publication timestamp",
      publishedAt: null,
      title: "ACME Robotics review",
      positiveTerms: ["Acme Robotics"],
      negativeTerms: [] as string[],
      status: "REVIEW",
    },
    {
      label: "stale publication",
      publishedAt: new Date("2026-07-10T10:00:00Z"),
      title: "ACME Robotics review",
      positiveTerms: ["Acme Robotics"],
      negativeTerms: [] as string[],
      status: "REJECTED",
    },
    {
      label: "publication carrying only search provenance",
      publishedAt: new Date("2026-07-18T10:00:00Z"),
      title: "Unrelated industry news",
      positiveTerms: ["Acme Robotics"],
      negativeTerms: [] as string[],
      status: "REVIEW",
    },
    {
      label: "negative tenant term",
      publishedAt: new Date("2026-07-18T10:00:00Z"),
      title: "ACME Robotics jobs",
      positiveTerms: ["Acme Robotics"],
      negativeTerms: ["jobs"],
      status: "REJECTED",
    },
  ])("does not allow comments for $label", ({ publishedAt, title, positiveTerms, negativeTerms, status }) => {
    const decision = decideYouTubePublication({
      observedAt,
      freshnessSince,
      publishedAt,
      title,
      positiveTerms,
      negativeTerms,
    })

    expect(decision.status).toBe(status)
    expect(isYouTubePublicationEligibleForComments(decision)).toBe(false)
  })

  // Regression for #631: YouTube's search.list already matched the brand query
  // on tags/captions/semantics, so a video whose title and description never
  // spell the brand is operator review work. Rejecting it here is what left a
  // full production sweep at 25 found / 2 accepted.
  it("sends a video the platform matched without a literal term to review, not rejection", () => {
    const decision = decideYouTubePublication({
      observedAt,
      freshnessSince,
      publishedAt: new Date("2026-07-18T10:00:00Z"),
      title: "Yumurta aldım, yarısı xarab çıxdı",
      description: "Endirimə güvənmə",
      channelTitle: "Müştəri",
      positiveTerms: ["Oba Market"],
    })

    expect(decision).toMatchObject({
      status: "REVIEW",
      reasonCode: "SEARCH_PROVENANCE_ONLY",
      matchedTerms: [],
    })
    // Review is operator work, never a licence to spend on comment collection.
    expect(isYouTubePublicationEligibleForComments(decision)).toBe(false)
  })

  it("keeps hard exclusions rejected rather than routing them to operators", () => {
    const negative = decideYouTubePublication({
      observedAt,
      freshnessSince,
      publishedAt: new Date("2026-07-18T10:00:00Z"),
      title: "Unrelated industry news",
      positiveTerms: ["Acme Robotics"],
      negativeTerms: ["industry"],
    })
    const stale = decideYouTubePublication({
      observedAt,
      freshnessSince,
      publishedAt: new Date("2026-07-01T10:00:00Z"),
      title: "Unrelated industry news",
      positiveTerms: ["Acme Robotics"],
    })

    expect(negative).toMatchObject({ status: "REJECTED", reasonCode: "NEGATIVE_TERM" })
    expect(stale).toMatchObject({ status: "REJECTED", reasonCode: "STALE_PUBLICATION" })
  })
})
