/**
 * What a manager rates on a joint visit — the company's own list (MTM setting
 * `visitEvaluationQuestions`). Owner, 2026-10-21: «Сделать вопросы оценки
 * агента редактируемыми для каждой компании?» — «Да, в параметрах MTM»; the
 * mockup approved the same day: a question is added, renamed, moved up or
 * down and deleted, with buttons that say so.
 *
 * Every rating keeps the list it was given against (`MtmVisitEvaluation.questions`),
 * ids and texts, so a question renamed or deleted later changes no rating
 * already given: the visit card and the agent's page read the rating's own
 * list. A new rating is checked against the company's list of today.
 *
 * Kept free of server imports: the settings page and the rating views read it
 * too. The rest of the joint visit lives in src/lib/mtm/joint-visit.ts.
 */

export type MtmVisitEvaluationQuestionLabels = { az: string; ru: string; en: string }
export type MtmVisitEvaluationQuestion = { id: string; labels: MtmVisitEvaluationQuestionLabels }
/** `{ PREPARATION: 4, … }` — the rated questions only, each 1..5; a skipped one is absent. */
export type MtmVisitEvaluationScores = Record<string, number>

type Language = keyof MtmVisitEvaluationQuestionLabels
const LANGUAGES: readonly Language[] = ["az", "ru", "en"]

export const MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT = 20
export const MTM_VISIT_EVALUATION_QUESTION_MAX_LENGTH = 80

/**
 * The six questions every company rated by before the list became its own
 * (owner-approved mockup, 2026-10-20). FROZEN: a rating saved before
 * 2026-10-21 carries no list of its own and is read against exactly these —
 * change a word here and those ratings change with it. A company's list
 * starts as a copy and is edited from there.
 */
export const MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS: readonly MtmVisitEvaluationQuestion[] = [
  { id: "PREPARATION", labels: { az: "Vizitə hazırlıq", ru: "Подготовка к визиту", en: "Visit preparation" } },
  { id: "RAPPORT", labels: { az: "Müştəri ilə ünsiyyət", ru: "Контакт с клиентом", en: "Rapport with the client" } },
  { id: "NEEDS", labels: { az: "Ehtiyacların aşkarlanması", ru: "Выявление потребностей", en: "Finding out needs" } },
  { id: "PRESENTATION", labels: { az: "Preparatın təqdimatı", ru: "Презентация препарата", en: "Product presentation" } },
  { id: "OBJECTIONS", labels: { az: "Etirazlarla iş", ru: "Работа с возражениями", en: "Handling objections" } },
  { id: "CLOSING", labels: { az: "Sonda razılaşma", ru: "Договорённость в конце", en: "Agreement at the end" } },
]

export const MTM_VISIT_EVALUATION_QUESTION_DEFAULTS: MtmVisitEvaluationQuestion[] = copyQuestions(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/

function copyQuestions(questions: readonly MtmVisitEvaluationQuestion[]): MtmVisitEvaluationQuestion[] {
  return questions.map((question) => ({ id: question.id, labels: { ...question.labels } }))
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

/**
 * The three texts of a question. A language left empty takes the text of one
 * that is not: a question written in Russian only still reads as itself to a
 * manager whose phone is in Azerbaijani. Null when there is no text at all.
 */
function readLabels(value: unknown): MtmVisitEvaluationQuestionLabels | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const raw = { az: cleanLabel(record.az), ru: cleanLabel(record.ru), en: cleanLabel(record.en) }
  const fallback = raw.ru || raw.az || raw.en
  if (!fallback) return null
  return { az: raw.az || fallback, ru: raw.ru || fallback, en: raw.en || fallback }
}

/** The text in the reader's language: az and en as such, anything else Russian. */
export function visitEvaluationQuestionLabel(question: Pick<MtmVisitEvaluationQuestion, "labels">, locale: string): string {
  const language: Language = locale.startsWith("az") ? "az" : locale.startsWith("en") ? "en" : "ru"
  return question.labels[language] || question.labels.ru || question.labels.az || question.labels.en
}

export type MtmVisitEvaluationQuestionsParse =
  | { success: true; data: MtmVisitEvaluationQuestion[] }
  | { success: false; error: string }

/** Strict form for the settings PUT: a bad list is refused, not trimmed. */
export function parseMtmVisitEvaluationQuestions(raw: unknown): MtmVisitEvaluationQuestionsParse {
  if (!Array.isArray(raw)) return { success: false, error: "Evaluation questions must be a list" }
  if (raw.length < 1) return { success: false, error: "Keep at least one evaluation question" }
  if (raw.length > MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT) {
    return { success: false, error: `At most ${MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT} evaluation questions` }
  }
  const ids = new Set<string>()
  const result: MtmVisitEvaluationQuestion[] = []
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { success: false, error: "Every evaluation question must be an object" }
    }
    const entry = value as Record<string, unknown>
    const id = typeof entry.id === "string" ? entry.id.trim() : ""
    if (!ID_PATTERN.test(id) || ids.has(id)) return { success: false, error: "Evaluation question ids must be unique" }
    ids.add(id)
    const labels = readLabels(entry.labels)
    if (!labels) return { success: false, error: "Every evaluation question needs its text" }
    if (LANGUAGES.some((language) => labels[language].length > MTM_VISIT_EVALUATION_QUESTION_MAX_LENGTH)) {
      return { success: false, error: `An evaluation question is at most ${MTM_VISIT_EVALUATION_QUESTION_MAX_LENGTH} characters` }
    }
    result.push({ id, labels })
  }
  return { success: true, data: result }
}

