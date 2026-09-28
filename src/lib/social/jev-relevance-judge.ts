import { PiiMasker } from "@/lib/ai/pii-masker"
import type { AiRelevanceVerdict } from "@/lib/social/ai-relevance-judge"

/**
 * The relevance judge on Jev (TypeSafe AI) — owner decision, 2026-09-28:
 * "Jev wherever it copes."
 *
 * Measured before it was wired (docs/social-relevance-benchmark.md): on 2204
 * production records it agrees with the hard evidence 99% of the time when its
 * own confidence is 0.9 or above, and is a coin flip below 0.7. That number is
 * the whole reason to use it — none of our other classifiers say how sure they
 * are — and it is why the caller restores a record only above the threshold.
 *
 * The owner named two limits, and both are enforced here rather than hoped for:
 *
 * 1. **It may not answer.** The benchmark saw `529 system_overloaded` and
 *    timeouts (9 of 2204 on the first pass). This module never throws and
 *    never retries more than once: it returns a verdict or an error class, and
 *    the pass leaves the record exactly as it was. The judge only ever adds a
 *    second signal, so a silent provider costs nothing but a second look on
 *    the next pass.
 * 2. **It cannot read pictures.** A record whose own text is an Instagram
 *    image caption of three words — or OCR noise from the picture — carries no
 *    evidence a text model can weigh. Those are refused here with `NO_TEXT`
 *    instead of being answered confidently from a brand name that happens to
 *    sit in the parent publication.
 */

const API_URL = process.env.JEV_API_URL ?? "https://api.typesafe.ai/v1/systemone"
const MODEL = process.env.JEV_MODEL ?? "jev-latest"
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Below this many letters and digits of the record's OWN text there is nothing
 * to judge. Chosen from the corpus: "Yau he he" (7) and price-list OCR are the
 * shapes that produced confident nonsense, while the shortest genuine opinions
 * in the sample ("halal olsun Araz markete") clear it comfortably.
 */
const MIN_JUDGEABLE_CHARACTERS = 12

export type JevRelevanceInput = Readonly<{
  text: string
  parentText?: string | null
  platform: string
  contentKind?: string | null
  authorName?: string | null
  authorHandle?: string | null
  subjectName: string
  subjectType?: string | null
  aliases: readonly string[]
  requiredContext: readonly string[]
  negativeTerms: readonly string[]
  /** Where the brand operates and in which languages — configured per subject. */
  geographies: readonly string[]
  languages: readonly string[]
}>

export type JevRelevanceResult = Readonly<{
  verdict: AiRelevanceVerdict | null
  /** 0..1, as Jev reports it. Null whenever there is no verdict. */
  confidence: number | null
  errorClass: "NO_TEXT" | "MISSING_KEY" | "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_RESPONSE" | null
}>

export const JEV_RELEVANCE_JUDGE_VERSION = "jev_relevance_judge_v1"

/** Letters and digits only: emoji, punctuation and whitespace are not evidence. */
export function judgeableCharacters(text: string | null | undefined): number {
  return (String(text ?? "").match(/[\p{L}\p{N}]/gu) ?? []).length
}

export function hasEnoughTextToJudge(text: string | null | undefined): boolean {
  return judgeableCharacters(text) >= MIN_JUDGEABLE_CHARACTERS
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function buildRequest(input: JevRelevanceInput): Record<string, unknown> {
  const masker = new PiiMasker()
  const author = [input.authorName, input.authorHandle]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" / ")

  return {
    model: MODEL,
    state: {
      brand: input.subjectName,
      brand_kind: input.subjectType ?? null,
      known_spellings: input.aliases.slice(0, 40),
      confirming_context_words: input.requiredContext,
      different_subject_words: input.negativeTerms,
      // Without these, a shop of the same name in another country reads as the
      // monitored chain — measured, not hypothetical.
      brand_operates_in: input.geographies,
      brand_languages: input.languages,
      platform: input.platform,
      content_kind: input.contentKind ?? null,
      author: author ? masker.mask(truncate(author, 120)) : null,
      parent_publication: input.parentText?.trim()
        ? masker.mask(truncate(input.parentText.trim(), 600))
        : null,
      record: masker.mask(truncate(input.text.trim(), 1200)),
    },
    questions: {
      relevance: {
        type: "choice",
        instructions:
          "Decide whether this social media record is about the monitored brand in `brand`. "
          + "The brand name may be absent: judge by meaning, not by string overlap. "
          + "A business of the same name outside `brand_operates_in` is a different subject. "
          + "Prefer unsure over guessing — a wrong about_subject puts noise into a client's feed.",
        criteria: {
          about_subject:
            "The record discusses this brand, its products, staff, branches, prices or service, "
            + "including a comment addressed to the brand under its own publication, or a complaint "
            + "that names no company but clearly continues a conversation about it.",
          not_about_subject:
            "The record is about someone else with a similar name, about an unrelated topic, "
            + "or is generic spam.",
          unsure:
            "The text is too short, too vague, or could plausibly be either.",
        },
      },
    },
  }
}

function parseVerdict(value: unknown): AiRelevanceVerdict | null {
  return value === "about_subject" || value === "not_about_subject" || value === "unsure"
    ? value
    : null
}

async function askOnce(
  input: JevRelevanceInput,
  apiKey: string,
): Promise<JevRelevanceResult | "retry"> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildRequest(input)),
      signal: controller.signal,
    })
    // Overload and rate limiting are worth one more try; a rejected request is
    // not going to become valid by repeating it.
    if (response.status === 429 || response.status >= 500) return "retry"
    if (!response.ok) return { verdict: null, confidence: null, errorClass: "PROVIDER_ERROR" }

    const payload = await response.json() as {
      answers?: { relevance?: { choice?: unknown; confidence?: unknown } }
    }
    const answer = payload.answers?.relevance
    const verdict = parseVerdict(answer?.choice)
    if (!verdict) return { verdict: null, confidence: null, errorClass: "INVALID_RESPONSE" }
    return {
      verdict,
      confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
      errorClass: null,
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError"
    return aborted ? "retry" : { verdict: null, confidence: null, errorClass: "PROVIDER_ERROR" }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One judgement. Never throws: the caller is a background pass whose correct
 * behaviour on any failure is to leave the record alone and look again later.
 */
export async function judgeSubjectRelevanceWithJev(
  input: JevRelevanceInput,
): Promise<JevRelevanceResult> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) return { verdict: null, confidence: null, errorClass: "MISSING_KEY" }
  // A picture is not text. The parent publication is deliberately not counted:
  // the brand is usually named there, and judging the comment by its parent is
  // how "Yau he he" became a confident "about_subject" in the benchmark.
  if (!hasEnoughTextToJudge(input.text)) {
    return { verdict: null, confidence: null, errorClass: "NO_TEXT" }
  }

  const first = await askOnce(input, apiKey)
  if (first !== "retry") return first
  const second = await askOnce(input, apiKey)
  if (second !== "retry") return second
  return { verdict: null, confidence: null, errorClass: "TIMEOUT" }
}

/**
 * How sure Jev has to be before a rejected record is put back in a client's
 * feed. 0.9 is where the benchmark measured 99% agreement; below 0.7 it is a
 * coin flip, and the cost of a wrong restore is noise the client has to read.
 */
export const JEV_RESTORE_CONFIDENCE = Number(process.env.JEV_RESTORE_CONFIDENCE ?? 0.9)

export function jevVerdictIsTrustworthy(result: JevRelevanceResult): boolean {
  return result.verdict === "about_subject"
    && typeof result.confidence === "number"
    && result.confidence >= JEV_RESTORE_CONFIDENCE
}
