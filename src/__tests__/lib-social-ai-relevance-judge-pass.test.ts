import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  judge: vi.fn(),
  evaluate: vi.fn(),
  persist: vi.fn(),
  isAiFeatureEnabled: vi.fn(),
  checkAiBudget: vi.fn(),
  jev: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMentionSubjectMatch: { findMany: deps.findMany, update: deps.update },
  },
}))
// Реальная обёртка тенанта в этом тесте не нужна: она проверяется отдельно, а
// здесь важна логика решений.
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_organizationId: string, run: () => unknown) => run(),
}))
vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: deps.isAiFeatureEnabled,
  checkAiBudget: deps.checkAiBudget,
}))
vi.mock("@/lib/social/ai-relevance-judge", () => ({
  AI_RELEVANCE_JUDGE_VERSION: "ai_relevance_judge_v2",
  judgeSubjectRelevance: deps.judge,
}))
vi.mock("@/lib/social/jev-relevance-judge", async (importOriginal) => {
  // The threshold helper stays real: the pass's restore rule is what is under
  // test, not a re-statement of it.
  const actual = await importOriginal<typeof import("@/lib/social/jev-relevance-judge")>()
  return { ...actual, judgeSubjectRelevanceWithJev: deps.jev }
})
vi.mock("@/lib/social/subject-relevance", () => ({
  evaluateSubjectRelevance: deps.evaluate,
  persistSubjectMatches: deps.persist,
}))

import {
  judgeAmbiguousAliasRejections,
  JUDGEABLE_REJECTION_REASONS,
} from "@/lib/social/ai-relevance-judge-pass"

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "match-1",
    organizationId: "org-1",
    mentionId: "mention-1",
    subjectId: "subject-1",
    contextSignals: { ambiguousOnly: true },
    mention: {
      id: "mention-1",
      platform: "instagram",
      text: "Grandmart-da qiymətlər iki dəfə artdı",
      authorName: "Aysel",
      authorHandle: "aysel",
      contentKind: "COMMENT",
      sourceType: "comment",
      externalId: "comment-1",
      sentiment: "negative",
      matchedTerm: "grandmart",
      sourceMetadata: {},
      url: "https://instagram.com/p/X",
      canonicalUrl: null,
      parentPostUrl: null,
      postExternalId: null,
      parentExternalId: null,
      threadExternalId: null,
      replyToExternalId: null,
      depth: 0,
      editedAt: null,
      deletedAtSource: null,
      sourceProvider: "provider_api",
      accountId: null,
      publishedAt: new Date("2026-08-01T10:00:00Z"),
      engagement: 0,
      reach: 0,
      authorAvatar: null,
    },
    subject: {
      id: "subject-1",
      name: "Grandmart",
      type: "COMPANY",
      requiredContext: [],
      exclusions: [],
      geographies: ["Azərbaycan"],
      languages: ["az", "ru"],
      aliases: [{ value: "Grandmart" }],
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.isAiFeatureEnabled.mockResolvedValue(true)
  deps.checkAiBudget.mockResolvedValue({ allowed: true, spent: 0, limit: 5, remaining: 5 })
  deps.findMany.mockResolvedValue([candidate()])
  deps.evaluate.mockResolvedValue({
    status: "ACCEPTED",
    matches: [{ subjectId: "subject-1", status: "MATCHED", reason: "subject_alias_match" }],
  })
  deps.persist.mockResolvedValue(undefined)
})

