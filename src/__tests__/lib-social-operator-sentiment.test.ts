import { describe, expect, it } from "vitest"
import {
  hasOperatorSentiment,
  operatorSentimentCorrection,
  withOperatorSentimentStamp,
} from "@/lib/social/operator-sentiment"

/**
 * Прод 2026-08-04. Владелец спросил, происходит ли обучение, когда он меняет
 * негатив на нейтрал. Не происходило, и правка вообще не держалась: приём писал
 * тональность безусловно, поэтому очередной сбор той же записи возвращал старую
 * метку. Эти тесты закрепляют и провенанс, и защиту от перезаписи.
 */
describe("правка тональности оператором", () => {
  const at = new Date("2026-08-04T07:58:00.000Z")

  it("метит правку кем, когда и из какого значения", () => {
    const metadata = withOperatorSentimentStamp({
      sourceMetadata: { socialTriage: { language: "az" }, phoneLead: { status: "duplicate_linked" } },
      sentimentBefore: "negative",
      sentimentAfter: "neutral",
      actorId: "user-1",
      at,
    })

    expect(metadata).toMatchObject({
      // Чужие ключи метаданных сохраняются: их пишут другие подсистемы.
      phoneLead: { status: "duplicate_linked" },
      socialTriage: {
        language: "az",
        sentimentSource: "operator",
        sentimentBefore: "negative",
        sentimentAfter: "neutral",
        sentimentCorrectedAt: "2026-08-04T07:58:00.000Z",
        sentimentCorrectedBy: "user-1",
      },
    })
  })

  it("признаёт закреплённую тональность и не путает её с обычной находкой", () => {
    const corrected = withOperatorSentimentStamp({
      sourceMetadata: {},
      sentimentBefore: "negative",
      sentimentAfter: "neutral",
      actorId: null,
      at,
    })

    expect(hasOperatorSentiment(corrected)).toBe(true)
    expect(hasOperatorSentiment({ socialTriage: { language: "az" } })).toBe(false)
    expect(hasOperatorSentiment({ socialTriage: { sentimentSource: "AI" } })).toBe(false)
  })

  it.each([
    ["ничего", null],
    ["мусор вместо объекта", "not an object"],
    ["число в socialTriage", { socialTriage: 42 }],
    ["пустой объект", {}],
  ])("не роняется на %s", (_label, metadata) => {
    expect(hasOperatorSentiment(metadata)).toBe(false)
    expect(operatorSentimentCorrection(metadata)).toBeNull()
  })

  it("разбирает отметку для замеров", () => {
    const metadata = withOperatorSentimentStamp({
      sourceMetadata: {},
      sentimentBefore: "negative",
      sentimentAfter: "positive",
      actorId: "user-2",
      at,
    })

    expect(operatorSentimentCorrection(metadata)).toEqual({
      before: "negative",
      after: "positive",
      correctedAt: "2026-08-04T07:58:00.000Z",
      correctedBy: "user-2",
    })
  })

  it("пустые значения в отметке не превращаются в строки", () => {
    const metadata = withOperatorSentimentStamp({
      sourceMetadata: {},
      sentimentBefore: null,
      sentimentAfter: "neutral",
      actorId: null,
      at,
    })

    expect(operatorSentimentCorrection(metadata)).toMatchObject({
      before: null,
      correctedBy: null,
      after: "neutral",
    })
  })
})
