/**
 * Inbox AI training — the rules without a database or a model (lib/inbox/learning):
 * whose message is an answer to learn from, which question it answered, «через один», the readiness
 * figure the owner chose (option «В»), how a conversation's facts join a channel's knowledge, and
 * what of it the AI may state to a customer.
 */
import { describe, expect, it } from "vitest"
import {
  READINESS_MIN_QUESTIONS, READINESS_WINDOW, answerText, answerTurn, computeReadiness, effectiveVerdict,
  isPersonAnswer, shouldDraft, type ReadinessSample, type ThreadMessage,
} from "@/lib/inbox/learning/model"
import { needsConfirmation, namesMoney, planMerge, type ExistingItem } from "@/lib/inbox/learning/merge"
import { composeLearnedCharacter, composeLearnedKnowledge, type LearnedRow } from "@/lib/inbox/learning/compose"
import { measuredCharacter, parseCharacter, parseComparison, parseExtraction } from "@/lib/inbox/learning/judge"
import { aiReplyEnabled } from "@/lib/inbox/reply-mode"
import { channelMode } from "@/lib/inbox/learning/service"

const at = (minute: number) => new Date(Date.UTC(2026, 10, 15, 9, minute))
const msg = (id: string, direction: "inbound" | "outbound", body: string, minute: number, metadata: Record<string, unknown> = {}): ThreadMessage =>
  ({ id, direction, body, metadata, createdAt: at(minute) })
const person = { authorType: "operator", authorName: "Leyla" }

describe("training mode never lets the AI answer", () => {
  it("is off on every channel, WhatsApp's default-on included", () => {
    expect(aiReplyEnabled("learning")).toBe(false)
    expect(aiReplyEnabled("learning", true)).toBe(false)
    // and the other modes keep their meaning
    expect(aiReplyEnabled(undefined, true)).toBe(true)
    expect(aiReplyEnabled("agent", true)).toBe(false)
    expect(aiReplyEnabled("ai")).toBe(true)
  })

  it("reads a channel's mode for the screen", () => {
    expect(channelMode({ replyMode: "learning" }, "whatsapp")).toBe("learning")
    expect(channelMode({}, "whatsapp")).toBe("ai")
    expect(channelMode({}, "instagram")).toBe("human")
    expect(channelMode({ replyMode: "ai", draftMode: true }, "instagram")).toBe("draft")
  })
})

describe("what counts as a person's answer", () => {
  it("learns from a person in the CRM and from the platform's app, not from a bot or the AI", () => {
    expect(isPersonAnswer({ direction: "outbound", body: "25 ₼", metadata: person })).toBe(true)
    expect(isPersonAnswer({ direction: "outbound", body: "25 ₼", metadata: { source: "business_app" } })).toBe(true)
    expect(isPersonAnswer({ direction: "outbound", body: "25 ₼", metadata: { sentFromBusinessApp: true } })).toBe(true)
    expect(isPersonAnswer({ direction: "outbound", body: "25 ₼", metadata: { autoReply: true, authorType: "ai" } })).toBe(false)
    expect(isPersonAnswer({ direction: "outbound", body: "Salam!", metadata: { autoReply: true } })).toBe(false)
    // an AI draft a person merely approved is the AI's own text
    expect(isPersonAnswer({ direction: "outbound", body: "25 ₼", metadata: { ...person, aiDraftApproved: true } })).toBe(false)
    // an unmarked outbound row may be an automation's
    expect(isPersonAnswer({ direction: "outbound", body: "Welcome", metadata: {} })).toBe(false)
    expect(isPersonAnswer({ direction: "inbound", body: "hi", metadata: person })).toBe(false)
    expect(isPersonAnswer({ direction: "outbound", body: "  ", metadata: person })).toBe(false)
  })

  it("finds the question an answer replied to, and the conversation before it", () => {
    const thread = [
      msg("q1", "inbound", "Salam", 0),
      msg("a1", "outbound", "Salam! Buyurun", 1, person),
      msg("q2", "inbound", "Manikür neçəyədir?", 2),
      msg("q3", "inbound", "Gel-lak ilə", 3),
      msg("a2", "outbound", "25 ₼", 4, person),
      msg("a3", "outbound", "Köhnə örtüyün çıxarılması daxildir", 5, person),
      msg("q4", "inbound", "Ünvan?", 30),
    ]
    const turn = answerTurn(thread, "a2")!
    expect(turn.question).toBe("Manikür neçəyədir?\n\nGel-lak ilə")
    expect(turn.questionMessageId).toBe("q3")
    expect(turn.history).toEqual([
      { role: "user", content: "Salam" },
      { role: "assistant", content: "Salam! Buyurun" },
      { role: "user", content: "Manikür neçəyədir?\n\nGel-lak ilə" },
    ])
    // the second message of the same answer is not an answer of its own
    expect(answerTurn(thread, "a3")).toBeNull()
    // and the comparison sees the whole answer
    expect(answerText(thread, "a2")).toBe("25 ₼\nKöhnə örtüyün çıxarılması daxildir")
  })

  it("has no question when the person wrote first", () => {
    expect(answerTurn([msg("a1", "outbound", "Endirim başladı!", 0, person)], "a1")).toBeNull()
  })
})