/** A stored setting as the app reads it: anything that is not a valid list is the defaults. */
export function coerceMtmVisitEvaluationQuestions(raw: unknown): MtmVisitEvaluationQuestion[] {
  const parsed = parseMtmVisitEvaluationQuestions(raw)
  return parsed.success ? parsed.data : copyQuestions(MTM_VISIT_EVALUATION_QUESTION_DEFAULTS)
}

/**
 * The list a stored rating was given against. A rating from before the lists
 * (`questions` is null) was given against the original six. Entries that do
 * not read are left out; a list with none left is the original six too.
 */
export function readVisitEvaluationQuestionSnapshot(raw: unknown): MtmVisitEvaluationQuestion[] {
  if (!Array.isArray(raw)) return copyQuestions(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)
  const ids = new Set<string>()
  const result: MtmVisitEvaluationQuestion[] = []
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    const id = typeof entry.id === "string" ? entry.id : ""
    const labels = readLabels(entry.labels)
    if (!id || ids.has(id) || !labels) continue
    ids.add(id)
    result.push({ id, labels })
  }
  return result.length ? result : copyQuestions(MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS)
}

/** Only the questions of `questions` with a 1..5 integer; anything else in a stored row is ignored. */
export function readVisitEvaluationScores(
  value: unknown,
  questions: readonly Pick<MtmVisitEvaluationQuestion, "id">[],
): MtmVisitEvaluationScores {
  const scores: MtmVisitEvaluationScores = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return scores
  for (const { id } of questions) {
    const score = (value as Record<string, unknown>)[id]
    if (typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5) scores[id] = score
  }
  return scores
}

/** The mean of the rated questions, to one decimal; null when none is rated. */
export function visitEvaluationAverage(scores: MtmVisitEvaluationScores): number | null {
  const values = Object.values(scores).filter((score) => typeof score === "number")
  if (!values.length) return null
  return Math.round((values.reduce((sum, score) => sum + score, 0) / values.length) * 10) / 10
}

/**
 * A question renamed in one language. Another language that still carried the
 * very same text was never translated, so it follows; a translation somebody
 * actually wrote is not touched (as renameRouteTarget does for planner buttons).
 */
export function renameVisitEvaluationQuestion(
  labels: MtmVisitEvaluationQuestionLabels,
  language: Language,
  value: string,
): MtmVisitEvaluationQuestionLabels {
  const previous = labels[language]
  const next = { ...labels, [language]: value }
  for (const other of LANGUAGES) {
    if (other !== language && labels[other] === previous) next[other] = value
  }
  return next
}

/** An id for a question added on the settings page; never one of a deleted question. */
export function newVisitEvaluationQuestionId(now = Date.now(), random = Math.random()): string {
  return `q-${now.toString(36)}${Math.floor(random * 36 ** 4).toString(36).padStart(4, "0")}`
}
