/**
 * Backfill `sourceMetadata.socialTriage.language` on existing SocialMentions.
 *
 * Языковой фильтр ленты ищет по этому полю. На проде языка не было у 927
 * находок из 941, поэтому выбор «Azərbaycan dili» давал пустую ленту при
 * непустых счётчиках. Инжест починен отдельно (все площадки, а не только
 * `web`) — этот скрипт закрывает уже накопленное.
 *
 * Логика НЕ дублируется: язык определяет тот же `detectArticleLanguage`, что и
 * боевой путь инжеста. Скрипт лишь применяет его к сохранённым строкам.
 *
 * Правила, одинаковые с инжестом:
 *   - пишем только когда языка ещё НЕТ; уже проставленный не трогаем никогда,
 *     чтобы не затереть более точную метку AI-триажа;
 *   - при неуверенности детектора не пишем ничего: ложная метка хуже пустой,
 *     потому что она спрячет находку из-под языкового фильтра;
 *   - источник помечаем `languageSource: "heuristic"`.
 *
 * Ничего, кроме этого поля, не меняется: статусы находок, очередь авто-ревью и
 * контекстные REVIEW-записи не затрагиваются.
 *
 * Прогон на сервере (cross-tenant bypass через makeScriptPrisma):
 *   npx tsx scripts/backfill-social-mention-language.ts                  # dry-run, все орг.
 *   npx tsx scripts/backfill-social-mention-language.ts --slug=brandprotection
 *   npx tsx scripts/backfill-social-mention-language.ts --slug=brandprotection --apply
 *
 * ВАЖНО: dry-run здесь ДЕФОЛТ, в отличие от соседних бэкфиллов с опциональным
 * `--dry-run`. Это массовая запись по проду, поэтому она требует явного
 * `--apply`: случайный запуск не должен ничего изменить.
 */
import type { PrismaClient } from "@prisma/client"

import { makeScriptPrisma } from "./_rls.mjs"
import { detectArticleLanguage } from "../src/lib/social/article-language"

function arg(name: string): string | undefined {
  const found = process.argv.find(value => value.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

const PAGE_SIZE = 500

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

let prisma!: PrismaClient

async function main() {
  const slug = arg("slug")
  const apply = hasFlag("apply")

  prisma = await makeScriptPrisma()

  let organizationId: string | undefined
  if (slug) {
    const org = await prisma.organization.findFirst({ where: { slug }, select: { id: true, name: true } })
    if (!org) throw new Error(`organization_not_found_for_slug_${slug}`)
    organizationId = org.id
    console.log(`Organization: ${org.name} (${org.id})`)
  } else {
    console.log("Organization: все (cross-tenant)")
  }

  const byLanguage = new Map<string, number>()
  const undetectedByPlatform = new Map<string, number>()
  let scanned = 0
  let alreadySet = 0
  let planned = 0
  let written = 0
  let cursor: string | undefined

  for (;;) {
    const page = await prisma.socialMention.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        purgedAt: null,
      },
      select: { id: true, organizationId: true, platform: true, text: true, sourceMetadata: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (page.length === 0) break
    cursor = page[page.length - 1].id

    for (const mention of page) {
      scanned += 1
      const sourceMetadata = record(mention.sourceMetadata)
      const socialTriage = record(sourceMetadata.socialTriage)
      if (typeof socialTriage.language === "string" && socialTriage.language.trim()) {
        alreadySet += 1
        continue
      }
      const detected = detectArticleLanguage(mention.text)
      if (!detected) {
        undetectedByPlatform.set(mention.platform, (undetectedByPlatform.get(mention.platform) ?? 0) + 1)
        continue
      }
      planned += 1
      byLanguage.set(detected, (byLanguage.get(detected) ?? 0) + 1)

      if (apply) {
        await prisma.socialMention.update({
          where: { organizationId_id: { organizationId: mention.organizationId, id: mention.id } },
          data: {
            sourceMetadata: {
              ...sourceMetadata,
              socialTriage: { ...socialTriage, language: detected, languageSource: "heuristic" },
            },
          },
        })
        written += 1
      }
    }
  }

  const undetected = Array.from(undetectedByPlatform.values()).reduce((sum, value) => sum + value, 0)
  console.log("")
  console.log(apply ? "=== ПРИМЕНЕНО ===" : "=== DRY-RUN (ничего не записано) ===")
  console.log(`просмотрено:            ${scanned}`)
  console.log(`язык уже был:           ${alreadySet}`)
  console.log(`будет проставлено:      ${planned}${apply ? ` (записано: ${written})` : ""}`)
  for (const [language, count] of [...byLanguage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${language}: ${count}`)
  }
  console.log(`останется без языка:    ${undetected}`)
  for (const [platform, count] of [...undetectedByPlatform.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${platform}: ${count}`)
  }
  if (!apply && planned > 0) {
    console.log("")
    console.log("Повторите с --apply, чтобы записать.")
  }
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma?.$disconnect()
  })
