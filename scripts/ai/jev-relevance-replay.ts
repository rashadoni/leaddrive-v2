/**
 * Offline replay of the social-relevance decision through Jev (TypeSafe AI).
 *
 * Why this exists. "Is this record about our brand" is the decision our string
 * matcher is worst at, and the Haiku judge written for it (#646) has never run
 * in production — there is not a single stored verdict. Jev is a typed decision
 * model: schema in, one label plus calibrated confidence out. Before it goes
 * anywhere near the product, the only question worth answering is whether it is
 * any good on OUR records.
 *
 * What this is NOT. Nothing here writes to the CRM, calls a production route,
 * or changes a stored decision. It reads a corpus file exported from the
 * production database and writes a report next to it.
 *
 * What counts as truth. The matcher's own MATCHED/REJECTED is NOT truth — it is
 * the thing under test, and the ambiguous class is exactly where it is known to
 * be unreliable. So the script separates three references:
 *
 *   - `literal`   the brand or one of its aliases appears in the text. A record
 *                 that names the brand is about it in all but pathological
 *                 cases, so disagreement here is a real Jev error.
 *   - `excluded`  a negative alias or exclusion term appears and no positive
 *                 alias does — the "someone else with a similar name" class.
 *   - `unknown`   neither. This is the interesting majority: no reference
 *                 exists, so the script reports the distribution and writes a
 *                 hand-labelling sheet instead of pretending to score it.
 *
 * Usage:
 *   npx tsx scripts/ai/jev-relevance-replay.ts --dry-run
 *   TYPESAFE_API_KEY=... npx tsx scripts/ai/jev-relevance-replay.ts --sample 200
 */

import { readFileSync, writeFileSync } from "node:fs"
import { PiiMasker } from "../../src/lib/ai/pii-masker"

const API_URL = process.env.JEV_API_URL ?? "https://api.typesafe.ai/v1/systemone"
const MODEL = process.env.JEV_MODEL ?? "jev-latest"
const REQUEST_TIMEOUT_MS = 20_000

type CorpusRow = {
  matchId: string
  mentionId: string
  subjectId: string
  subjectName: string
  subjectType: string
  requiredContext: string[]
  exclusions: string[]
  aliases: string[]
  negativeAliases: string[]
  platform: string
  contentKind: string
  matchedTerm: string | null
  authorName: string | null
  authorHandle: string | null
  text: string
  /** The publication a comment sits under; the brand is often only named there. */
  parentText: string | null
  status: "MATCHED" | "REJECTED"
  signals: Record<string, unknown> | null
}

type Verdict = "about_subject" | "not_about_subject" | "unsure"
type Reference = "literal" | "excluded" | "unknown"

type Result = {
  matchId: string
  subjectName: string
  status: CorpusRow["status"]
  reference: Reference
  ambiguousOnly: boolean
  verdict: Verdict | null
  confidence: number | null
  probabilities: Record<string, number> | null
  error?: string
  inputTokens?: number
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? "") : null
}
const FLAG_DRY_RUN = process.argv.includes("--dry-run")
const SAMPLE = Number(arg("sample") ?? 0) || 0
const CONCURRENCY = Number(arg("concurrency") ?? 4) || 4
const CORPUS = arg("corpus") ?? `${process.env.TMPDIR ?? "/tmp"}/jev-corpus.jsonl`
const OUT_PREFIX = arg("out") ?? `${process.env.TMPDIR ?? "/tmp"}/jev-replay`

/** Fold case and strip the diacritics Azerbaijani text is spelled with both ways. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ə/g, "e")
    .replace(/\s+/g, " ")
    .trim()
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const text = normalize(haystack)
  return needles.some((needle) => {
    const term = normalize(needle)
    // One- and two-letter aliases match inside ordinary words; they are the
    // reason the matcher has an "ambiguous" class in the first place.
    return term.length >= 3 && text.includes(term)
  })
}

function referenceFor(row: CorpusRow): Reference {
  const positives = [row.subjectName, ...row.aliases]
  const negatives = [...row.negativeAliases, ...row.exclusions]
  // Only the record's OWN text counts as a literal reference. A brand named in
  // the parent publication says nothing about whether the comment is about it —
  // that is precisely the judgement under test.
  if (containsAny(row.text, positives)) return "literal"
  if (negatives.length > 0 && containsAny(row.text, negatives)) return "excluded"
  return "unknown"
}

/**
 * The question, in Jev's own vocabulary.
 *
 * The criteria are the Haiku judge's wording (src/lib/social/ai-relevance-judge.ts)
 * compressed into per-option descriptions, so the comparison is between models
 * rather than between two different definitions of the task.
 */
