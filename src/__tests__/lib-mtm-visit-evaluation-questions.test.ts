/**
 * The company's own questions a manager rates an agent by on a joint visit
 * (src/lib/mtm/visit-evaluation-questions.ts, owner 2026-10-21). The rules a
 * stored list and a stored rating are read by: what a bad list becomes, what
 * a rating without a list of its own was given against, and which scores a
 * rating's own list lets through.
 */
import { describe, expect, it } from "vitest"
import {
  MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS,
  MTM_VISIT_EVALUATION_QUESTION_DEFAULTS,
  coerceMtmVisitEvaluationQuestions,
  newVisitEvaluationQuestionId,
  parseMtmVisitEvaluationQuestions,
  readVisitEvaluationQuestionSnapshot,
  readVisitEvaluationScores,
  renameVisitEvaluationQuestion,
  visitEvaluationAverage,
  visitEvaluationQuestionLabel,
} from "@/lib/mtm/visit-evaluation-questions"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { storedVisitEvaluation, visitEvaluationScoresAgainst } from "@/lib/mtm/joint-visit"

const ORIGINAL_IDS = ["PREPARATION", "RAPPORT", "NEEDS", "PRESENTATION", "OBJECTIONS", "CLOSING"]

describe("the company's list of evaluation questions", () => {
  it("starts as the six questions every company had, in their order", () => {
    expect(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS.map((question) => question.id)).toEqual(ORIGINAL_IDS)
    expect(MTM_VISIT_EVALUATION_QUESTION_DEFAULTS).toEqual(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)
    expect(MTM_SETTING_DEFAULTS.visitEvaluationQuestions).toEqual(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)
    // The words ratings from before the lists are read by.
    expect(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS.map((question) => question.labels.ru)).toEqual([
      "Подготовка к визиту", "Контакт с клиентом", "Выявление потребностей", "Презентация препарата", "Работа с возражениями", "Договорённость в конце",
    ])
  })

  it("fills a language left empty from the one written, and refuses a list that does not read", () => {
    const parsed = parseMtmVisitEvaluationQuestions([{ id: "q-1", labels: { ru: "  Работа  с образцами ", az: "", en: "" } }])
    expect(parsed).toEqual({ success: true, data: [{ id: "q-1", labels: { az: "Работа с образцами", ru: "Работа с образцами", en: "Работа с образцами" } }] })

    const refused = [
      "not a list",
      [],
      [{ id: "q-1", labels: { ru: "A" } }, { id: "q-1", labels: { ru: "B" } }],
      [{ id: "has space", labels: { ru: "A" } }],
      [{ id: "q-1", labels: { ru: "", az: " ", en: "" } }],
      [{ id: "q-1", labels: { ru: "x".repeat(81) } }],
      Array.from({ length: 21 }, (_, index) => ({ id: `q-${index}`, labels: { ru: `Вопрос ${index}` } })),
    ]
    for (const bad of refused) expect(parseMtmVisitEvaluationQuestions(bad).success).toBe(false)
    // What the app reads from a stored row that does not read: the defaults.
    expect(coerceMtmVisitEvaluationQuestions([])).toEqual(MTM_VISIT_EVALUATION_QUESTION_DEFAULTS)
    expect(coerceMtmVisitEvaluationQuestions(null)).toEqual(MTM_VISIT_EVALUATION_QUESTION_DEFAULTS)
  })

  it("reads a rating without a list of its own against the original six, and one with a list against that list", () => {
    expect(readVisitEvaluationQuestionSnapshot(null)).toEqual(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)
    const own = [{ id: "q-1", labels: { az: "Nümunələr", ru: "Образцы", en: "Samples" } }]
    expect(readVisitEvaluationQuestionSnapshot(own)).toEqual(own)

    // Scores count only on the rating's own list.
    expect(storedVisitEvaluation({ scores: { PREPARATION: 4, "q-1": 5 }, questions: null }))
      .toEqual({ questions: MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS, scores: { PREPARATION: 4 }, average: 4 })
    expect(storedVisitEvaluation({ scores: { PREPARATION: 4, "q-1": 5 }, questions: own }))
      .toEqual({ questions: own, scores: { "q-1": 5 }, average: 5 })
    expect(readVisitEvaluationScores({ "q-1": 6, PREPARATION: 2.5 }, [{ id: "q-1" }, { id: "PREPARATION" }])).toEqual({})
    expect(visitEvaluationAverage({ a: 4, b: 5, c: 4 })).toBe(4.3)
    expect(visitEvaluationAverage({})).toBeNull()
  })

  it("lets a new rating through only on the questions the company asks today", () => {
    const today = [{ id: "RAPPORT", labels: { az: "a", ru: "b", en: "c" } }, { id: "q-1", labels: { az: "a", ru: "b", en: "c" } }]
    expect(visitEvaluationScoresAgainst({ RAPPORT: 4, "q-1": 3 }, today)).toEqual({ ok: true, scores: { RAPPORT: 4, "q-1": 3 } })
    expect(visitEvaluationScoresAgainst({ RAPPORT: 4, OBJECTIONS: 3 }, today)).toEqual({ ok: false, unknown: ["OBJECTIONS"] })
  })

  it("renames in one language and carries the rename to a language that was never translated", () => {
    const untranslated = { az: "Yeni sual", ru: "Yeni sual", en: "Yeni sual" }
    expect(renameVisitEvaluationQuestion(untranslated, "ru", "Образцы")).toEqual({ az: "Образцы", ru: "Образцы", en: "Образцы" })
    const translated = MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS[0].labels
    expect(renameVisitEvaluationQuestion(translated, "ru", "Подготовка и материалы"))
      .toEqual({ az: "Vizitə hazırlıq", ru: "Подготовка и материалы", en: "Visit preparation" })
    expect(visitEvaluationQuestionLabel({ labels: translated }, "az")).toBe("Vizitə hazırlıq")
    expect(visitEvaluationQuestionLabel({ labels: translated }, "en-US")).toBe("Visit preparation")
    expect(visitEvaluationQuestionLabel({ labels: translated }, "de")).toBe("Подготовка к визиту")
  })

  it("gives an added question an id no deleted one had", () => {
    const first = newVisitEvaluationQuestionId(1_000, 0.1)
    const second = newVisitEvaluationQuestionId(1_001, 0.1)
    expect(first).toMatch(/^q-[a-z0-9]+$/)
    expect(first).not.toBe(second)
    expect(parseMtmVisitEvaluationQuestions([{ id: first, labels: { ru: "x" } }]).success).toBe(true)
  })
})