describe("«через один» — the AI tries every second question", () => {
  it("tries the first, then alternates; a failed try counts as a try", () => {
    expect(shouldDraft(null)).toBe(true)
    expect(shouldDraft("same")).toBe(false)
    expect(shouldDraft("skipped")).toBe(true)
    expect(shouldDraft("failed")).toBe(false)
    let previous: Parameters<typeof shouldDraft>[0] = null
    const plan: boolean[] = []
    for (let i = 0; i < 6; i++) {
      const draft = shouldDraft(previous)
      plan.push(draft)
      previous = draft ? "different" : "skipped"
    }
    expect(plan).toEqual([true, false, true, false, true, false])
  })
})

describe("readiness — option «В»", () => {
  const sample = (verdict: string, minute: number, extra: Partial<ReadinessSample> = {}): ReadinessSample =>
    ({ verdict, resolution: null, topic: null, reason: null, createdAt: at(minute), ...extra })

  it("shows nothing below the minimum, then the share of «the same» over the latest window", () => {
    const few = Array.from({ length: READINESS_MIN_QUESTIONS - 1 }, (_, i) => sample("same", i))
    expect(computeReadiness(few).percent).toBeNull()

    const rows = [
      ...Array.from({ length: 37 }, (_, i) => sample("same", i)),
      ...Array.from({ length: 6 }, (_, i) => sample("almost", 40 + i)),
      ...Array.from({ length: 5 }, (_, i) => sample("different", 50 + i)),
      ...Array.from({ length: 2 }, (_, i) => sample("handoff", 56 + i)),
      // not compared: never in the figure
      sample("skipped", 58), sample("no_question", 59), sample("failed", 59),
    ]
    const r = computeReadiness(rows)
    expect(r).toMatchObject({ compared: 50, same: 37, almost: 6, different: 5, handoff: 2, percent: 74 })
  })

  it("reads only the latest window", () => {
    const old = Array.from({ length: 60 }, (_, i) => sample("different", i))
    const fresh = Array.from({ length: READINESS_WINDOW }, (_, i) => ({ ...sample("same", 0), createdAt: new Date(at(0).getTime() + 86_400_000 + i * 1000) }))
    expect(computeReadiness([...old, ...fresh]).percent).toBe(100)
  })

  it("counts a person's «Ответ ИИ тоже подходит» and «Запомнить» as the same", () => {
    expect(effectiveVerdict({ verdict: "different", resolution: "accepted" })).toBe("same")
    expect(effectiveVerdict({ verdict: "different", resolution: "taught" })).toBe("same")
    const rows = Array.from({ length: 30 }, (_, i) => sample(i < 15 ? "same" : "different", i, i >= 25 ? { resolution: "accepted" } : {}))
    expect(computeReadiness(rows).percent).toBe(67)
  })

  it("leaves a skipped answer out of the figure and its topics — neither «the same» nor «differently»", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => sample("same", i, { topic: "Адрес" })),
      ...Array.from({ length: 5 }, (_, i) => sample("different", 40 + i, { topic: "Шутка", resolution: "dismissed" })),
    ]
    const r = computeReadiness(rows)
    expect(r).toMatchObject({ compared: 30, same: 30, different: 0, percent: 100 })
    expect(r.topics.map((t) => t.name)).toEqual(["Адрес"])
  })

  it("names the frequent topics: known, waiting for a price, not known", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => sample("same", i, { topic: i % 2 ? "Адрес салона" : "адрес салона" })),
      sample("different", 40, { topic: "Цена педикюра", reason: "pending_price" }),
      sample("different", 41, { topic: "Сертификаты", reason: "no_knowledge" }),
    ]
    const r = computeReadiness(rows)
    expect(r.topics.map((t) => [t.name, t.state, t.count])).toEqual([
      ["Адрес салона", "ok", 30], // named as the latest question put it
      ["Сертификаты", "no", 1],
      ["Цена педикюра", "wait", 1],
    ])
    expect(r.topicsKnown).toBe(1)
    expect(r.topicPercent).toBe(33)
  })
})

