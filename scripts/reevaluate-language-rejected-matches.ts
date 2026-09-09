/**
 * Пересчитывает находки, отклонённые языковым гейтом до его разжалования.
 *
 * Гейт `subject_language_mismatch` (#656) возвращал REJECTED, если язык находки
 * не входил в `languages` объекта. В #666 он разжалован до пометки, но уже
 * записанные вердикты сами не пересчитаются: решение хранится строкой в
 * `social_mention_subject_matches`.
 *
 * Почему нельзя просто поменять статус. Гейт стоял ДО сопоставления алиасов и
 * делал ранний return, поэтому у отклонённых им находок релевантность вообще
 * не вычислялась. `UPDATE status = 'MATCHED'` не вернул бы вердикт, а выдумал
 * его — и протащил бы в ленту клиента непроверенные находки.
 *
 * Почему не replay конверта. Штатный `ingest-envelope-replay` заново прогнал бы
 * ingest вместе с оценкой релевантности, но payload конвертов истёк: на
 * 2026-08-03 из отклонённых по языку живой payload оставался у 3 находок из 117.
 *
 * Что делает. Восстанавливает `IngestInput` из сохранённой строки
 * `social_mentions` и заново зовёт боевые `evaluateSubjectRelevance` +
 * `persistSubjectMatches`. Правила не дублируются: считает тот же код, что и
 * приём, поэтому результат совпадёт с тем, что дал бы свежий сбор.
 *
 * ОГРАНИЧЕНИЕ. Два поля входа существуют только в рантайме сбора и из строки не
 * восстанавливаются: `observation` (провенанс) и родительский контекст
 * комментария. Родительский неважен: прежний гейт не трогал находки с
 * унаследованным негативным родителем, поэтому в выборке их нет по построению.
 * `observation` используется ровно одной проверкой — провенансом Google Alerts
 * RSS, поэтому находки с этим провайдером скрипт ПРОПУСКАЕТ: без провенанса
 * неоднозначный алиас потерял бы второй сигнал и был бы отклонён ошибочно.
 *
 * ЗАЧЕМ ФИЛЬТР ПО ЯЗЫКУ. Прогон на проде показал, что выборка неоднородна:
 *   - находки с меткой `ru` — местные упоминания брендов (Baku Electronics,
 *     Araz), которым метку `ru` дала русская обвязка интерфейса Facebook
 *     («Подписаться», «3 дн. ·»); тело поста азербайджанское. Их надо вернуть.
 *   - находки с меткой `en` — в основном НИГЕРИЙСКИЕ ТЁЗКИ: «Oba Market» в
 *     Бенин-Сити, «Bravo Market», новости LAWMA и выборов в Осуне. Возвращать
 *     их нельзя: они пройдут по одному совпадению алиаса.
 * Поэтому язык задаётся явно, а не пересчитывается всё подряд.
 *
 *   npx tsx scripts/reevaluate-language-rejected-matches.ts --slug=brandprotection
 *   npx tsx scripts/reevaluate-language-rejected-matches.ts --slug=brandprotection --language=ru
 *   npx tsx scripts/reevaluate-language-rejected-matches.ts --slug=brandprotection --language=ru --apply
 *
 * В режиме `matched` КОММЕНТАРИИ ПРОПУСКАЮТСЯ. Комментарий получает релевантность
 * от родительского поста, а не от своего текста, и этот контекст из строки не
 * восстановить — пересчёт дал бы им ложный `no_monitoring_subject_match`. На
 * проде это 109 местных комментариев, включая жалобы на товар.
 *
 * ОБЛАСТЬ (--scope). По умолчанию `language-rejected` — то, ради чего скрипт
 * писался. Режим `matched` пересчитывает уже ПРИНЯТЫЕ находки: он нужен после
 * изменения правил отбора, когда старые вердикты перестали соответствовать
 * текущей логике. Например, после пометки родовых алиасов неоднозначными
 * (#664): новые тёзки отсекаются сразу, а принятые раньше остаются принятыми,
 * пока их не пересчитают.
 *
 * ОБЛАСТЬ `ambiguous-alias` (#646). Находки, отклонённые с
 * `ambiguous_alias_requires_second_signal`: алиас в тексте есть, но он родовой
 * («Grandmart», «Bravo»), и правилам нужен второй признак — контекстное слово,
 * география, совпадение языка. Здесь второй признак спрашивается у ИИ-судьи.
 *
 * Меняем только в одну сторону: пересчёт и запись идут ТОЛЬКО когда судья сказал
 * «про нас». На «не про нас» и «не уверен» строка остаётся как есть, поэтому
 * проход не может ничего отнять — ни у правил, ни у оператора.
 *
 *   ANTHROPIC_API_KEY=… npx tsx scripts/reevaluate-language-rejected-matches.ts  *     --slug=brandprotection --scope=ambiguous-alias
 *   … --scope=ambiguous-alias --apply
 *
 * Dry-run — ДЕФОЛТ: случайный запуск ничего не меняет.
 */
