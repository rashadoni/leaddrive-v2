import { describe, expect, it } from "vitest"
import {
  mediaObservationFilterCounts,
  mediaObservationMatchesFilters,
  mediaObservationRelevance,
  mediaObservationSubject,
  type FilterableMediaObservation,
} from "@/lib/social/media-observation-filters"

function observation(overrides: Partial<FilterableMediaObservation> = {}): FilterableMediaObservation {
  return {
    platform: "tiktok",
    mediaType: "VIDEO",
    sourceUrl: "https://example.com/video",
    canonicalMediaUrl: "https://cdn.example.com/video.mp4",
    platformTranscript: null,
    relevanceScore: 0.4,
    subject: { id: "subject-1", name: "Araz Supermarket" },
    mention: { text: null, authorHandle: "shop", platform: "tiktok" },
    signals: [],
    ...overrides,
  }
}

describe("media observation filters", () => {
  it("treats matched extraction terms as confirmed", () => {
    expect(mediaObservationRelevance(observation({
      signals: [{ text: "Araz Supermarket", matchedTerms: ["Araz Supermarket"] }],
    }))).toBe("confirmed")
  })

  it("shows the exact search term that admitted the source post", () => {
    const item = observation({
      mention: {
        text: "Endirim videosu",
        authorHandle: "customer",
        platform: "tiktok",
        matchedTerm: "Araz Supermarket",
      },
    })
    expect(mediaObservationRelevance(item)).toBe("confirmed")
    expect(mediaObservationMatchesFilters(item, {
      query: "araz supermarket",
      subjectId: "",
      platform: "",
      mediaType: "",
      relevance: "all",
    })).toBe(true)
  })

  it("detects the full subject name without matching generic fragments", () => {
    expect(mediaObservationRelevance(observation({ platformTranscript: "Bu gün Araz Supermarket mağazasında endirim var." }))).toBe("confirmed")
    expect(mediaObservationRelevance(observation({ platformTranscript: "A new supermarket opened today." }))).toBe("unverified")
  })

  it("keeps high-confidence assigned observations as likely", () => {
    expect(mediaObservationRelevance(observation({ relevanceScore: 0.75 }))).toBe("likely")
  })

  it("defaults the relevant filter to confirmed and likely observations", () => {
    const filters = { query: "", subjectId: "", platform: "", mediaType: "", relevance: "relevant" as const }
    expect(mediaObservationMatchesFilters(observation({ relevanceScore: 0.8 }), filters)).toBe(true)
    expect(mediaObservationMatchesFilters(observation({ relevanceScore: 0.2 }), filters)).toBe(false)
  })

  it("searches extracted text and supports platform and media filters", () => {
    const item = observation({ signals: [{ text: "Endirim kampaniyası", matchedTerms: [] }] })
    expect(mediaObservationMatchesFilters(item, {
      query: "kampaniyası",
      subjectId: "subject-1",
      platform: "tiktok",
      mediaType: "VIDEO",
      relevance: "all",
    })).toBe(true)
  })

  it("matches every asset type represented by a grouped post", () => {
    const item = observation({ mediaType: "VIDEO", mediaTypes: ["AUDIO", "IMAGE", "VIDEO"] })
    expect(mediaObservationMatchesFilters(item, {
      query: "",
      subjectId: "",
      platform: "",
      mediaType: "IMAGE",
      relevance: "all",
    })).toBe(true)
  })

  it("filters media by source-post sentiment without treating unknown as neutral", () => {
    const negative = observation({ mention: { text: "Pis xidmət", authorHandle: "customer", platform: "tiktok", sentiment: "negative" } })
    const unknown = observation({ mention: { text: "Araz haqqında video", authorHandle: "customer", platform: "tiktok", sentiment: null } })
    const base = { query: "", subjectId: "", platform: "", mediaType: "", relevance: "all" as const }

    expect(mediaObservationMatchesFilters(negative, { ...base, sentiment: "negative" })).toBe(true)
    expect(mediaObservationMatchesFilters(unknown, { ...base, sentiment: "negative" })).toBe(false)
    expect(mediaObservationMatchesFilters(unknown, { ...base, sentiment: "neutral" })).toBe(false)
    expect(mediaObservationMatchesFilters(unknown, { ...base, sentiment: "unknown" })).toBe(true)
  })

  it("uses a confirmed mention match when the media row has no direct subject", () => {
    const item = observation({
      subject: null,
      mention: {
        text: "Araz Supermarket endirimləri",
        authorHandle: "endirim.budur",
        platform: "tiktok",
        subjectMatches: [{
          status: "MATCHED",
          subjectId: "subject-1",
          subject: { id: "subject-1", name: "Araz Supermarket" },
        }],
      },
    })

    expect(mediaObservationSubject(item)).toEqual({ id: "subject-1", name: "Araz Supermarket" })
    expect(mediaObservationRelevance(item)).toBe("confirmed")
    expect(mediaObservationMatchesFilters(item, {
      query: "",
      subjectId: "subject-1",
      platform: "",
      mediaType: "",
      relevance: "relevant",
    })).toBe(true)
  })

  it("does not assign a subject from rejected mention matches", () => {
    const item = observation({
      subject: null,
      mention: {
        text: "A new supermarket opened today.",
        authorHandle: "news",
        platform: "tiktok",
        subjectMatches: [{
          status: "REJECTED",
          subjectId: "subject-1",
          subject: { id: "subject-1", name: "Araz Supermarket" },
        }],
      },
    })

    expect(mediaObservationSubject(item)).toBeNull()
    expect(mediaObservationMatchesFilters(item, {
      query: "",
      subjectId: "subject-1",
      platform: "",
      mediaType: "",
      relevance: "all",
    })).toBe(false)
  })

  it("counts each relevance bucket", () => {
    expect(mediaObservationFilterCounts([
      observation({ signals: [{ text: "Araz", matchedTerms: ["Araz Supermarket"] }] }),
      observation({ relevanceScore: 0.7 }),
      observation({ relevanceScore: 0.2 }),
    ])).toEqual({ confirmed: 1, likely: 1, unverified: 1 })
  })
})