describe("money waits for «Подтвердить» — by the price rule's own detector", () => {
  it("knows a price, a discount, «бесплатно» and a promo code — in any type", () => {
    expect(namesMoney("Маникюр — 25 ₼")).toBe(true)
    expect(namesMoney("Первый визит со скидкой 10%")).toBe(true)
    expect(namesMoney("Pulsuz çatdırılma")).toBe(true)
    expect(namesMoney("Скидок нет")).toBe(false)
    expect(namesMoney("ул. Низами 54, 2 этаж")).toBe(false)
    expect(needsConfirmation("service", "Наращивание ресниц\nКлассика, 40 ₼")).toBe(true)
    expect(needsConfirmation("price", "уточняйте")).toBe(true)
    expect(needsConfirmation("hours", "Каждый день 10:00–21:00")).toBe(false)
  })
})

describe("a conversation's facts join the channel's knowledge", () => {
  const now = new Date("2026-11-15T12:00:00Z")
  const item = (over: Partial<ExistingItem>): ExistingItem => ({
    id: "k1", type: "price", title: "Педикюр", body: "30 ₼", status: "active", alternatives: null, removedAt: null, editedAt: null, seenCount: 3, ...over,
  })
  const fact = (over: Partial<Parameters<typeof planMerge>[1][number]>) => ({ type: "price" as const, title: "Педикюр", body: "30 ₼", sameAs: null, messageIndex: 2, ...over })

  it("creates new facts, a priced one waiting for confirmation", () => {
    const ops = planMerge([], [fact({}), fact({ type: "place", title: "Адрес", body: "ул. Низами 54" }), fact({ type: "place", title: "адрес", body: "дубль" })], now)
    expect(ops).toEqual([
      { op: "create", type: "price", title: "Педикюр", body: "30 ₼", status: "pending", messageIndex: 2 },
      { op: "create", type: "place", title: "Адрес", body: "ул. Низами 54", status: "active", messageIndex: 2 },
    ])
  })

  it("counts a fact said again instead of copying it", () => {
    expect(planMerge([item({})], [fact({ body: "30 ₼." })], now)).toEqual([{ op: "seen", id: "k1" }])
  })

  it("turns a different price into a conflict — even a confirmed one", () => {
    const ops = planMerge([item({ status: "active" })], [fact({ body: "35 ₼, с покрытием" })], now)
    expect(ops).toEqual([{
      op: "conflict", id: "k1",
      alternatives: [{ body: "30 ₼", seen: 3, lastSeenAt: "" }, { body: "35 ₼, с покрытием", seen: 1, lastSeenAt: now.toISOString() }],
    }])
  })

  it("follows people on other knowledge, but never over a person's edit, and never brings back a removed row", () => {
    const hours = item({ id: "h1", type: "hours", title: "Часы работы", body: "10–20" })
    expect(planMerge([hours], [fact({ type: "hours", title: "Часы работы", body: "10–21" })], now))
      .toEqual([{ op: "update", id: "h1", body: "10–21", status: "active" }])
    expect(planMerge([{ ...hours, editedAt: now }], [fact({ type: "hours", title: "Часы работы", body: "10–21" })], now))
      .toEqual([{ op: "seen", id: "h1" }])
    expect(planMerge([{ ...hours, removedAt: now }], [fact({ type: "hours", title: "Часы работы", body: "10–21" })], now)).toEqual([])
  })

  it("matches by the id the model gave, whatever it called the fact", () => {
    expect(planMerge([item({})], [fact({ title: "Pedikür", sameAs: "k1" })], now)).toEqual([{ op: "seen", id: "k1" }])
  })
})

