import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { PiiMasker } from "@/lib/ai/pii-masker"

/**
 * ИИ-судья релевантности (#646).
 *
 * Решение «про наш бренд или нет» сегодня принимает сверка строк, и её
 * крупнейший класс отбраковки — `no_monitoring_subject_match`: площадка нашла
 * запись по слову, но самого бренда в тексте нет (прод, brandprotection: 9462
 * записи, 8425 из них в Instagram). Все они уже оплачены.
 *
 * Судья работает по УЖЕ собранному и не делает ни одного нового платного
 * запроса к провайдеру. Его вердикт — вход для решения о ленте, поэтому
 * модуль намеренно возвращает «не уверен» вместо догадки: цена ложного
 * «про нас» — мусор в ленте клиента, а это хуже пропущенной находки.
 */
// v2: запрет на рассуждение в промпте + начатый ответ. Версия едет вместе с
// вердиктом, поэтому смена формулировки обязана её сдвинуть.
export const AI_RELEVANCE_JUDGE_VERSION = "ai_relevance_judge_v2"

export type AiRelevanceVerdict = "about_subject" | "not_about_subject" | "unsure"

export type AiRelevanceJudgeErrorClass =
  | "MISSING_KEY"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTHENTICATION"
  | "UPSTREAM"
  | "INVALID_RESPONSE"
  | "UNKNOWN"

export type AiRelevanceJudgeResult = {
  verdict: AiRelevanceVerdict | null
  errorClass: AiRelevanceJudgeErrorClass | null
  version: string
}

export type AiRelevanceJudgeInput = {
  /** Текст самой записи (пост или комментарий). */
  text: string
  platform: string
  /** Автор: иногда бренд опознаётся именно по нему. */
  authorName?: string | null
  authorHandle?: string | null
  /** Текст родительской публикации для комментария. */
  parentText?: string | null
  /** Название объекта мониторинга. */
  subjectName: string
  /** Известные написания и синонимы. */
  aliases?: string[]
  /** Слова, без которых неоднозначный алиас не считается совпадением. */
  requiredContext?: string[]
  /** Слова, означающие, что речь о другом. */
  negativeTerms?: string[]
}

interface JudgeTextBlock {
  type?: string
  text?: string
}

function errorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function classifyJudgeError(error: unknown, aborted: boolean): AiRelevanceJudgeErrorClass {
  const details = errorRecord(error)
  const name = typeof details.name === "string" ? details.name : ""
  const status = typeof details.status === "number" ? details.status : null
  if (aborted || /(?:abort|timeout)/iu.test(name)) return "TIMEOUT"
  if (status === 429) return "RATE_LIMIT"
  if (status === 401 || status === 403) return "AUTHENTICATION"
  if (status !== null && status >= 500) return "UPSTREAM"
  return "UNKNOWN"
}

function boundedList(values: string[] | undefined, limit: number): string[] {
  return Array.from(new Set((values ?? [])
    .map(value => value.trim())
    .filter(Boolean)))
    .slice(0, limit)
}

/**
 * Подсказка судье. Ключевые свойства:
 *  - три исхода, «не уверен» — полноценный ответ, а не отказ;
 *  - явно перечислены случаи, которые сверка строк не умеет: упоминание без
 *    названия, обращение к бренду в комментарии, однофамильцы;
 *  - «не про нас» требуется утверждать так же уверенно, как «про нас», иначе
 *    судья превращается в машину, всё одобряющую.
 */
export function buildRelevanceJudgePrompt(input: AiRelevanceJudgeInput): string {
  const aliases = boundedList(input.aliases, 20)
  const requiredContext = boundedList(input.requiredContext, 20)
  const negativeTerms = boundedList(input.negativeTerms, 20)
  return [
    `You decide whether a social media record is about one specific monitored brand.`,
    ``,
    `Brand: ${input.subjectName}`,
    aliases.length > 0 ? `Known spellings and synonyms: ${aliases.join(", ")}` : null,
    requiredContext.length > 0
      ? `Context words that confirm the brand when its name is ambiguous: ${requiredContext.join(", ")}`
      : null,
    negativeTerms.length > 0
      ? `Words meaning a different subject with a similar name: ${negativeTerms.join(", ")}`
      : null,
    ``,
    `The brand name may be absent from the text. Judge by meaning, not by string overlap.`,
    `Answer about_subject when the record discusses this brand, its products, staff,`,
    `branches, prices or service — including a comment addressed to the brand under`,
    `its own publication, or a complaint that names no company at all but clearly`,
    `continues a conversation about it.`,
    `Answer not_about_subject when the record is about someone else with a similar`,
    `name, about an unrelated topic, or is generic spam.`,
    `Answer unsure when the text is too short, too vague, or could plausibly be either.`,
    `Prefer unsure over guessing: a wrong about_subject puts noise into a client's feed.`,
    ``,
    `Respond with exactly one lowercase word: about_subject, not_about_subject, or unsure.`,
    // Замер на проде 2026-08-03 показал, зачем это сказано трижды: без запрета
    // на рассуждение Haiku начинает с «The record is too short…», и обрезка по
    // max_tokens оставляла от ответа одну преамбулу — вердикт не доезжал.
    `Do not explain. Do not restate the record. Output the single word and nothing else.`,
  ].filter(value => value !== null).join("\n")
}