function buildRequest(row: CorpusRow): Record<string, unknown> {
  const masker = new PiiMasker()
  const truncate = (value: string, limit: number) => (
    value.length > limit ? `${value.slice(0, limit)}…` : value
  )
  const author = [row.authorName, row.authorHandle]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" / ")

  return {
    model: MODEL,
    state: {
      brand: row.subjectName,
      brand_kind: row.subjectType,
      known_spellings: row.aliases.slice(0, 40),
      confirming_context_words: row.requiredContext,
      different_subject_words: [...row.negativeAliases, ...row.exclusions],
      platform: row.platform,
      content_kind: row.contentKind,
      matched_term: row.matchedTerm,
      author: author ? masker.mask(truncate(author, 120)) : null,
      // 801 of 2204 records name the brand nowhere in their own text and sit
      // under a publication that does. Without this the task is unanswerable
      // for them, and any score would measure the harness, not the model.
      parent_publication: row.parentText?.trim()
        ? masker.mask(truncate(row.parentText.trim(), 600))
        : null,
      record: masker.mask(truncate(row.text.trim(), 1200)),
    },
    questions: {
      relevance: {
        type: "choice",
        instructions:
          "Decide whether this social media record is about the monitored brand in `brand`. "
          + "The brand name may be absent: judge by meaning, not by string overlap. "
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

async function askJev(row: CorpusRow, apiKey: string): Promise<Result> {
  const base: Result = {
    matchId: row.matchId,
    subjectName: row.subjectName,
    status: row.status,
    reference: referenceFor(row),
    ambiguousOnly: row.signals?.ambiguousOnly === true,
    verdict: null,
    confidence: null,
    probabilities: null,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRequest(row)),
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return { ...base, error: `HTTP_${response.status}: ${body.slice(0, 300)}` }
    }
    const payload = await response.json() as {
      answers?: { relevance?: { choice?: string; confidence?: number; probabilities?: Record<string, number> } }
      usage?: { input_tokens?: number }
    }
    const answer = payload.answers?.relevance
    const choice = answer?.choice
    if (choice !== "about_subject" && choice !== "not_about_subject" && choice !== "unsure") {
      return { ...base, error: `UNEXPECTED_ANSWER: ${JSON.stringify(answer).slice(0, 200)}` }
    }
    return {
      ...base,
      verdict: choice,
      confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
      probabilities: answer?.probabilities ?? null,
      inputTokens: payload.usage?.input_tokens,
    }
  } catch (error) {
    return { ...base, error: error instanceof Error ? `${error.name}: ${error.message}` : "UNKNOWN" }
  } finally {
    clearTimeout(timer)
  }
}

/** Stratified so the small, interesting classes are not lost to sampling. */
function pickSample(rows: CorpusRow[], size: number): CorpusRow[] {
  if (size <= 0 || size >= rows.length) return rows
  const buckets = new Map<string, CorpusRow[]>()
  for (const row of rows) {
    const key = `${row.status}|${referenceFor(row)}|${row.signals?.ambiguousOnly === true}`
    const bucket = buckets.get(key) ?? []
    bucket.push(row)
    buckets.set(key, bucket)
  }
  const out: CorpusRow[] = []
  let index = 0
  const keys = [...buckets.keys()]
  while (out.length < size) {
    const key = keys[index % keys.length]
    const bucket = buckets.get(key)
    if (bucket && bucket.length > 0) out.push(bucket.shift() as CorpusRow)
    index += 1
    if (keys.every((k) => (buckets.get(k)?.length ?? 0) === 0)) break
  }
  return out
}

function table(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return "_(none)_\n"
  const headers = Object.keys(rows[0])
  const line = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map((row) => line(headers.map((header) => row[header] ?? ""))),
  ].join("\n") + "\n"
}

