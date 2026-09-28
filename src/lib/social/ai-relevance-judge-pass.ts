import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { checkAiBudget, isAiFeatureEnabled } from "@/lib/ai/budget"
import {
  AI_RELEVANCE_JUDGE_VERSION,
  judgeSubjectRelevance,
  type AiRelevanceVerdict,
} from "@/lib/social/ai-relevance-judge"
import { evaluateSubjectRelevance, persistSubjectMatches } from "@/lib/social/subject-relevance"
import {
  jevVerdictIsTrustworthy,
  judgeSubjectRelevanceWithJev,
  JEV_RELEVANCE_JUDGE_VERSION,
} from "@/lib/social/jev-relevance-judge"

/**
 * Фоновый проход судьи по отказам «родовой алиас без второго признака».
 *
 * Почему отдельным проходом, а не внутри приёма. Судья — сетевой вызов; ставить
 * его в ingest значит платить задержкой за каждую запись и ломать импорт при
 * недоступности провайдера. Поэтому решение принимается позже, по сохранённой
 * строке, и подаётся в ту же боевую оценку релевантности готовым вердиктом.
 *
 * Почему только в плюс. Замер на проде 2026-08-03: на явных упоминаниях бренда
 * судья дал 40 из 40 «про нас» — настоящие находки он не выбрасывает. Обратную
 * сторону (сколько настоящих находок он назвал бы чужими) на такой выборке не
 * измерить, а цена ошибки — потерянная жалоба клиента. Поэтому «не про нас» и
 * «не уверен» ничего не меняют: запись остаётся отклонённой, как и была.
 *
 * Идемпотентность. Вердикт остаётся в contextSignals матча вместе с версией
 * судьи, и выборка исключает уже осуждённые этой версией строки. Иначе проход
 * каждые несколько минут заново платил бы за те же записи.
 */
export const AI_RELEVANCE_JUDGE_PASS_FEATURE = "ai"

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 200
// Запас на уже осуждённые строки, которые отбрасываются в коде.
const MAX_SCAN_FACTOR = 6
const MAX_SCAN_ROWS = 600

export type AiRelevanceJudgePassResult = {
  scanned: number
  judged: number
  confirmed: number
  restored: number
  notAbout: number
  unsure: number
  failed: number
  skippedOrgs: number
  /** Records whose own text is too short to judge — a picture, in practice. */
  noText: number
  /** Answers below the restore threshold: heard, deliberately not acted on. */
  belowThreshold: number
  provider: "jev" | "anthropic"
  reason?: string
}

/**
 * Which judge runs (owner decision, 2026-09-28: "Jev wherever it copes").
 *
 * Jev is chosen when its key is present because it was measured on our own
 * records and reports a confidence we can gate on; the Haiku judge stays as
 * the path for installations without that key. `SOCIAL_JUDGE_PROVIDER`
 * overrides both, so a bad provider day is one environment variable away from
 * being switched back rather than a deploy.
 */
export function relevanceJudgeProvider(): "jev" | "anthropic" {
  const forced = process.env.SOCIAL_JUDGE_PROVIDER
  if (forced === "jev" || forced === "anthropic") return forced
  return process.env.TYPESAFE_API_KEY ? "jev" : "anthropic"
}

function emptyResult(): AiRelevanceJudgePassResult {
  return {
    scanned: 0,
    judged: 0,
    confirmed: 0,
    restored: 0,
    notAbout: 0,
    unsure: 0,
    failed: 0,
    skippedOrgs: 0,
    noText: 0,
    belowThreshold: 0,
    provider: relevanceJudgeProvider(),
  }
}

