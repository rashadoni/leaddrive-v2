import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  hasEnoughTextToJudge,
  judgeableCharacters,
  judgeSubjectRelevanceWithJev,
  jevVerdictIsTrustworthy,
} from "@/lib/social/jev-relevance-judge"

/**
 * The relevance judge on Jev (owner decision, 2026-09-28: "Jev wherever it
 * copes"), and the two limits the owner named with it: it may not answer, and
 * it cannot read pictures. Both have to be properties of the code, because a
 * background pass cannot notice either one at three in the morning.
 */
const INPUT = {
  text: "Araz marketdə kassir çox kobud davrandı, bir daha getmirəm",
  parentText: null,
  platform: "instagram",
  contentKind: "COMMENT",
  authorName: "Aysel",
  authorHandle: "@aysel",
  subjectName: "Araz Supermarket",
  subjectType: "COMPANY",
  aliases: ["Araz market"],
  requiredContext: [],
  negativeTerms: [],
  geographies: ["Azərbaycan"],
  languages: ["az", "ru"],
} as const

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const answer = (choice: string, confidence: number) => jsonResponse({
  answers: { relevance: { type: "choice", choice, confidence } },
})

beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", "apikey_test")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("a picture is not evidence", () => {
  it.each([
    ["", 0],
    ["🙏🙏🙏", 0],
    ["Yau he he", 7],
    ["10.99 1kg", 7],
  ])("%s carries %i judgeable characters", (text, expected) => {
    expect(judgeableCharacters(text)).toBe(expected)
  })

  it("refuses to judge a record with no text of its own", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await judgeSubjectRelevanceWithJev({ ...INPUT, text: "Yau he he" })
    expect(result).toEqual({ verdict: null, confidence: null, errorClass: "NO_TEXT" })
    // And it costs nothing: the provider is never called.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The brand is usually named in the publication a comment sits under, so
  // judging the comment by its parent is how three meaningless words became a
  // confident "about_subject" in the benchmark.
  it("does not let a rich parent publication rescue an empty comment", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const result = await judgeSubjectRelevanceWithJev({
      ...INPUT,
      text: "👍",
      parentText: "Araz Supermarket: endirimlər başladı, filiallarımıza gəlin",
    })
    expect(result.errorClass).toBe("NO_TEXT")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("judges a real opinion", () => {
    expect(hasEnoughTextToJudge(INPUT.text)).toBe(true)
  })
})

describe("when the provider does not answer", () => {
  it("retries an overloaded provider exactly once, then gives up quietly", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: "system_overloaded" }, 529))
    vi.stubGlobal("fetch", fetchMock)

    const result = await judgeSubjectRelevanceWithJev(INPUT)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ verdict: null, confidence: null, errorClass: "TIMEOUT" })
  })

  it("takes the second answer when the first attempt was overloaded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(answer("about_subject", 0.97))
    vi.stubGlobal("fetch", fetchMock)

    const result = await judgeSubjectRelevanceWithJev(INPUT)
    expect(result).toEqual({ verdict: "about_subject", confidence: 0.97, errorClass: null })
  })

  it("does not repeat a request the provider rejected", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: "bad request" }, 422))
    vi.stubGlobal("fetch", fetchMock)

    const result = await judgeSubjectRelevanceWithJev(INPUT)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.errorClass).toBe("PROVIDER_ERROR")
  })

  it("never throws, whatever the network does", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET") }))
    await expect(judgeSubjectRelevanceWithJev(INPUT)).resolves.toMatchObject({
      verdict: null,
      errorClass: "PROVIDER_ERROR",
    })
  })

  it("says so when there is no key, instead of calling anything", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await judgeSubjectRelevanceWithJev(INPUT)).toMatchObject({ errorClass: "MISSING_KEY" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("treats an answer it does not recognise as no answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer("about_subject_maybe", 0.99)))
    expect(await judgeSubjectRelevanceWithJev(INPUT)).toMatchObject({ errorClass: "INVALID_RESPONSE" })
  })
})

describe("what the brand is told about itself", () => {
  it("sends the geography, the languages and the parent publication", async () => {
    const fetchMock = vi.fn(async () => answer("about_subject", 0.99))
    vi.stubGlobal("fetch", fetchMock)

    await judgeSubjectRelevanceWithJev({ ...INPUT, parentText: "Araz endirimləri" })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.state.brand_operates_in).toEqual(["Azərbaycan"])
    expect(body.state.brand_languages).toEqual(["az", "ru"])
    expect(body.state.parent_publication).toBe("Araz endirimləri")
    expect(body.questions.relevance.criteria).toHaveProperty("not_about_subject")
    // A same-name business elsewhere is the failure this fixes.
    expect(body.questions.relevance.instructions).toMatch(/outside `brand_operates_in`/)
  })
})

describe("how sure is sure enough", () => {
  it.each([
    [0.99, true],
    [0.9, true],
    [0.89, false],
    [0.5, false],
    [null, false],
  ])("confidence %s → restore: %s", (confidence, expected) => {
    expect(jevVerdictIsTrustworthy({
      verdict: "about_subject",
      confidence: confidence as number | null,
      errorClass: null,
    })).toBe(expected)
  })

  it("never restores on a verdict that is not about the brand", () => {
    for (const verdict of ["not_about_subject", "unsure", null] as const) {
      expect(jevVerdictIsTrustworthy({ verdict, confidence: 1, errorClass: null })).toBe(false)
    }
  })
})
