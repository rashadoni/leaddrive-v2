/**
 * Диагностика языковой разметки находок соцмониторинга. Только чтение.
 *
 * Зачем. По метке `sourceMetadata.socialTriage.language` фильтруется лента и
 * считаются счётчики карточек, поэтому её качество надо чем-то мерить.
 *
 * Исторически метка ещё и ОТКЛОНЯЛА находку на релевантности (гейт
 * `subject_language_mismatch`, #656). Гейт разжалован до пометки (#664) — язык
 * больше не решает вопрос релевантности, — но накопленные отклонения в базе
 * остались, и скрипт их показывает: по ним видно объём предстоящего пересчёта.
 *
 * Что меряет. Скрипт не выносит вердикт «правильно/неправильно» — для этого
 * нужна разметка человеком. Он показывает объективные признаки, по которым
 * видно, где разметка шаткая:
 *
 *   1. Распределение меток, включая долю БЕЗ метки. Такие находки не отфильтрует
 *      и языковой отбор на показе — по ним у системы просто нет мнения.
 *   2. Долю находок, у которых сигнал «азербайджанский» держится ТОЛЬКО на
 *      `ğ ı ş`. Эти буквы общие с турецким; уникальна для азербайджанского
 *      одна `ə`. Такие строки неотличимы от турецких без словаря.
 *   3. Длину текста. На коротком тексте ненадёжен любой определитель, включая
 *      внешние модели.
 *   4. Обвязку интерфейса Facebook, попадающую в текст при скрапе: она
 *      добавляет русские слова к посту на другом языке.
 *   5. Сколько находок было отклонено гейтом до его разжалования — это объём
 *      предстоящего пересчёта.
 *
 * Детектор не дублируется: берётся боевой `detectArticleLanguage`, тот же, что
 * пишет метку на приёме (`ingest-mention.ts`).
 *
 *   npx tsx scripts/audit-social-language-labels.ts
 *   npx tsx scripts/audit-social-language-labels.ts --slug=brandprotection
 *
 * Ничего не пишет: флага записи у скрипта нет и не предполагается — на это есть
 * тест, он упадёт, если запись когда-нибудь появится.
 */
import type { PrismaClient } from "@prisma/client"

import { makeScriptPrisma } from "./_rls.mjs"
import { detectArticleLanguage } from "../src/lib/social/article-language"