function report(results: Result[]): string {
  const answered = results.filter((result) => result.verdict !== null)
  const failed = results.filter((result) => result.error)
  const byReference = (reference: Reference) => answered.filter((r) => r.reference === reference)

  const crossTab = (subset: Result[]) => {
    const counts = new Map<string, number>()
    for (const row of subset) {
      const key = `${row.status} / ${row.verdict}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ "matcher / Jev": key, records: count }))
  }

  const literal = byReference("literal")
  const excluded = byReference("excluded")
  const agreeLiteral = literal.filter((r) => r.verdict === "about_subject").length
  const agreeExcluded = excluded.filter((r) => r.verdict === "not_about_subject").length

  const calibration = [0.5, 0.7, 0.9, 1.01].map((upper, index, all) => {
    const lower = index === 0 ? 0 : all[index - 1]
    const subset = [...literal, ...excluded].filter((row) => (
      row.confidence !== null && row.confidence >= lower && row.confidence < upper
    ))
    const correct = subset.filter((row) => (
      row.reference === "literal" ? row.verdict === "about_subject" : row.verdict === "not_about_subject"
    )).length
    return {
      confidence: `${lower.toFixed(2)}–${Math.min(upper, 1).toFixed(2)}`,
      records: subset.length,
      "agrees with reference": subset.length ? `${Math.round((correct / subset.length) * 100)}%` : "—",
    }
  })

  const tokens = answered.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0)

  return [
    `# Jev vs. the relevance matcher — offline replay`,
    ``,
    `Records asked: **${results.length}**, answered: **${answered.length}**, failed: **${failed.length}**.`,
    `Input tokens billed: **${tokens}** (~$${(tokens * 0.042 / 1_000_000).toFixed(6)} at $0.042/M).`,
    ``,
    `## Where a reference exists`,
    ``,
    `The brand is literally in the text (${literal.length} records): Jev says about_subject in `
      + `**${literal.length ? Math.round((agreeLiteral / literal.length) * 100) : 0}%**.`,
    `A different-subject word is in the text and the brand is not (${excluded.length} records): `
      + `Jev says not_about_subject in **${excluded.length ? Math.round((agreeExcluded / excluded.length) * 100) : 0}%**.`,
    ``,
    `## Confidence calibration on those records`,
    ``,
    table(calibration),
    `## Against the matcher's own decision (not truth — the thing under test)`,
    ``,
    table(crossTab(answered)),
    `### The ambiguous class the judge was written for`,
    ``,
    `${answered.filter((r) => r.ambiguousOnly).length} records. No reference exists for them, so they `
      + `are listed in the hand-labelling sheet instead of being scored.`,
    ``,
    table(crossTab(answered.filter((r) => r.ambiguousOnly))),
    failed.length > 0 ? `## Failures\n\n${table(
      [...new Set(failed.map((row) => String(row.error).slice(0, 120)))]
        .map((error) => ({ error, records: failed.filter((row) => String(row.error).startsWith(error)).length })),
    )}` : ``,
  ].join("\n")
}

/** Rows a human has to read, because nothing else can settle them. */
function labelSheet(rows: CorpusRow[], results: Result[]): string {
  const byId = new Map(results.map((result) => [result.matchId, result]))
  const interesting = rows.filter((row) => {
    const result = byId.get(row.matchId)
    if (!result?.verdict) return false
    const reference = result.reference
    const disagreesWithMatcher = (row.status === "MATCHED") !== (result.verdict === "about_subject")
    const contradictsReference = (reference === "literal" && result.verdict === "not_about_subject")
      || (reference === "excluded" && result.verdict === "about_subject")
    return contradictsReference || (reference === "unknown" && disagreesWithMatcher)
  }).slice(0, 60)

  return [
    `# Hand-labelling sheet`,
    ``,
    `Rows where Jev and the current matcher disagree and nothing automatic can settle it.`,
    `Read the text, write MATCHED or REJECTED in the last column.`,
    ``,
    ...interesting.flatMap((row) => {
      const result = byId.get(row.matchId)
      return [
        `## ${row.subjectName} — matcher: ${row.status}, Jev: ${result?.verdict} (confidence ${result?.confidence ?? "—"})`,
        ``,
        `Platform: ${row.platform} / ${row.contentKind}${row.matchedTerm ? `, matched term: ${row.matchedTerm}` : ""}`,
        ``,
        `> ${row.text.replace(/\n+/g, " ").slice(0, 600)}`,
        ``,
        `Truth: ______`,
        ``,
      ]
    }),
  ].join("\n")
}

async function main(): Promise<void> {
  const rows = readFileSync(CORPUS, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusRow)
  const selected = pickSample(rows, SAMPLE)

  const references = { literal: 0, excluded: 0, unknown: 0 }
  for (const row of selected) references[referenceFor(row)] += 1
  console.log(`corpus: ${rows.length} rows, selected: ${selected.length}`)
  console.log(`references: literal ${references.literal}, excluded ${references.excluded}, unknown ${references.unknown}`)
  console.log(`ambiguous-only rows: ${selected.filter((row) => row.signals?.ambiguousOnly === true).length}`)

  if (FLAG_DRY_RUN) {
    console.log(`\n--dry-run: nothing is sent. The first request would be:\n`)
    console.log(JSON.stringify(buildRequest(selected[0]), null, 2))
    return
  }

  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is not set. Run with --dry-run, or export the key.")
    process.exit(2)
  }

  const results: Result[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < selected.length) {
      const index = cursor++
      results.push(await askJev(selected[index], apiKey))
      if (results.length % 25 === 0) console.log(`  …${results.length}/${selected.length}`)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker))

  writeFileSync(`${OUT_PREFIX}-results.jsonl`, results.map((r) => JSON.stringify(r)).join("\n") + "\n")
  writeFileSync(`${OUT_PREFIX}-report.md`, report(results))
  writeFileSync(`${OUT_PREFIX}-labels.md`, labelSheet(selected, results))
  console.log(`\nwrote ${OUT_PREFIX}-results.jsonl, -report.md, -labels.md`)
  console.log(report(results))
}

void main()

/**
 * Corpus export (read-only, run on the production host):
 *
 *   psql "$DATABASE_URL" -At -c "select set_config('app.rls_bypass','on',false)" \
 *     -c "copy ( … ) to stdout"
 *
 * The exact query lives in docs/social-relevance-benchmark.md, because the rows
 * carry customer text: the corpus file belongs in a scratch directory, never in
 * the repository.
 */