type JudgeCandidate = {
  id: string
  organizationId: string
  mentionId: string
  subjectId: string
  contextSignals: unknown
  mention: {
    id: string
    platform: string
    text: string
    authorName: string | null
    authorHandle: string | null
    contentKind: string
    sourceType: string | null
    externalId: string
    sentiment: string | null
    matchedTerm: string | null
    sourceMetadata: unknown
    url: string | null
    canonicalUrl: string | null
    parentPostUrl: string | null
    postExternalId: string | null
    parentExternalId: string | null
    threadExternalId: string | null
    replyToExternalId: string | null
    depth: number
    editedAt: Date | null
    deletedAtSource: Date | null
    sourceProvider: string | null
    accountId: string | null
    publishedAt: Date | null
    engagement: number
    reach: number
    authorAvatar: string | null
  }
  subject: {
    id: string
    name: string
    type?: string | null
    requiredContext: string[]
    exclusions: string[]
    geographies?: string[]
    languages?: string[]
    aliases: Array<{ value: string }>
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Отметка «эту строку уже судили», чтобы не платить за неё повторно. */
async function stampVerdict(
  candidate: JudgeCandidate,
  verdict: string,
  now: Date,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.socialMentionSubjectMatch.update({
    where: { id: candidate.id },
    data: {
      contextSignals: {
        ...asRecord(candidate.contextSignals),
        aiJudgeVerdict: verdict,
        aiJudgeVersion: judgeVersion(),
        aiJudgedAt: now.toISOString(),
        ...extra,
      },
    },
  })
}

/** The stamp carries which judge decided, so a re-run never re-pays for a row
 *  the OTHER judge already answered. */
function judgeVersion(): string {
  return relevanceJudgeProvider() === "jev"
    ? JEV_RELEVANCE_JUDGE_VERSION
    : AI_RELEVANCE_JUDGE_VERSION
}

export async function judgeAmbiguousAliasRejections(options: {
  organizationId?: string
  limit?: number
  deadlineAt?: Date
  now?: Date
} = {}): Promise<AiRelevanceJudgePassResult> {
  const now = options.now ?? new Date()
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const result = emptyResult()

  // Уже осуждённые этой версией отбираются В КОДЕ, а не JSON-фильтром.
  // Прод показал почему: у строки без ключа `aiJudgeVersion` путь даёт NULL, и
  // `not: <версия>` для неё неизвестен, то есть ложен — выборка вернула ноль
  // при 91 подходящей строке. Тот же класс ошибки, что и с `archiveOnly`.
  const rows = await prisma.socialMentionSubjectMatch.findMany({
    where: {
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      status: "REJECTED",
      reason: "ambiguous_alias_requires_second_signal",
      mention: { purgedAt: null, deletedAtSource: null },
    },
    orderBy: { decidedAt: "desc" },
    take: Math.min(limit * MAX_SCAN_FACTOR, MAX_SCAN_ROWS),
    select: {
      id: true,
      organizationId: true,
      mentionId: true,
      subjectId: true,
      contextSignals: true,
      mention: {
        select: {
          id: true, platform: true, text: true, authorName: true, authorHandle: true,
          contentKind: true, sourceType: true, externalId: true, sentiment: true,
          matchedTerm: true, sourceMetadata: true, url: true, canonicalUrl: true,
          parentPostUrl: true, postExternalId: true, parentExternalId: true,
          threadExternalId: true, replyToExternalId: true, depth: true, editedAt: true,
          deletedAtSource: true, sourceProvider: true, accountId: true, publishedAt: true,
          engagement: true, reach: true, authorAvatar: true,
        },
      },
      subject: {
        select: {
          id: true, name: true, type: true, requiredContext: true, exclusions: true,
          geographies: true, languages: true,
          aliases: { select: { value: true } },
        },
      },
    },
  }) as unknown as JudgeCandidate[]

  const candidates = rows
    .filter(row => asRecord(row.contextSignals).aiJudgeVersion !== judgeVersion())
    .slice(0, limit)

  result.scanned = candidates.length
  if (candidates.length === 0) return result

  // Гейт и бюджет проверяются по организации, а не глобально: один тенант с
  // выбранным бюджетом не должен останавливать проход остальным.
  const orgAllowed = new Map<string, boolean>()
  const allowedForOrg = async (organizationId: string): Promise<boolean> => {
    const cached = orgAllowed.get(organizationId)
    if (cached !== undefined) return cached
    const enabled = await isAiFeatureEnabled(organizationId, AI_RELEVANCE_JUDGE_PASS_FEATURE)
    const budget = enabled ? await checkAiBudget(organizationId) : null
    const allowed = enabled && Boolean(budget?.allowed)
    orgAllowed.set(organizationId, allowed)
    if (!allowed) result.skippedOrgs += 1
    return allowed
  }

  for (const candidate of candidates) {
    if (options.deadlineAt && Date.now() >= options.deadlineAt.getTime()) {
      result.reason = "deadline_reached"
      break
    }
    if (!candidate.mention?.text?.trim() || !candidate.subject) continue
    if (!await allowedForOrg(candidate.organizationId)) continue

    const common = {
      text: candidate.mention.text,
      platform: candidate.mention.platform,
      authorName: candidate.mention.authorName,
      authorHandle: candidate.mention.authorHandle,
      subjectName: candidate.subject.name,
      aliases: candidate.subject.aliases.map(alias => alias.value),
      requiredContext: candidate.subject.requiredContext ?? [],
      negativeTerms: candidate.subject.exclusions ?? [],
    }
    let confidence: number | null = null
    let verdict: { verdict: AiRelevanceVerdict | null }
    if (result.provider === "jev") {
      const answer = await judgeSubjectRelevanceWithJev({
        ...common,
        subjectType: candidate.subject.type ?? null,
        geographies: candidate.subject.geographies ?? [],
        languages: candidate.subject.languages ?? [],
      })
      confidence = answer.confidence
      // A picture is not evidence, and a provider that did not answer has said
      // nothing. Neither is stamped: both rows come back on the next pass.
      if (answer.errorClass === "NO_TEXT") {
        result.judged += 1
        result.noText += 1
        continue
      }
      // "about_subject" below the threshold is not acted on — the benchmark
      // measured that region as a coin flip — but it IS stamped, because the
      // answer will not change on a re-run and paying for it twice is waste.
      if (jevVerdictIsTrustworthy(answer) || answer.verdict !== "about_subject") {
        verdict = answer
      } else {
        result.judged += 1
        result.belowThreshold += 1
        await runWithTenant(candidate.organizationId, () => stampVerdict(
          candidate,
          "unsure",
          now,
          { aiJudgeConfidence: answer.confidence, aiJudgeRawVerdict: answer.verdict },
        ))
        continue
      }
    } else {
      verdict = await judgeSubjectRelevance(common)
    }
    result.judged += 1
    if (!verdict.verdict) {
      // Провал провайдера НЕ отмечаем: строка должна остаться в очереди на
      // следующий проход, иначе таймаут навсегда лишил бы её второго признака.
      result.failed += 1
      continue
    }
    if (verdict.verdict !== "about_subject") {
      if (verdict.verdict === "not_about_subject") result.notAbout += 1
      else result.unsure += 1
      await runWithTenant(candidate.organizationId, () => stampVerdict(
        candidate,
        verdict.verdict!,
        now,
        confidence === null ? {} : { aiJudgeConfidence: confidence },
      ))
      continue
    }

    result.confirmed += 1
    // Дальше решение принимает боевая оценка, а не этот модуль: судья лишь
    // добавляет второй сигнал. Если правила откажут по другой причине —
    // обязательный контекст, вето исключения — так и должно быть.
    const restored = await runWithTenant(candidate.organizationId, async () => {
      const mention = candidate.mention
      const decision = await evaluateSubjectRelevance({
        organizationId: candidate.organizationId,
        accountId: mention.accountId,
        platform: mention.platform,
        externalId: mention.externalId,
        sourceType: mention.sourceType ?? undefined,
        contentKind: mention.contentKind,
        postExternalId: mention.postExternalId,
        parentExternalId: mention.parentExternalId,
        threadExternalId: mention.threadExternalId,
        replyToExternalId: mention.replyToExternalId,
        depth: mention.depth,
        canonicalUrl: mention.canonicalUrl,
        parentPostUrl: mention.parentPostUrl,
        editedAt: mention.editedAt,
        deletedAtSource: mention.deletedAtSource,
        sourceProvider: mention.sourceProvider ?? undefined,
        sourceMetadata: asRecord(mention.sourceMetadata),
        text: mention.text,
        sentiment: (mention.sentiment ?? null) as "positive" | "neutral" | "negative" | null,
        matchedTerm: mention.matchedTerm,
        engagement: mention.engagement,
        reach: mention.reach,
        url: mention.url,
        authorName: mention.authorName,
        authorHandle: mention.authorHandle,
        authorAvatar: mention.authorAvatar,
        publishedAt: mention.publishedAt,
        aiRelevanceJudge: {
          version: verdict.version,
          verdicts: { [candidate.subjectId]: "about_subject" },
        },
      })
      if (!decision) return false
      await persistSubjectMatches(candidate.organizationId, mention.id, decision.matches)
      return decision.matches.some(match => (
        match.subjectId === candidate.subjectId && match.status === "MATCHED"
      ))
    })
    if (restored) result.restored += 1
  }

  return result
}
