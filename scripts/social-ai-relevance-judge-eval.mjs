#!/usr/bin/env node
/**
 * Замер ИИ-судьи релевантности (#646) по уже собранным записям.
 *
 * Отвечает на один вопрос: сколько находок прячется в том, что сверка строк
 * отбросила как «бренда нет в тексте». Ничего не меняет в базе и не делает ни
 * одного платного запроса к провайдеру — только читает конверты и вызывает
 * дешёвый классификатор.
 *
 * Запуск на проде (только чтение):
 *   ANTHROPIC_API_KEY=... node scripts/social-ai-relevance-judge-eval.mjs \
 *     --org cmrc5m4oe000050dqdgp4nhqi --limit 50 --reason no_monitoring_subject_match
 *
 * Печатает разбивку вердиктов и примеры, чтобы решение о включении принималось
 * по фактам, а не по обещанию.
 */
import Anthropic from "@anthropic-ai/sdk"
import { makeScriptPrisma } from "./_rls.mjs"

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const organizationId = arg("org")
const limit = Math.max(1, Math.min(Number(arg("limit", "50")) || 50, 500))
const reason = arg("reason", "no_monitoring_subject_match")
const platform = arg("platform")
const showExamples = Math.max(0, Math.min(Number(arg("examples", "8")) || 8, 40))
// Два разных вопроса — два режима.
//   recall   (по умолчанию): что сверка строк выбросила, а судья вернул бы.
//   labelled: сходится ли судья с решениями, в которых мы уверены, — то есть
//             можно ли доверять ему ОТКАЗЫ, а не только находки.
const mode = arg("mode", "recall") === "labelled" ? "labelled" : "recall"
const perGroup = Math.max(1, Math.min(Number(arg("per-group", "40")) || 40, 200))

if (!organizationId) {
  console.error("usage: --org <organizationId> [--mode recall|labelled] [--limit 50] [--per-group 40] [--reason no_monitoring_subject_match] [--platform instagram]")
  process.exit(2)
}
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required")
  process.exit(2)
}

const anthropic = new Anthropic({ apiKey, maxRetries: 0, timeout: 45_000 })
// RLS fail-closed: собственный клиент скрипта обязан идти через общую фабрику,
// иначе запрос без контекста тихо вернёт ноль строк (правило проекта).
const prisma = await makeScriptPrisma()

function truncate(value, max) {
  const text = String(value ?? "").trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function buildPrompt(subject) {
  const aliases = (subject.aliases ?? []).slice(0, 20)
  const requiredContext = (subject.requiredContext ?? []).slice(0, 20)
  const negativeTerms = (subject.negativeTerms ?? []).slice(0, 20)
  return [
    "You decide whether a social media record is about one specific monitored brand.",
    "",
    `Brand: ${subject.name}`,
    aliases.length ? `Known spellings and synonyms: ${aliases.join(", ")}` : null,
    requiredContext.length
      ? `Context words that confirm the brand when its name is ambiguous: ${requiredContext.join(", ")}`
      : null,
    negativeTerms.length
      ? `Words meaning a different subject with a similar name: ${negativeTerms.join(", ")}`
      : null,
    "",
    "The brand name may be absent from the text. Judge by meaning, not by string overlap.",
    "Answer about_subject when the record discusses this brand, its products, staff,",
    "branches, prices or service — including a comment addressed to the brand under",
    "its own publication, or a complaint that names no company at all but clearly",
    "continues a conversation about it.",
    "Answer not_about_subject when the record is about someone else with a similar",
    "name, about an unrelated topic, or is generic spam.",
    "Answer unsure when the text is too short, too vague, or could plausibly be either.",
    "Prefer unsure over guessing: a wrong about_subject puts noise into a client's feed.",
    "",
    "Respond with exactly one lowercase word: about_subject, not_about_subject, or unsure.",
    "Do not explain. Do not restate the record. Output the single word and nothing else.",
  ].filter(Boolean).join("\n")
}

// Та же разборка вердикта, что в src/lib/social/ai-relevance-judge.ts: замер
// обязан мерить ровно то, что поедет в прод. Первый по позиции вердикт, а не
// первый из списка, — «not_about_subject» содержит «about_subject» подстрокой.
function parseVerdict(answer) {
  const value = String(answer ?? "").toLowerCase()
  let best = null
  for (const verdict of ["not_about_subject", "about_subject", "unsure"]) {
    const at = value.indexOf(verdict)
    if (at < 0) continue
    if (!best || at < best.at) best = { verdict, at }
  }
  return best?.verdict ?? null
}

async function judge(envelope, subject) {
  const message = [
    `Platform: ${envelope.platform}`,
    envelope.authorName ? `Author: ${truncate(envelope.authorName, 120)}` : null,
    envelope.parentPostUrl ? `Comment under: ${truncate(envelope.parentPostUrl, 200)}` : null,
    `Record: ${truncate(envelope.text, 1200)}`,
  ].filter(Boolean).join("\n")
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16,
      system: buildPrompt(subject),
      messages: [
        { role: "user", content: message },
        // Ответ начат за модель: продолжение после «verdict:» не оставляет ей
        // места на вступление. Без пробела на конце — иначе API отвергнет.
        { role: "assistant", content: "verdict:" },
      ],
    })
    const answer = response.content.map(block => block.text ?? "").join("").trim().toLowerCase()
    return parseVerdict(answer) ?? `invalid:${answer.slice(0, 40)}`
  } catch (error) {
    return `error:${error?.status ?? error?.name ?? "unknown"}`
  }
}