describe("проход судьи по отказам «родовой алиас без второго признака»", () => {
  it("подтверждённую судьёй находку пересчитывает боевой оценкой и возвращает в ленту", async () => {
    deps.judge.mockResolvedValue({ verdict: "about_subject", errorClass: null, version: "ai_relevance_judge_v2" })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ scanned: 1, judged: 1, confirmed: 1, restored: 1 })
    // Решение принимает боевая оценка, а не проход: вердикт лишь передаётся
    // адресно по тому объекту, по которому был отказ.
    expect(deps.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      aiRelevanceJudge: {
        version: "ai_relevance_judge_v2",
        verdicts: { "subject-1": "about_subject" },
      },
    }))
    expect(deps.persist).toHaveBeenCalledWith("org-1", "mention-1", expect.any(Array))
  })

  it.each([
    ["not_about_subject", "notAbout"],
    ["unsure", "unsure"],
  ])("на вердикте %s ничего не пересчитывает, только помечает", async (verdict, counter) => {
    deps.judge.mockResolvedValue({ verdict, errorClass: null, version: "ai_relevance_judge_v2" })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ judged: 1, confirmed: 0, restored: 0, [counter]: 1 })
    // Ключевое свойство: судья работает только в плюс. Отклонённая строка
    // остаётся отклонённой — ни оценка, ни запись решений не вызываются.
    expect(deps.evaluate).not.toHaveBeenCalled()
    expect(deps.persist).not.toHaveBeenCalled()
    // Пометка нужна, иначе проход платил бы за ту же строку каждые несколько минут.
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "match-1" },
      data: { contextSignals: expect.objectContaining({
        ambiguousOnly: true,
        aiJudgeVerdict: verdict,
        aiJudgeVersion: "ai_relevance_judge_v2",
      }) },
    }))
  })

  it("провал провайдера НЕ помечает: строка ждёт следующего прохода", async () => {
    deps.judge.mockResolvedValue({ verdict: null, errorClass: "TIMEOUT", version: "ai_relevance_judge_v2" })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ judged: 1, failed: 1, confirmed: 0 })
    expect(deps.update).not.toHaveBeenCalled()
  })

  it("не судит тенанта без флага ИИ и без бюджета", async () => {
    deps.isAiFeatureEnabled.mockResolvedValue(false)

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ scanned: 1, judged: 0, skippedOrgs: 1 })
    expect(deps.judge).not.toHaveBeenCalled()

    vi.clearAllMocks()
    deps.findMany.mockResolvedValue([candidate()])
    deps.isAiFeatureEnabled.mockResolvedValue(true)
    deps.checkAiBudget.mockResolvedValue({ allowed: false, spent: 9, limit: 5, remaining: 0 })

    const overBudget = await judgeAmbiguousAliasRejections()

    expect(overBudget).toMatchObject({ judged: 0, skippedOrgs: 1 })
    expect(deps.judge).not.toHaveBeenCalled()
  })

  it("выбирает отказы, которые стоит пересмотреть, и только их", async () => {
    deps.judge.mockResolvedValue({ verdict: "unsure", errorClass: null, version: "ai_relevance_judge_v2" })
    await judgeAmbiguousAliasRejections({ organizationId: "org-1", limit: 7 })

    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      // С запасом на уже осуждённые строки: они отбрасываются в коде.
      take: 42,
      where: expect.objectContaining({
        organizationId: "org-1",
        status: "REJECTED",
        reason: { in: JUDGEABLE_REJECTION_REASONS },
        mention: { purgedAt: null, deletedAtSource: null },
      }),
    }))
  })

  // Собственные посты бренда отклонены по политике, а не по спорному решению:
  // судья подтвердил бы их «про нас» каждый раз, и это вернуло бы в ленту
  // мониторинга собственный маркетинг компании.
  it("никогда не пересматривает собственные посты бренда", () => {
    expect(JUDGEABLE_REJECTION_REASONS).not.toContain("official_author")
    expect(JUDGEABLE_REJECTION_REASONS).not.toContain("official_author_excluded_backfill")
  })

  /**
   * Прод, 2026-08-03: выборка вернула ноль при 91 подходящей строке. Отбор шёл
   * JSON-фильтром `contextSignals.aiJudgeVersion not: <версия>`, а у строки без
   * этого ключа путь даёт NULL — сравнение неизвестно, то есть ложно. Тот же
   * класс ошибки, что когда-то прятал живые находки по `archiveOnly`.
   */
  it("не теряет строки, у которых отметки судьи ещё нет вовсе", async () => {
    deps.findMany.mockResolvedValue([
      candidate({ id: "never-judged", contextSignals: { ambiguousOnly: true } }),
      candidate({ id: "judged-older-version", contextSignals: { aiJudgeVersion: "ai_relevance_judge_v1" } }),
      candidate({ id: "judged-this-version", contextSignals: { aiJudgeVersion: "ai_relevance_judge_v2" } }),
    ])
    deps.judge.mockResolvedValue({ verdict: "unsure", errorClass: null, version: "ai_relevance_judge_v2" })

    const result = await judgeAmbiguousAliasRejections()

    // Обе неосуждённые этой версией берутся, уже осуждённая — нет.
    expect(result).toMatchObject({ scanned: 2, judged: 2 })
    expect(deps.update.mock.calls.map(call => call[0].where.id)).toEqual([
      "never-judged",
      "judged-older-version",
    ])
  })

  it("останавливается по дедлайну, не начав лишнего вызова", async () => {
    deps.findMany.mockResolvedValue([candidate(), candidate({ id: "match-2" })])
    deps.judge.mockResolvedValue({ verdict: "about_subject", errorClass: null, version: "ai_relevance_judge_v2" })

    const result = await judgeAmbiguousAliasRejections({ deadlineAt: new Date(Date.now() - 1) })

    expect(result).toMatchObject({ scanned: 2, judged: 0, reason: "deadline_reached" })
    expect(deps.judge).not.toHaveBeenCalled()
  })
})

