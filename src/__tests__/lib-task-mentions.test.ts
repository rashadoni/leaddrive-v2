import { describe, expect, it } from "vitest"
import { insertMention, mentionCandidates, mentionQueryAt, mentionedIds } from "@/lib/tasks/mentions"

const PEOPLE = [
  { id: "n", name: "Nazrin Shirinova" },
  { id: "s", name: "Sabina Hasanova" },
  { id: "g", name: "Gullu Ələkbərova" },
]

describe("task message @-mentions", () => {
  it("finds the @query being typed, but not inside an e-mail or after a line break", () => {
    expect(mentionQueryAt("salam @naz", 10)).toEqual({ start: 6, query: "naz" })
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" })
    expect(mentionQueryAt("mail a@b.az", 11)).toBeNull()
    expect(mentionQueryAt("@naz\nok", 7)).toBeNull()
  })

  it("offers people by the start of any word of the name, Azerbaijani letters folded", () => {
    expect(mentionCandidates(PEOPLE, "has").map((p) => p.id)).toEqual(["s"])
    expect(mentionCandidates(PEOPLE, "elek").map((p) => p.id)).toEqual(["g"])
    expect(mentionCandidates(PEOPLE, "").map((p) => p.id)).toEqual(["n", "s", "g"])
  })

  it("writes the name in and sends only the people still named in the text", () => {
    const typed = "bax @naz"
    const { text, caret } = insertMention(typed, 4, typed.length, PEOPLE[0])
    expect([text, caret]).toEqual(["bax @Nazrin Shirinova ", 22])
    expect(mentionedIds(`${text}və @Sabina Hasanova`, PEOPLE)).toEqual(["n", "s"])
    expect(mentionedIds("bax", PEOPLE)).toEqual([])
  })
})
