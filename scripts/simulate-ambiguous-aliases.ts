/**
 * Симулятор: что будет, если пометить алиасы неоднозначными. Только чтение.
 *
 * Зачем. После разжалования языкового гейта (#666) однописьменные зарубежные
 * тёзки проходят по одному совпадению алиаса: нигерийский «Oba Market» из
 * Бенин-Сити неотличим от азербайджанского по письменности, а география
 * (#654) спрашивается только у алиасов, помеченных неоднозначными. Пометить их
 * — штатный способ, но он режет в обе стороны: местный пост, не упоминающий
 * страну и пришедший не с собственной площадки, тоже потеряет второй сигнал.
 *
 * Поэтому прежде чем менять данные — замер. `decideSubjectRelevance` чистая:
 * принимает объекты аргументом, в БД не ходит. Скрипт прогоняет каждую находку
 * дважды — по боевым объектам и по копии с поднятым `isAmbiguous` — и
 * показывает разницу.
 *
 * Правила не дублируются: считает тот же код, что и приём.
 *
 *   npx tsx scripts/simulate-ambiguous-aliases.ts --slug=brandprotection \
 *     --aliases="Oba Market,Grandmart" --geographies="Bakı,Sumqayıt,Gəncə"
 *
 * Ничего не пишет: флага записи у скрипта нет и не предполагается.
 */
import { Prisma, type PrismaClient } from "@prisma/client"

import { makeScriptPrisma } from "./_rls.mjs"
import { runWithRlsBypass } from "../src/lib/rls-context"
import { decideSubjectRelevance, type SubjectForMatch } from "../src/lib/social/subject-relevance"
import type { IngestInput } from "../src/lib/social/ingest-mention"

function arg(name: string): string | undefined {
  const found = process.argv.find(value => value.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : undefined
}

type MentionRow = {
  id: string
  organizationId: string
  accountId: string | null
  platform: string
  externalId: string
  sourceType: string | null
  contentKind: string | null
  sourceProvider: string | null
  sourceMetadata: unknown
  text: string
  sentiment: string | null
  matchedTerm: string | null
  url: string | null
  authorName: string | null
  authorHandle: string | null
  publishedAt: Date | null
  language: string | null
}

function toIngestInput(row: MentionRow): IngestInput {
  const sourceMetadata = row.sourceMetadata && typeof row.sourceMetadata === "object" && !Array.isArray(row.sourceMetadata)
    ? row.sourceMetadata as Record<string, unknown>
    : {}
  const sentiment = row.sentiment === "positive" || row.sentiment === "neutral" || row.sentiment === "negative"
    ? row.sentiment
    : null
  return {
    organizationId: row.organizationId,
    accountId: row.accountId,
    platform: row.platform,
    externalId: row.externalId,
    sourceType: row.sourceType ?? undefined,
    contentKind: row.contentKind ?? undefined,
    sourceProvider: row.sourceProvider ?? undefined,
    sourceMetadata,
    text: row.text,
    sentiment,
    matchedTerm: row.matchedTerm,
    url: row.url,
    authorName: row.authorName,
    authorHandle: row.authorHandle,
    publishedAt: row.publishedAt,
  }
}

async function main() {
  const slug = arg("slug")
  const aliasList = (arg("aliases") ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
  if (aliasList.length === 0) throw new Error("нужен --aliases=через,запятую")
  // Второй сигнал у неоднозначного алиаса даёт в том числе совпадение географии
  // В ТЕКСТЕ. Если в объекте только «Azərbaycan», местный пост про «Bakı şəhəri»
  // его не даст. Флаг позволяет замерить, спасают ли города.
  const extraGeographies = (arg("geographies") ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)

  const prisma: PrismaClient = await makeScriptPrisma()
  try {
    const org = slug
      ? await prisma.organization.findFirst({ where: { slug }, select: { id: true, name: true } })
      : null
    if (slug && !org) throw new Error(`organization_not_found_for_slug_${slug}`)
    const organizationId = org?.id
    if (org) console.log(`Организация: ${org.name} (${org.id})`)

    const subjects = await prisma.monitoringSubject.findMany({
      where: { ...(organizationId ? { organizationId } : {}), status: "active" },
      include: { aliases: true, sources: { include: { source: true } } },
    }) as SubjectForMatch[]

    // Копия объектов с поднятым флагом у названных алиасов. Боевые строки не
    // трогаем: меняем только структуру в памяти.
    let raised = 0
    const simulated = subjects.map(subject => ({
      ...subject,
      geographies: extraGeographies.length > 0
        ? Array.from(new Set([...(subject.geographies ?? []), ...extraGeographies]))
        : subject.geographies,
      aliases: subject.aliases.map(alias => {
        const hit = aliasList.includes(alias.value.trim().toLowerCase())
        if (hit && !alias.isAmbiguous) raised++
        return hit ? { ...alias, isAmbiguous: true } : alias
      }),
    })) as SubjectForMatch[]
    console.log(`Помечено неоднозначными: ${raised} алиасов`)
    if (extraGeographies.length > 0) console.log(`Добавлено в географию: ${extraGeographies.join(", ")}`)
    console.log("")

    const rows = await prisma.$queryRaw<MentionRow[]>`
      SELECT sm.id, sm."organizationId", sm."accountId", sm.platform, sm."externalId",
             sm."sourceType", sm."contentKind", sm."sourceProvider", sm."sourceMetadata",
             sm.text, sm.sentiment, sm."matchedTerm", sm.url, sm."authorName",
             sm."authorHandle", sm."publishedAt",
             sm."sourceMetadata" -> 'socialTriage' ->> 'language' AS language
      FROM social_mentions sm
      WHERE sm."purgedAt" IS NULL
        AND sm.text IS NOT NULL
        AND length(btrim(sm.text)) > 0
        ${organizationId ? Prisma.sql`AND sm."organizationId" = ${organizationId}` : Prisma.empty}
      ORDER BY sm.id
    `

    const flipped: Array<{ row: MentionRow; before: string; after: string }> = []
    let baseAccepted = 0
    let simAccepted = 0

    for (const row of rows) {
      const input = toIngestInput(row)
      const before = decideSubjectRelevance(subjects, input)
      const after = decideSubjectRelevance(simulated, input)
      if (before?.status === "ACCEPTED") baseAccepted++
      if (after?.status === "ACCEPTED") simAccepted++
      if (before?.status === "ACCEPTED" && after?.status !== "ACCEPTED") {
        flipped.push({ row, before: before.reason, after: after?.reason ?? "(нет решения)" })
      }
    }

    console.log(`Находок: ${rows.length}`)
    console.log(`Принято сейчас:        ${baseAccepted}`)
    console.log(`Принято после пометки: ${simAccepted}`)
    console.log(`Потеряют приём:        ${flipped.length}\n`)

    const byLang = new Map<string, number>()
    for (const item of flipped) {
      const key = item.row.language ?? "(без метки)"
      byLang.set(key, (byLang.get(key) ?? 0) + 1)
    }
    console.log("Кто именно потеряет приём, по языковой метке:")
    for (const [lang, count] of [...byLang].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${lang.padEnd(12)} ${count}`)
    }

    console.log("\nОбразцы потерявших приём (судить: местное или тёзка):")
    for (const item of flipped.slice(0, 25)) {
      const head = item.row.text.replace(/\s+/g, " ").slice(0, 95)
      console.log(`  [${item.row.platform}/${item.row.language ?? "нет"}] ${item.before} → ${item.after}  «${head}»`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

runWithRlsBypass(() => main()).catch(error => {
  console.error(error)
  process.exit(1)
})