describe("what the AI may state", () => {
  const row = (over: Partial<LearnedRow>): LearnedRow => ({ kind: "knowledge", type: "qa", title: "T", body: "B", status: "active", source: "learned", removedAt: null, ...over })

  it("puts only confirmed knowledge among the facts", () => {
    const text = composeLearnedKnowledge([
      row({ title: "Адрес", body: "ул. Низами 54" }),
      row({ type: "price", title: "Маникюр", body: "25 ₼", status: "pending" }),
      row({ type: "price", title: "Педикюр", body: "30 ₼", status: "conflict" }),
      row({ title: "Парковка", body: "во дворе", removedAt: new Date() }),
      row({ type: "price", title: "Снятие", body: "5 ₼" }),
    ])
    expect(text).toContain("- Адрес: ул. Низами 54")
    expect(text).toContain("- Снятие: 5 ₼")
    expect(text).not.toContain("25 ₼")
    expect(text).not.toContain("30 ₼")
    expect(text).not.toContain("Парковка")
    expect(composeLearnedKnowledge([row({ status: "pending" })])).toBe("")
  })

  it("keeps what a person added when learned rows overflow the block, and puts it first", () => {
    const learned = Array.from({ length: 40 }, (_, i) => row({ title: `Вопрос ${i}`, body: "ответ ".repeat(40) }))
    const text = composeLearnedKnowledge([
      ...learned,
      row({ type: "price", title: "Новый прайс", body: "Маникюр 40 ₼", source: "manual" }),
      row({ type: "price", title: "Ждёт", body: "77 ₼", status: "pending", source: "manual" }),
      row({ type: "price", title: "Спор", body: "88 ₼", status: "conflict" }),
    ])
    expect(text.split("\n")[1]).toBe("- Новый прайс: Маникюр 40 ₼")
    expect(text).toContain("- Вопрос 0:") // learned rows still fill what is left
    expect(text).not.toContain("- Вопрос 39:") // the block did overflow
    expect(text).not.toContain("77 ₼")
    expect(text).not.toContain("88 ₼")
  })

  it("lets a shorter row in after one that did not fit, and writes no empty block", () => {
    const text = composeLearnedKnowledge([
      row({ title: "Короткое 1", body: "a" }),
      row({ title: "Длинное", body: "x".repeat(200) }),
      row({ title: "Короткое 2", body: "b" }),
    ], 60)
    expect(text).toContain("- Короткое 1: a")
    expect(text).toContain("- Короткое 2: b")
    expect(text).not.toContain("Длинное")
    expect(composeLearnedKnowledge([row({ body: "x".repeat(200) })], 60)).toBe("")
  })

  it("writes the character as rules, phrases quoted", () => {
    const text = composeLearnedCharacter([
      row({ kind: "trait", type: "phrases", title: "Типичные фразы", body: "Buyurun\nSizi gözləyirik!" }),
      row({ kind: "trait", type: "tone", title: "Тон", body: "Тёплый, на «вы»" }),
      row({ kind: "trait", type: "emoji", title: "Эмодзи", body: "Без эмодзи.", removedAt: new Date() }),
    ])
    expect(text.indexOf("- Тон: Тёплый")).toBeLessThan(text.indexOf("- Типичные фразы: «Buyurun», «Sizi gözləyirik!»"))
    expect(text).not.toContain("Эмодзи")
  })
})

describe("the model's answers are read strictly", () => {
  it("accepts a comparison only in the agreed shape", () => {
    expect(parseComparison('{"verdict":"different","reason":"no_knowledge","topic":"Подарочные сертификаты"}'))
      .toEqual({ verdict: "different", reason: "no_knowledge", topic: "Подарочные сертификаты" })
    expect(parseComparison('```json\n{"verdict":"same","reason":"tone","topic":"Адрес"}\n```')).toEqual({ verdict: "same", reason: null, topic: "Адрес" })
    expect(parseComparison('{"verdict":"maybe"}')).toBeNull()
    expect(parseComparison("Ответы похожи")).toBeNull()
  })

  it("drops facts about this customer and unknown ids", () => {
    const facts = parseExtraction(JSON.stringify({ knowledge: [
      { type: "price", title: "Маникюр", body: "25 ₼", same_as: "k1", message: 2 },
      { type: "qa", title: "Запись", body: "Записала вас, [PERSON_1], на 16:30", same_as: null, message: 4 },
      { type: "weird", title: "Парковка", body: "во дворе", same_as: "not-ours" },
    ] }), new Set(["k1"]))
    expect(facts).toEqual([
      { type: "price", title: "Маникюр", body: "25 ₼", sameAs: "k1", messageIndex: 2 },
      { type: "other", title: "Парковка", body: "во дворе", sameAs: null, messageIndex: null },
    ])
    expect(parseExtraction("no json", new Set())).toBeNull()
  })

  it("reads character, phrases without placeholders", () => {
    expect(parseCharacter('{"tone":"Тёплый","address":"По имени","phrases":["Buyurun","Zəng edin [PHONE_1]"],"avoid":null}'))
      .toEqual({ tone: "Тёплый", address: "По имени", phrases: "Buyurun" })
  })

  it("counts length, language and emoji instead of asking a model", () => {
    const m = measuredCharacter(["Salam! Buyurun 🙂", "Здравствуйте, 25 ₼", "Sizi gözləyirik 🌸", "Thank you, see you"])!
    expect(m.length).toMatch(/^Коротко/)
    expect(m.language).toContain("русский 25%")
    expect(m.language).toContain("азербайджанский 50%")
    expect(m.language).toContain("английский 25%")
    expect(m.emoji).toMatch(/^Часто: /)
  })
})
