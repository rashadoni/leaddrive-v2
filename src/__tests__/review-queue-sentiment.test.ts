import { describe, expect, it } from "vitest"
import { reviewQueueSentiment } from "@/lib/social/review-queue-sentiment"

describe("review queue sentiment", () => {
  it("classifies only strong stored sentiment evidence without an external provider", () => {
    expect(reviewQueueSentiment("Əla xidmət, təşəkkür edirəm")).toBe("positive")
    expect(reviewQueueSentiment("Telefon xarabdır, problem həll olunmur")).toBe("negative")
    expect(reviewQueueSentiment("Bu nədir 👎")).toBe("negative")
    expect(reviewQueueSentiment("Çox yaxşı 👍")).toBe("positive")
  })

  it("does not invent neutral sentiment for undecidable or mention-only text", () => {
    expect(reviewQueueSentiment("Yeni mağaza bu gün açılır")).toBe("unknown")
    expect(reviewQueueSentiment("Araz")).toBe("unknown")
    expect(reviewQueueSentiment("...")).toBe("unknown")
    expect(reviewQueueSentiment("😂")).toBe("unknown")
  })

  it("keeps missing text explicitly unclassified", () => {
    expect(reviewQueueSentiment(null)).toBe("unknown")
    expect(reviewQueueSentiment(" ")).toBe("unknown")
  })
})