/**
 * Группы с известным ответом. Правило релевантности уже вынесло по ним решение,
 * которому мы верим по независимой причине, поэтому расхождение судьи — это
 * измеримая ошибка, а не вопрос вкуса.
 *
 * Разметка взялась из разбора 2026-08-03: 275 соболезнований под постом-данью
 * заведомо НЕ про бренд (в них нет ни слова о магазине), а находки по прямому
 * совпадению алиаса заведомо про бренд (имя бренда в тексте).
 */
const LABELLED_GROUPS = [
  {
    key: "condolence_rejected",
    title: "соболезнования под постом-данью (правда: не про бренд)",
    expected: "not_about_subject",
    where: { status: "REJECTED", reason: "condolence_parent_post_no_inheritance" },
  },
  {
    key: "alias_matched",
    title: "прямое совпадение алиаса (правда: про бренд)",
    expected: "about_subject",
    where: { status: "MATCHED", reason: "subject_alias_match" },
  },
  {
    key: "inherited_accepted",
    title: "принято наследованием от жалобы (правда неизвестна)",
    expected: null,
    where: { status: "MATCHED", reason: "negative_parent_post_inheritance" },
  },
]

async function runLabelled() {
  console.log(`режим: labelled, по ${perGroup} записей на группу\n`)
  const summary = []
  for (const group of LABELLED_GROUPS) {
    const matches = await prisma.socialMentionSubjectMatch.findMany({
      where: { organizationId, ...group.where },
      orderBy: { decidedAt: "desc" },
      take: perGroup,
      select: {
        reason: true,
        subject: {
          select: { id: true, name: true, aliases: true, requiredContext: true, exclusions: true },
        },
        mention: {
          select: { platform: true, text: true, authorName: true, url: true, parentPostUrl: true },
        },
      },
    })
    const tally = new Map()
    const disagreements = []
    for (const match of matches) {
      if (!match.mention?.text?.trim() || !match.subject) {
        tally.set("skipped_no_text", (tally.get("skipped_no_text") ?? 0) + 1)
        continue
      }
      // Судим против ТОГО объекта, к которому решение и относится: вопрос здесь
      // не «есть ли хоть один бренд», а «согласен ли судья с этим решением».
      const verdict = await judge(match.mention, {
        name: match.subject.name,
        aliases: Array.isArray(match.subject.aliases) ? match.subject.aliases : [],
        requiredContext: Array.isArray(match.subject.requiredContext) ? match.subject.requiredContext : [],
        negativeTerms: Array.isArray(match.subject.exclusions) ? match.subject.exclusions : [],
      })
      tally.set(verdict, (tally.get(verdict) ?? 0) + 1)
      if (group.expected && verdict !== group.expected && disagreements.length < showExamples) {
        disagreements.push({ verdict, subject: match.subject.name, platform: match.mention.platform, text: truncate(match.mention.text, 200), url: match.mention.url })
      }
    }
    const judged = [...tally.entries()]
      .filter(([verdict]) => !verdict.startsWith("skipped"))
      .reduce((sum, [, count]) => sum + count, 0)
    const agreed = group.expected ? tally.get(group.expected) ?? 0 : null
    summary.push({ group, judged, agreed })

    console.log(`── ${group.title}`)
    console.log(`   записей: ${matches.length}`)
    for (const [verdict, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      const share = judged ? Math.round((count / judged) * 100) : 0
      console.log(`   ${verdict.padEnd(22)} ${String(count).padStart(4)}  ${share}%`)
    }
    if (group.expected) {
      const share = judged ? Math.round((agreed / judged) * 100) : 0
      console.log(`   СОГЛАСИЕ с ожидаемым «${group.expected}»: ${agreed}/${judged} (${share}%)`)
    }
    if (disagreements.length > 0) {
      console.log(`   расхождения (${disagreements.length}):`)
      for (const item of disagreements) {
        console.log(`     [${item.platform}] ${item.subject} → ${item.verdict}`)
        console.log(`     ${item.text}`)
      }
    }
    console.log("")
  }

  console.log("итого по группам с известным ответом:")
  for (const row of summary) {
    if (!row.group.expected) continue
    const share = row.judged ? Math.round((row.agreed / row.judged) * 100) : 0
    console.log(`  ${row.group.key.padEnd(22)} ${row.agreed}/${row.judged} (${share}%)`)
  }
}

async function main() {
  if (mode === "labelled") return runLabelled()
  const subjects = await prisma.monitoringSubject.findMany({
    where: { organizationId, status: "active" },
    select: { id: true, name: true, aliases: true, requiredContext: true, exclusions: true },
  })
  if (subjects.length === 0) throw new Error("no active monitoring subjects for this organization")

  const envelopes = await prisma.ingestEnvelope.findMany({
    where: {
      organizationId,
      relevanceStatus: "REJECTED",
      relevanceReason: reason,
      ...(platform ? { platform } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, platform: true, text: true, authorName: true, url: true,
      parentPostUrl: true, createdAt: true,
    },
  })
  console.log(`sampled ${envelopes.length} envelopes (reason=${reason}${platform ? `, platform=${platform}` : ""})`)
  console.log(`subjects in scope: ${subjects.map(subject => subject.name).join(", ")}\n`)

  const tally = new Map()
  const examples = []
  for (const envelope of envelopes) {
    if (!envelope.text?.trim()) {
      tally.set("skipped_no_text", (tally.get("skipped_no_text") ?? 0) + 1)
      continue
    }
    // Судья проверяется против КАЖДОГО объекта: запись считается находкой,
    // если хотя бы один бренд признан. Так же будет работать врезка.
    let best = "not_about_subject"
    let bestSubject = null
    for (const subject of subjects) {
      const verdict = await judge(envelope, {
        name: subject.name,
        aliases: Array.isArray(subject.aliases) ? subject.aliases : [],
        requiredContext: Array.isArray(subject.requiredContext) ? subject.requiredContext : [],
        negativeTerms: Array.isArray(subject.exclusions) ? subject.exclusions : [],
      })
      if (verdict.startsWith("error:") || verdict.startsWith("invalid:")) {
        best = verdict
        break
      }
      if (verdict === "about_subject") { best = verdict; bestSubject = subject.name; break }
      if (verdict === "unsure" && best === "not_about_subject") { best = verdict; bestSubject = subject.name }
    }
    tally.set(best, (tally.get(best) ?? 0) + 1)
    if (best === "about_subject" && examples.length < showExamples) {
      examples.push({ subject: bestSubject, platform: envelope.platform, text: truncate(envelope.text, 220), url: envelope.url })
    }
  }

  console.log("verdicts:")
  for (const [verdict, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    const share = envelopes.length ? Math.round((count / envelopes.length) * 100) : 0
    console.log(`  ${verdict.padEnd(22)} ${String(count).padStart(4)}  ${share}%`)
  }

  if (examples.length > 0) {
    console.log(`\nrecords the judge would put into the feed (${examples.length} of ${tally.get("about_subject") ?? 0}):`)
    for (const example of examples) {
      console.log(`\n  [${example.platform}] ${example.subject}`)
      console.log(`  ${example.text}`)
      if (example.url) console.log(`  ${example.url}`)
    }
  }
}

main()
  .catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