function arg(name: string): string | undefined {
  const found = process.argv.find(value => value.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : undefined
}

// `ə` — единственная буква, которой нет в турецком алфавите. Всё остальное из
// азербайджанской диакритики турецкий делит с нами, поэтому «сигнал только по
// ğ/ı/ş» означает «az или tr, различить нечем».
const AZ_UNIQUE = /[əƏ]/
const AZ_SHARED_WITH_TURKISH = /[ğışĞİŞ]/
const CYRILLIC = /[а-яА-ЯёЁ]/
// Русская обвязка ленты Facebook, попадающая в text при скрапе.
const FB_CHROME = /(Подписаться|Комментировать|Поделиться|Нравится|Все реакции)|\d+\s*(ч|дн|мин)\.\s*·/

type MentionRow = {
  id: string
  platform: string
  text: string | null
  language: string | null
}

type RejectRow = { language: string | null; count: bigint }

function pct(part: number, total: number): string {
  return total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`
}

function bar(label: string, value: number, total: number): string {
  return `  ${label.padEnd(12)} ${String(value).padStart(5)}  ${pct(value, total).padStart(6)}`
}

async function auditOrganization(prisma: PrismaClient, organizationId: string, name: string) {
  const rows = await prisma.$queryRaw<MentionRow[]>`
    SELECT sm.id,
           sm.platform,
           sm.text,
           sm."sourceMetadata" -> 'socialTriage' ->> 'language' AS language
    FROM social_mentions sm
    WHERE sm."organizationId" = ${organizationId}
      AND sm."purgedAt" IS NULL
      AND sm.text IS NOT NULL
      AND length(btrim(sm.text)) > 0
  `
  if (rows.length === 0) {
    console.log(`\n=== ${name} — находок нет, пропуск ===`)
    return
  }

  console.log(`\n=== ${name} (${organizationId}) — ${rows.length} находок ===`)

  console.log("\n-- Распределение метки --")
  const byLabel = new Map<string, number>()
  for (const row of rows) {
    const key = row.language ?? "(без метки)"
    byLabel.set(key, (byLabel.get(key) ?? 0) + 1)
  }
  for (const [label, count] of [...byLabel].sort((a, b) => b[1] - a[1])) {
    console.log(bar(label, count, rows.length))
  }

  // Расхождение сохранённой метки с тем, что дал бы детектор сейчас. Ненулевое
  // значит: метку ставил не он (AI-триаж) либо правила детектора с тех пор
  // менялись — и то и другое стоит знать перед любым бэкфиллом.
  const drift = rows.filter(row => (row.language ?? null) !== detectArticleLanguage(row.text ?? ""))
  console.log(`\n-- Метка расходится с текущим detectArticleLanguage: ${drift.length} (${pct(drift.length, rows.length)}) --`)
  if (drift.length > 0) {
    const driftBy = new Map<string, number>()
    for (const row of drift) {
      const key = `${row.language ?? "(нет)"} → ${detectArticleLanguage(row.text ?? "") ?? "(нет)"}`
      driftBy.set(key, (driftBy.get(key) ?? 0) + 1)
    }
    for (const [key, count] of [...driftBy].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(bar(key, count, drift.length))
    }
  }

  // Без метки языковой отбор бессилен: у системы нет мнения о языке.
  const unlabelled = rows.filter(row => !row.language)
  const shortUnlabelled = unlabelled.filter(row => (row.text ?? "").replace(/\s+/g, " ").trim().length < 50)
  console.log(`\n-- Находки без метки: языковой отбор их не видит --`)
  console.log(`  без метки: ${unlabelled.length} (${pct(unlabelled.length, rows.length)}) — фильтр по языку их не отберёт`)
  console.log(`  из них короче 50 символов: ${shortUnlabelled.length} (${pct(shortUnlabelled.length, unlabelled.length)})`)

  // Азербайджанский против турецкого: где сигнал держится на общих буквах.
  const azRows = rows.filter(row => row.language === "az")
  const azSharedOnly = azRows.filter(row => {
    const text = row.text ?? ""
    return !AZ_UNIQUE.test(text) && AZ_SHARED_WITH_TURKISH.test(text)
  })
  console.log(`\n-- Азербайджанский против турецкого --`)
  console.log(`  помечено az: ${azRows.length}`)
  console.log(`  из них без единой «ə», сигнал только по ğ/ı/ş: ${azSharedOnly.length} (${pct(azSharedOnly.length, azRows.length)})`)
  console.log(`  ← этот класс неотличим от турецкого без словаря: буквами его не разделить`)

  console.log("\n-- Длина текста (короткий текст ненадёжен для любого определителя) --")
  const buckets: Array<[string, (n: number) => boolean]> = [
    ["<20", n => n < 20],
    ["20-49", n => n >= 20 && n < 50],
    ["50-99", n => n >= 50 && n < 100],
    ["100-299", n => n >= 100 && n < 300],
    ["300+", n => n >= 300],
  ]
  const lengths = rows.map(row => (row.text ?? "").replace(/\s+/g, " ").trim().length)
  for (const [label, test] of buckets) {
    console.log(bar(label, lengths.filter(test).length, rows.length))
  }

  // Обвязка Facebook: русские слова интерфейса в теле поста на другом языке.
  const chrome = rows.filter(row => FB_CHROME.test(row.text ?? ""))
  const chromeOnlyCyrillic = chrome.filter(row => {
    const stripped = (row.text ?? "")
      .replace(/(Подписаться|Комментировать|Поделиться|Нравится|Все реакции)/g, " ")
      .replace(/\d+\s*(ч|дн|мин)\.\s*·/g, " ")
    return !CYRILLIC.test(stripped)
  })
  console.log(`\n-- Обвязка интерфейса Facebook в тексте --`)
  console.log(`  находок с обвязкой: ${chrome.length} (${pct(chrome.length, rows.length)})`)
  console.log(`  из них кириллица ТОЛЬКО в обвязке (метка ru ошибочна): ${chromeOnlyCyrillic.length}`)

  const rejects = await prisma.$queryRaw<RejectRow[]>`
    SELECT sm."sourceMetadata" -> 'socialTriage' ->> 'language' AS language,
           count(*) AS count
    FROM social_mention_subject_matches msm
    JOIN social_mentions sm ON sm.id = msm."mentionId"
    WHERE msm."organizationId" = ${organizationId}
      AND msm.status = 'REJECTED'
      AND msm.reason = 'subject_language_mismatch'
    GROUP BY 1
    ORDER BY 2 DESC
  `
  const rejectTotal = rejects.reduce((sum, row) => sum + Number(row.count), 0)
  console.log(`\n-- Историческое: отклонено гейтом до его разжалования (#664): ${rejectTotal} --`)
  for (const row of rejects) {
    console.log(bar(row.language ?? "(нет)", Number(row.count), rejectTotal))
  }
}

async function main() {
  const slug = arg("slug")
  const prisma = await makeScriptPrisma()
  try {
    const organizations = await prisma.organization.findMany({
      where: slug ? { slug } : {},
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    if (organizations.length === 0) throw new Error(slug ? `organization_not_found_for_slug_${slug}` : "no_organizations")
    for (const organization of organizations) {
      await auditOrganization(prisma, organization.id, organization.name)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