import { Prisma, type PrismaClient } from "@prisma/client"

import { makeScriptPrisma } from "./_rls.mjs"
import { runWithRlsBypass } from "../src/lib/rls-context"
import { evaluateSubjectRelevance, persistSubjectMatches } from "../src/lib/social/subject-relevance"
import type { IngestInput } from "../src/lib/social/ingest-mention"
import {
  AI_RELEVANCE_JUDGE_VERSION,
  judgeSubjectRelevance,
} from "../src/lib/social/ai-relevance-judge"

function arg(name: string): string | undefined {
  const found = process.argv.find(value => value.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

const REJECT_REASON = "subject_language_mismatch"
const AMBIGUOUS_ALIAS_REASON = "ambiguous_alias_requires_second_signal"
// Единственная проверка, которой нужен нереконструируемый `observation`.
const PROVENANCE_DEPENDENT_PROVIDERS = new Set(["google_alerts", "google_alerts_rss"])
// Комментарий получает релевантность от родительского поста, а не от своего
// текста: «Dəhşət» или «Bizdə soyducu aldığ işləmir» бренда не называют вовсе.
// Родительский контекст живёт только в рантайме сбора, поэтому пересчёт по
// сохранённой строке даёт им no_monitoring_subject_match — ложный отказ.
// Прогон по проду: 109 местных комментариев, включая жалобы на товар.
const PARENT_CONTEXT_KINDS = new Set(["COMMENT", "REPLY"])

type MentionRow = {
  id: string
  organizationId: string
  accountId: string | null
  platform: string
  externalId: string
  sourceType: string | null
  contentKind: string | null
  postExternalId: string | null
  parentExternalId: string | null
  threadExternalId: string | null
  replyToExternalId: string | null
  depth: number | null
  canonicalUrl: string | null
  parentPostUrl: string | null
  editedAt: Date | null
  deletedAtSource: Date | null
  sourceProvider: string | null
  sourceMetadata: unknown
  text: string
  sentiment: string | null
  matchedTerm: string | null
  engagement: number | null
  reach: number | null
  url: string | null
  authorName: string | null
  authorHandle: string | null
  authorAvatar: string | null
  publishedAt: Date | null
  language: string | null
  /** Только в области ambiguous-alias: объект, по которому вынесен отказ. */
  subjectId?: string | null
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
    postExternalId: row.postExternalId,
    parentExternalId: row.parentExternalId,
    threadExternalId: row.threadExternalId,
    replyToExternalId: row.replyToExternalId,
    depth: row.depth ?? undefined,
    canonicalUrl: row.canonicalUrl,
    parentPostUrl: row.parentPostUrl,
    editedAt: row.editedAt,
    deletedAtSource: row.deletedAtSource,
    sourceProvider: row.sourceProvider ?? undefined,
    sourceMetadata,
    text: row.text,
    sentiment,
    matchedTerm: row.matchedTerm,
    engagement: row.engagement ?? undefined,
    reach: row.reach ?? undefined,
    url: row.url,
    authorName: row.authorName,
    authorHandle: row.authorHandle,
    authorAvatar: row.authorAvatar,
    publishedAt: row.publishedAt,
  }
}

async function main() {
  const slug = arg("slug")
  const language = arg("language")?.trim().toLowerCase()
  const scope = (arg("scope") ?? "language-rejected").trim()
  if (scope !== "language-rejected" && scope !== "matched" && scope !== "ambiguous-alias") {
    throw new Error(`unknown_scope_${scope}`)
  }
  const judgeScope = scope === "ambiguous-alias"
  if (judgeScope && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ambiguous-alias scope requires ANTHROPIC_API_KEY")
  }
  const limit = Number(arg("limit") ?? "0") || 0
  const apply = hasFlag("apply")
  const prisma: PrismaClient = await makeScriptPrisma()

  try {
    let organizationId: string | undefined
    if (slug) {
      const org = await prisma.organization.findFirst({ where: { slug }, select: { id: true, name: true } })
      if (!org) throw new Error(`organization_not_found_for_slug_${slug}`)
      organizationId = org.id
      console.log(`Организация: ${org.name} (${org.id})`)
    }

    const rows = await prisma.$queryRaw<MentionRow[]>`
      SELECT DISTINCT
             ${judgeScope ? Prisma.sql`msm."subjectId" AS "subjectId",` : Prisma.empty}
             sm.id, sm."organizationId", sm."accountId", sm.platform, sm."externalId",
             sm."sourceType", sm."contentKind", sm."postExternalId", sm."parentExternalId",
             sm."threadExternalId", sm."replyToExternalId", sm.depth, sm."canonicalUrl",
             sm."parentPostUrl", sm."editedAt", sm."deletedAtSource", sm."sourceProvider",
             sm."sourceMetadata", sm.text, sm.sentiment, sm."matchedTerm", sm.engagement,
             sm.reach, sm.url, sm."authorName", sm."authorHandle", sm."authorAvatar",
             sm."publishedAt",
             sm."sourceMetadata" -> 'socialTriage' ->> 'language' AS language
      FROM social_mention_subject_matches msm
      JOIN social_mentions sm ON sm.id = msm."mentionId"
      WHERE ${scope === "matched"
        ? Prisma.sql`msm.status = 'MATCHED'`
        : judgeScope
          ? Prisma.sql`msm.status = 'REJECTED' AND msm.reason = ${AMBIGUOUS_ALIAS_REASON}`
          : Prisma.sql`msm.status = 'REJECTED' AND msm.reason = ${REJECT_REASON}`}
        AND msm.reason <> 'operator_review_accept'
        AND sm."purgedAt" IS NULL
        ${organizationId ? Prisma.sql`AND msm."organizationId" = ${organizationId}` : Prisma.empty}
        ${language ? Prisma.sql`AND lower(sm."sourceMetadata" -> 'socialTriage' ->> 'language') = ${language}` : Prisma.empty}
      ORDER BY sm.id
    `

    console.log(`\nК пересчёту: ${rows.length} находок [область ${scope}]${language ? ` (только язык ${language})` : " (ВСЕ языки)"}${apply ? "" : "  (dry-run — ничего не пишется)"}\n`)
    if (!language && scope === "language-rejected") {
      console.log("  ВНИМАНИЕ: без --language пересчитываются и находки с меткой en,")
      console.log("  среди которых на проде преобладают зарубежные тёзки. См. шапку файла.\n")
    }

    const tally = { matched: 0, stillRejected: 0, review: 0, skipped: 0, noSubjects: 0 }
    const judgeTally = { about: 0, notAbout: 0, unsure: 0, failed: 0 }
    const subjectCache = new Map<string, {
      name: string
      aliases: string[]
      requiredContext: string[]
      exclusions: string[]
    } | null>()

    async function judgeRow(row: MentionRow): Promise<boolean> {
      const subjectId = row.subjectId ?? null
      if (!subjectId) return false
      if (!subjectCache.has(subjectId)) {
        const subject = await prisma.monitoringSubject.findFirst({
          where: { id: subjectId },
          select: { name: true, requiredContext: true, exclusions: true, aliases: { select: { value: true } } },
        })
        subjectCache.set(subjectId, subject
          ? {
              name: subject.name,
              aliases: subject.aliases.map(alias => alias.value),
              requiredContext: subject.requiredContext ?? [],
              exclusions: subject.exclusions ?? [],
            }
          : null)
      }
      const subject = subjectCache.get(subjectId)
      if (!subject) return false
      const result = await judgeSubjectRelevance({
        text: row.text,
        platform: row.platform,
        authorName: row.authorName,
        authorHandle: row.authorHandle,
        subjectName: subject.name,
        aliases: subject.aliases,
        requiredContext: subject.requiredContext,
        negativeTerms: subject.exclusions,
      })
      if (!result.verdict) {
        judgeTally.failed++
        console.log(`  СУДЬЯ НЕ ОТВЕТИЛ ${row.id} — ${result.errorClass}`)
        return false
      }
      if (result.verdict === "about_subject") judgeTally.about++
      else if (result.verdict === "not_about_subject") judgeTally.notAbout++
      else judgeTally.unsure++
      return result.verdict === "about_subject"
    }

    let judged = 0
    for (const row of rows) {
      const provider = (row.sourceProvider ?? "").toLowerCase()
      if (PROVENANCE_DEPENDENT_PROVIDERS.has(provider)) {
        tally.skipped++
        console.log(`  ПРОПУСК ${row.id} — провайдер ${provider}: провенанс из строки не восстановить`)
        continue
      }
      const kind = (row.contentKind ?? "").toUpperCase()
      if (scope === "matched" && PARENT_CONTEXT_KINDS.has(kind)) {
        tally.skipped++
        continue
      }

      let judgeVerdictForInput: IngestInput["aiRelevanceJudge"] = null
      if (judgeScope) {
        if (limit > 0 && judged >= limit) break
        judged++
        const confirmed = await judgeRow(row)
        // Пересчитываем ТОЛЬКО подтверждённые: на «не про нас» и «не уверен»
        // строка не трогается вовсе, поэтому проход не может ничего отнять.
        if (!confirmed) continue
        judgeVerdictForInput = {
          version: AI_RELEVANCE_JUDGE_VERSION,
          verdicts: { [row.subjectId as string]: "about_subject" },
        }
      }

      const decision = await evaluateSubjectRelevance({
        ...toIngestInput(row),
        aiRelevanceJudge: judgeVerdictForInput,
      })
      if (!decision) {
        tally.noSubjects++
        console.log(`  ${row.id} [${row.platform}/${row.language ?? "нет"}] → объектов нет, пропуск`)
        continue
      }

      if (decision.status === "ACCEPTED") tally.matched++
      else if (decision.status === "REVIEW") tally.review++
      else tally.stillRejected++

      const head = row.text.replace(/\s+/g, " ").slice(0, 60)
      const wasLabel = scope === "matched"
        ? "MATCHED"
        : `REJECTED/${judgeScope ? AMBIGUOUS_ALIAS_REASON : REJECT_REASON}`
      // В режиме matched печатаем только изменения: 600 строк «как было» — шум.
      if (scope !== "matched" || decision.status !== "ACCEPTED") {
        console.log(`  ${row.id} [${row.platform}/${row.language ?? "нет"}] ${wasLabel} → ${decision.status}/${decision.reason}  «${head}»`)
      }

      if (apply) {
        await persistSubjectMatches(row.organizationId, row.id, decision.matches)
      }
    }

    if (judgeScope) {
      console.log(`\nСудья: про нас ${judgeTally.about}, не про нас ${judgeTally.notAbout}, не уверен ${judgeTally.unsure}, не ответил ${judgeTally.failed}`)
    }
    console.log(`\nИтог: вернулось в ленту ${tally.matched}, на ревью ${tally.review}, осталось отклонено ${tally.stillRejected}, пропущено ${tally.skipped}, без объектов ${tally.noSubjects}`)
    if (!apply && rows.length > 0) {
      console.log("Это был dry-run. Для записи повторите с --apply.")
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Скрипт зовёт боевой код, который ходит через общий prisma-клиент под RLS.
// Без контекста запрос тихо вернёт 0 строк, поэтому оборачиваем всё целиком.
runWithRlsBypass(() => main()).catch(error => {
  console.error(error)
  process.exit(1)
})