/**
 * Jev as the judge (owner decision, 2026-09-28: "Jev wherever it copes", with
 * two named limits — it may not answer, and it cannot read pictures). The pass
 * is where those limits have to turn into behaviour: what gets restored, what
 * gets stamped so it is not paid for twice, and what is left alone to be
 * looked at again.
 */
describe("судья на Jev", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "apikey_test")
    vi.stubEnv("SOCIAL_JUDGE_PROVIDER", "jev")
  })
  afterEach(() => vi.unstubAllEnvs())

  it("возвращает в ленту только уверенный ответ", async () => {
    deps.jev.mockResolvedValue({ verdict: "about_subject", confidence: 0.97, errorClass: null })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ provider: "jev", judged: 1, confirmed: 1, restored: 1 })
    expect(deps.judge).not.toHaveBeenCalled()
    // Страна и язык бренда уходят в вопрос — без них одноимённый магазин за
    // рубежом читается как наша сеть.
    expect(deps.jev).toHaveBeenCalledWith(expect.objectContaining({
      geographies: ["Azərbaycan"],
      languages: ["az", "ru"],
    }))
  })

  // Ниже порога ответ измеренно ненадёжен: не действуем, но помечаем — он не
  // изменится на следующем проходе, а платить за него дважды незачем.
  it("не возвращает ответ ниже порога, но помечает его", async () => {
    deps.jev.mockResolvedValue({ verdict: "about_subject", confidence: 0.62, errorClass: null })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ belowThreshold: 1, confirmed: 0, restored: 0 })
    expect(deps.evaluate).not.toHaveBeenCalled()
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contextSignals: expect.objectContaining({
          aiJudgeVerdict: "unsure",
          aiJudgeConfidence: 0.62,
          aiJudgeRawVerdict: "about_subject",
        }),
      }),
    }))
  })

  // Фотография: судить нечего. Строку НЕ помечаем — текст может приехать
  // позже правкой, и тогда её посмотрят заново.
  it("не судит запись без собственного текста и не помечает её", async () => {
    deps.jev.mockResolvedValue({ verdict: null, confidence: null, errorClass: "NO_TEXT" })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ noText: 1, confirmed: 0, restored: 0, failed: 0 })
    expect(deps.update).not.toHaveBeenCalled()
    expect(deps.evaluate).not.toHaveBeenCalled()
  })

  // Провайдер не ответил — значит, он ничего не сказал: строка остаётся в
  // очереди, а не уходит из неё с пустым вердиктом.
  it.each(["TIMEOUT", "PROVIDER_ERROR", "MISSING_KEY"])("молчание провайдера (%s) ничего не меняет", async (errorClass) => {
    deps.jev.mockResolvedValue({ verdict: null, confidence: null, errorClass })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ failed: 1, confirmed: 0, restored: 0 })
    expect(deps.update).not.toHaveBeenCalled()
  })

  it("на вердикте «не про нас» помечает и не трогает ленту", async () => {
    deps.jev.mockResolvedValue({ verdict: "not_about_subject", confidence: 0.95, errorClass: null })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ notAbout: 1, restored: 0 })
    expect(deps.evaluate).not.toHaveBeenCalled()
    expect(deps.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contextSignals: expect.objectContaining({
          aiJudgeVerdict: "not_about_subject",
          aiJudgeVersion: "jev_relevance_judge_v1",
        }),
      }),
    }))
  })

  it("без ключа возвращается к судье на Haiku", async () => {
    vi.unstubAllEnvs()
    vi.stubEnv("TYPESAFE_API_KEY", "")
    deps.judge.mockResolvedValue({ verdict: "about_subject", errorClass: null, version: "ai_relevance_judge_v2" })

    const result = await judgeAmbiguousAliasRejections()

    expect(result).toMatchObject({ provider: "anthropic", restored: 1 })
    expect(deps.jev).not.toHaveBeenCalled()
  })
})