/**
 * Ответ, начатый за модель: продолжение после «verdict:» практически не
 * оставляет ей места на вступление. Без пробела на конце — иначе API отвергнет
 * сообщение.
 */
const JUDGE_ANSWER_PREFILL = "verdict:"

/**
 * Вердикт из ответа модели.
 *
 * Строгое равенство не годится: даже с запретом на рассуждение ответ приходит то
 * с точкой, то в кавычках, то с остатком вступления. Берём первое встреченное
 * слово-вердикт, а не первое совпадение из списка, — иначе порядок проверок
 * решал бы за модель («not_about_subject» содержит «about_subject» как
 * подстроку, поэтому сравниваем позиции, а не наличие).
 */
export function parseJudgeVerdict(answer: string): AiRelevanceVerdict | null {
  const value = String(answer ?? "").toLowerCase()
  let best: { verdict: AiRelevanceVerdict; at: number } | null = null
  for (const verdict of ["not_about_subject", "about_subject", "unsure"] as const) {
    const at = value.indexOf(verdict)
    if (at < 0) continue
    // «not_about_subject» начинается раньше, чем вложенный в него
    // «about_subject», поэтому при равенстве по позиции побеждает более
    // раннее начало, то есть более длинный вердикт.
    if (!best || at < best.at) best = { verdict, at }
  }
  return best?.verdict ?? null
}

function buildJudgeMessage(input: AiRelevanceJudgeInput, masker: PiiMasker): string {
  const truncate = (value: string, limit: number) => (
    value.length > limit ? `${value.slice(0, limit)}…` : value
  )
  const author = [input.authorName, input.authorHandle]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(" / ")
  return [
    `Platform: ${input.platform}`,
    author ? `Author: ${masker.mask(truncate(author, 120))}` : null,
    input.parentText?.trim()
      ? `Parent publication: ${masker.mask(truncate(input.parentText.trim(), 600))}`
      : null,
    `Record: ${masker.mask(truncate(input.text.trim(), 1200))}`,
  ].filter(value => value !== null).join("\n")
}

/**
 * Один ограниченный вызов классификатора. Ретраев внутри нет намеренно:
 * состояние повторов держит вызывающий воркер, а AbortSignal гарантирует,
 * что истёкший по таймауту запрос не занимает слот провайдера после конца
 * лизы крона. Тот же контракт, что у ИИ-триажа тональности.
 */
export async function judgeSubjectRelevance(
  input: AiRelevanceJudgeInput,
  options: { logErrors?: boolean; timeoutMs?: number } = {},
): Promise<AiRelevanceJudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { verdict: null, errorClass: "MISSING_KEY", version: AI_RELEVANCE_JUDGE_VERSION }
  }
  if (!input.text?.trim() || !input.subjectName?.trim()) {
    return { verdict: null, errorClass: "INVALID_INPUT", version: AI_RELEVANCE_JUDGE_VERSION }
  }

  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 45_000, 120_000))
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  timeout.unref?.()

  try {
    const client = getAnthropicClient({ apiKey, timeout: timeoutMs, maxRetries: 0 })
    const masker = new PiiMasker()
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      // 16 вместо 8: вердикт длиной в три токена плюс возможные кавычки или
      // точка. Дешевле, чем повторный вызов из-за обрезанного ответа.
      max_tokens: 16,
      system: buildRelevanceJudgePrompt(input),
      messages: [
        { role: "user", content: buildJudgeMessage(input, masker) },
        { role: "assistant", content: JUDGE_ANSWER_PREFILL },
      ],
    }, { signal: abortController.signal })
    const answer = response.content
      .map(block => {
        if (block.type !== "text" || !("text" in block)) return ""
        const text = (block as JudgeTextBlock).text
        return typeof text === "string" ? text : ""
      })
      .join("")
      .trim()
      .toLowerCase()
    const verdict = parseJudgeVerdict(answer)
    if (verdict) return { verdict, errorClass: null, version: AI_RELEVANCE_JUDGE_VERSION }
    return { verdict: null, errorClass: "INVALID_RESPONSE", version: AI_RELEVANCE_JUDGE_VERSION }
  } catch (error) {
    if (options.logErrors !== false) console.error("[ai-relevance-judge] failed:", error)
    return {
      verdict: null,
      errorClass: classifyJudgeError(error, abortController.signal.aborted),
      version: AI_RELEVANCE_JUDGE_VERSION,
    }
  } finally {
    clearTimeout(timeout)
  }
}
