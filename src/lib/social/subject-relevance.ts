import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { IngestInput } from "@/lib/social/ingest-mention"
import { detectForeignNamesake } from "@/lib/social/foreign-namesake"
import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"
import { hasCommentComplaintSignal } from "@/lib/social/tiktok-comment-relevance"
import {
  assertValidRelevanceConfidencePolicy,
  DEFAULT_RELEVANCE_CONFIDENCE_POLICY,
  type RelevanceConfidencePolicy,
} from "@/lib/social/relevance-confidence-policy"

export const SUBJECT_MATCHER_VERSION = "subject_relevance_v12_negative_parent_threads"

export type SubjectMatchDecision = {
  subjectId: string
  status: "MATCHED" | "REVIEW" | "REJECTED"
  reason: string
  confidence: number
  matchedAliasIds: string[]
  matchedTerms: string[]
  contextSignals: Record<string, unknown>
}

export type SubjectRelevanceDecision = {
  status: "ACCEPTED" | "REVIEW" | "REJECTED"
  reason: string
  confidence: number
  matchedTerms: string[]
  matches: SubjectMatchDecision[]
}

export type SubjectForMatch = Prisma.MonitoringSubjectGetPayload<{
  include: { aliases: true; sources: { include: { source: true } } }
}>

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function termMatches(corpus: string, rawTerm: string, kind?: string): boolean {
  const term = normalizeSubjectTerm(rawTerm)
  if (!term) return false
  if (kind === "DOMAIN") return corpus.includes(term)
  const prefix = kind === "HANDLE" ? "@?" : kind === "HASHTAG" ? "#?" : ""
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${prefix}${escaped(term)}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(corpus)
}

function isCommentLike(input: IngestInput): boolean {
  return ["COMMENT", "REPLY"].includes(String(input.contentKind).toUpperCase())
    || ["comment", "reply"].includes(String(input.sourceType).toLowerCase())
}

function requiresDirectCommentText(input: IngestInput): boolean {
  if (!isCommentLike(input)) return false
  if (input.observation?.requireMatchedTerm === true) return true
  return ["search_index", "provider_api", "browser_capture", "notification_inbox", "official_discovery"]
    .includes(String(input.sourceProvider).toLowerCase())
}

function inputCorpus(input: IngestInput): string {
  // A comment/reply is relevant only when its OWN body contains the monitored
  // term. Parent URLs, the comment permalink (which embeds the parent video's
  // handle, e.g. tiktok.com/@arazsupermarket/video/…), parent captions and
  // official-page handles are lineage — they must never turn a neutral comment
  // ("спасибо", "Sagol Kamiş") into a brand alias match. Owned/official-source
  // comments are still surfaced via the trustedOwnedSource path in
  // evaluateSubject, which does not depend on this corpus. The provider-scoped
  // requiresDirectCommentText() (search_index/provider_api/…) predated this and
  // leaked parent lineage for every other comment provider (native, legacy
  // Apify), so gate on the content shape itself.
  if (isCommentLike(input)) return normalizeSubjectTerm(input.text)
  const safeMetadata = Object.entries(input.sourceMetadata ?? {})
    .filter(([key, value]) => ["title", "caption", "description", "channelTitle", "pageName"].includes(key) && typeof value === "string")
    .map(([, value]) => String(value))
  return [input.text, input.authorHandle, input.authorName, input.url, input.canonicalUrl, input.parentPostUrl, ...safeMetadata]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSubjectTerm)
    .join(" \n ")
}

function matchedValues(corpus: string, values: string[]): string[] {
  return values.filter(value => termMatches(corpus, value))
}

function sourceIdForInput(input: IngestInput): string | null {
  if (input.observation?.sourceId) return input.observation.sourceId
  const value = input.sourceMetadata?.monitoringSourceId
  return typeof value === "string" && value ? value : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Google Alerts is useful as an independent delivery signal only when every
 * provenance layer agrees: the observation, adapter metadata and the actual
 * scenario-linked source row. Checking only caller-provided metadata would let
 * another collector imitate the trusted route.
 */
function hasVerifiedGoogleAlertsRssProvenance(
  input: IngestInput,
  sourceLink: SubjectForMatch["sources"][number] | null,
): boolean {
  if (!sourceLink?.source || sourceLink.relationType !== "MONITORS") return false
  const source = sourceLink.source
  const sourceSettings = record(source.settings)
  const rssSettings = record(sourceSettings.googleAlertsRss)
  const metadata = record(input.sourceMetadata)
  const policySnapshot = record(input.observation?.policySnapshot)
  const matchedVia = metadata.matchedVia

  return String(input.platform).toLowerCase() === "web"
    && String(input.contentKind).toUpperCase() === "ARTICLE"
    && String(input.sourceProvider).toLowerCase() === "notification_inbox"
    && source.platform === "web"
    && source.sourceType === "notification_inbox"
    && source.collectionMode === "notification_inbox"
    && source.query?.startsWith("google-alerts-rss:") === true
    && source.ownership === "external"
    && ["active", "limited"].includes(source.status)
    && sourceSettings.managedBy === "google_alerts_rss"
    && rssSettings.configured === true
    && rssSettings.policyVersion === "google-alerts-rss-v1"
    && metadata.monitoringSourceId === source.id
    && metadata.collector === "google_alerts_rss"
    && metadata.policyVersion === "google-alerts-rss-v1"
    && (matchedVia === "article_metadata" || matchedVia === "google_alerts_feed_snippet")
    && input.observation?.providerKey === "google_alerts"
    && input.observation?.relevanceStatus === "ACCEPTED"
    && input.observation?.relevanceReason === "google_alerts_rss_verified_newsarticle"
    && policySnapshot.policyVersion === "google-alerts-rss-v1"
    && policySnapshot.transport === "rss"
    && policySnapshot.matchedVia === matchedVia
}

/** True when a negative alias or exclusion of the subject fires on the corpus. */
export function subjectHasNegativeVeto(subject: SubjectForMatch, corpus: string): boolean {
  const negativeAliases = subject.aliases.filter(alias => alias.isNegative || alias.kind === "NEGATIVE")
  return negativeAliases.some(alias => termMatches(corpus, alias.normalizedValue, alias.kind))
    || matchedValues(corpus, subject.exclusions).length > 0
}

function normalizedAuthorIdentity(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().replace(/^@/, "").toLocaleLowerCase()
  return normalized || null
}

function sourceProfileIdentity(source: { handle: string | null; url: string | null }): string[] {
  const values = [source.handle]
  if (source.url) {
    try {
      values.push(new URL(source.url).pathname.split("/").filter(Boolean).at(-1) ?? null)
    } catch {
      // Invalid legacy URLs carry no author identity.
    }
  }
  return values.map(normalizedAuthorIdentity).filter((value): value is string => Boolean(value))
}

const SHARED_SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "t.me",
  "tiktok.com",
  "twitter.com",
  "vk.com",
  "x.com",
  "youtu.be",
  "youtube.com",
]

function subjectOfficialHosts(subject: SubjectForMatch): string[] {
  const values = [
    ...subject.aliases
      .filter(alias => !alias.isNegative && alias.kind === "DOMAIN")
      .map(alias => alias.value),
    ...subject.sources
      .filter(link => ["OWNED", "OFFICIAL"].includes(link.relationType))
      .map(link => link.source.url ?? ""),
  ]
  return Array.from(new Set(values.flatMap(value => {
    const normalized = value.trim()
    if (!normalized) return []
    try {
      const parsed = new URL(normalized.includes("://") ? normalized : `https://${normalized}`)
      const host = parsed.hostname.toLocaleLowerCase().replace(/^www\./u, "").replace(/\.$/u, "")
      if (!host || SHARED_SOCIAL_HOSTS.some(root => host === root || host.endsWith(`.${root}`))) return []
      return [host]
    } catch {
      return []
    }
  })))
}

function normalizedProfileUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ""
    url.search = ""
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, "")
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function metadataStrings(input: IngestInput, keys: string[]): string[] {
  return keys
    .map(key => input.sourceMetadata?.[key])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
}

function directPostAuthorIdentities(input: IngestInput): string[] {
  if (isCommentLike(input)) return []
  const urls = [input.url, input.canonicalUrl].filter((value): value is string => Boolean(value))
  return urls.flatMap(value => {
    try {
      const url = new URL(value)
      const segments = url.pathname.split("/").filter(Boolean)
      const platform = String(input.platform).toLowerCase()
      if (platform === "tiktok" && segments[0]?.startsWith("@")) return [segments[0].slice(1)]
      if (["twitter", "x"].includes(platform) && segments[0] && !["i", "search", "home"].includes(segments[0])) {
        return [segments[0]]
      }
      if (platform === "facebook" && segments[0] && ![
        "reel", "watch", "share", "photo", "groups", "people", "story.php", "profile.php",
      ].includes(segments[0].toLowerCase())) return [segments[0]]
    } catch {
      // A malformed permalink carries no usable author identity.
    }
    return []
  })
}

function isOfficialSubjectAuthor(subject: SubjectForMatch, input: IngestInput): boolean {
  const officialSources = subject.sources
    .filter(link => ["OWNED", "OFFICIAL"].includes(link.relationType) && link.source)
    .map(link => link.source)
  // HANDLE is the existing explicit official-author identity used by the feed
  // scope. Profile setup never guesses or scenario-syncs this alias kind, so
  // it remains safe when global discovery is used without a linked page.
  // NAME and HASHTAG are deliberately excluded: an impersonator may reuse a
  // display name or hashtag, while a platform handle is unique.
  const officialAliasHandles = new Set(subject.aliases
    .filter(alias => alias.kind === "HANDLE" && !alias.isNegative)
    .map(alias => normalizedAuthorIdentity(alias.normalizedValue || alias.value))
    .filter((value): value is string => Boolean(value)))
  const officialSourceIdentities = new Set(officialSources.flatMap(sourceProfileIdentity))
  const officialUrls = new Set(officialSources
    .map(source => normalizedProfileUrl(source.url))
    .filter((value): value is string => Boolean(value)))
  const officialDomains = new Set(officialSources
    .filter(source => source.sourceType === "page" && source.platform === "web")
    .map(source => normalizedProfileUrl(source.url))
    .filter((value): value is string => Boolean(value))
    .map(value => new URL(value).hostname))
  const directHandleValues = [
    input.authorHandle,
    ...directPostAuthorIdentities(input),
    ...metadataStrings(input, ["authorChannelId", "channelId", "authorId", "accountId", "pageId"]),
  ]
  if (directHandleValues.some(value => {
    const normalized = normalizedAuthorIdentity(value)
    return normalized
      ? officialAliasHandles.has(normalized) || officialSourceIdentities.has(normalized)
      : false
  })) return true
  // A linked OWNED/OFFICIAL source may carry a legacy display label instead
  // of a real handle. Preserve that compatibility only for source identities;
  // explicit HANDLE aliases must never match a spoofed display name.
  const normalizedAuthorName = normalizedAuthorIdentity(input.authorName)
  if (normalizedAuthorName && officialSourceIdentities.has(normalizedAuthorName)) return true
  return metadataStrings(input, ["authorUrl", "channelUrl", "profileUrl"]).some(value => {
    const url = normalizedProfileUrl(value)
    return url ? officialUrls.has(url) || officialDomains.has(new URL(url).hostname) : false
  })
}

function evaluateSubject(subject: SubjectForMatch, input: IngestInput, corpus: string): SubjectMatchDecision | null {
  // Brand-authored replies remain outside external-voice KPIs even when their
  // thread is captured in full; "all comments" here means all third-party
  // comments/replies returned by the provider.
  if (isOfficialSubjectAuthor(subject, input)) return { subjectId: subject.id, status: "REJECTED", reason: "official_author", confidence: 1, matchedAliasIds: [], matchedTerms: [], contextSignals: { officialAuthor: true } }
  const parent = input.parentMatchContext
  const inheritsNegativeParent = isCommentLike(input)
    && parent?.parentSentiment?.trim().toLowerCase() === "negative"
    && parent.inheritAllCommentSubjectIds?.includes(subject.id) === true
  const inheritedNegativeParentDecision = (): SubjectMatchDecision => ({
    subjectId: subject.id,
    status: "MATCHED",
    reason: "negative_parent_post_inheritance",
    confidence: 1,
    matchedAliasIds: [],
    matchedTerms: [],
    contextSignals: {
      inheritedFromParent: true,
      parentMentionId: parent?.parentMentionId ?? null,
      parentSentiment: "negative",
      inheritancePolicy: "all_comments_v1",
      sourceId: sourceIdForInput(input),
    },
  })
  const sourceId = sourceIdForInput(input)
  const sourceLink = sourceId ? subject.sources.find(link => link.sourceId === sourceId) : null
  const trustedOwnedSource = !requiresDirectCommentText(input)
    && sourceLink
    && ["OWNED", "OFFICIAL"].includes(sourceLink.relationType)
  // Языки объекта задаёт оператор. Раньше несовпадение ОТКЛОНЯЛО находку; теперь
  // оно только помечается. Причины:
  //
  // 1. Язык — не признак релевантности. Русскоязычный пост про Bravo относится
  //    к Bravo независимо от того, какие языки указаны у объекта.
  // 2. Признак слишком шаток для необратимого решения. Замер по 1037 находкам
  //    (scripts/audit-social-language-labels.ts): из 49 находок, уверенно
  //    турецких по внешней модели, 37 помечены `az`; буквы ğ/ı/ş общие с
  //    турецким, уникальна только `ə`.
  // 3. Гейт был асимметричен: неверная метка резала навсегда, а отсутствующая
  //    пропускала — 18.6% находок метки не имеют вовсе.
  // 4. Проверка стояла ДО сопоставления алиасов, поэтому у отклонённых ею
  //    находок релевантность вообще не вычислялась: вернуть их потом простым
  //    UPDATE нельзя, нужен полный пересчёт.
  //
  // Отбор по языку живёт на показе: фильтр ленты и счётчики принимают список
  // языков, и ошибка там обратима и заметна, в отличие от отклонения.
  //
  // Флаг — чистый факт «язык находки не входит в языки объекта», без оглядки на
  // доверенный источник и наследование: пометке нечего щадить, в отличие от
  // прежнего отклонения.
  const subjectLanguages = (subject.languages ?? [])
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
  const findingLanguage = (() => {
    const metadata = input.sourceMetadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
    const triage = (metadata as Record<string, unknown>).socialTriage
    if (!triage || typeof triage !== "object" || Array.isArray(triage)) return null
    const language = (triage as Record<string, unknown>).language
    return typeof language === "string" && language.trim() ? language.trim().toLowerCase() : null
  })()
  const languageMismatch = subjectLanguages.length > 0
    && findingLanguage !== null
    && !subjectLanguages.includes(findingLanguage)
  // Положительная сторона того же факта — совпадение языка подтверждает, что
  // находка про местный бренд, а не про зарубежного тёзку. Используется вторым
  // сигналом для неоднозначных алиасов (см. hasSecondSignal ниже).
  //
  // Это НЕ отрицание languageMismatch: когда метки нет или языки объекта не
  // заданы, ложны оба. Так и задумано — отсутствие сведений ничего не
  // подтверждает, иначе безметочные находки получали бы второй сигнал даром.
  const languageMatchesSubject = subjectLanguages.length > 0
    && findingLanguage !== null
    && subjectLanguages.includes(findingLanguage)

  // Зарубежный тёзка: имя совпало, но текст написан письменностью, которой на
  // азербайджанском рынке быть не может. Проверяем ДО сопоставления алиасов —
  // совпадение имени тут ничего не доказывает, оно и есть источник ошибки.
  // Наследованный негативный родитель имеет приоритет: ветку обсуждения не
  // рвём, иначе принятый потомок останется без контекста.
  const foreignNamesake = detectForeignNamesake(input.text)
  if (foreignNamesake.foreign && !inheritsNegativeParent) {
    return {
      subjectId: subject.id,
      status: "REJECTED",
      reason: `foreign_namesake_${foreignNamesake.signal}`,
      confidence: 1,
      matchedAliasIds: [],
      matchedTerms: [],
      contextSignals: { foreignNamesake: true },
    }
  }

  if (subjectHasNegativeVeto(subject, corpus)) {
    return inheritsNegativeParent
      ? inheritedNegativeParentDecision()
      : { subjectId: subject.id, status: "REJECTED", reason: "excluded_term", confidence: 1, matchedAliasIds: [], matchedTerms: [], contextSignals: { negativeVeto: true } }
  }

  const positiveAliases = subject.aliases.filter(alias => !alias.isNegative && alias.kind !== "NEGATIVE")
  const matchedAliases = positiveAliases.filter(alias => termMatches(corpus, alias.normalizedValue, alias.kind))
  const requiredContextMatches = matchedValues(corpus, subject.requiredContext)
  // География объекта («Azərbaycan») — ВТОРОЙ подтверждающий сигнал, не более.
  // Родовые имена вроде «Grandmart» и «Bravo Supermarket» собирают зарубежных
  // тёзок, которых не отличить по письменности; упоминание страны рядом с
  // именем как раз отличает.
  //
  // Сама по себе она находку релевантной не делает: до этой точки доходят
  // только тексты с совпавшим алиасом, а обход `missingRequiredContext` ей
  // сознательно НЕ даётся — иначе заполненная география подменяла бы явно
  // заданный оператором обязательный контекст, который строже по замыслу.
  const geographyMatches = matchedValues(corpus, subject.geographies ?? [])
  const contextAliases = matchedAliases.filter(alias => alias.kind === "CONTEXT")
  const identityAliases = matchedAliases.filter(alias => alias.kind !== "CONTEXT")

  // Owner decision 2026-07-19: "show comments that carry our keyword OR negative
  // sentiment about our brands". A comment inside the subject's own brand
  // context — on its OWNED/OFFICIAL channel, or under a post already matched to
  // this subject — is actionable when the comment body itself carries a
  // complaint / negative signal, even without the brand name in the text (a
  // complaint under the brand's own video is exactly what must surface). This
  // deliberately overrides the blanket external-comment `requireMatchedTerm`
  // that comment collectors set (e.g. the YouTube data API), which is what kept
  // brand-channel complaints invisible. The explicit negative-parent
  // full-thread policy is evaluated as a fallback below, so a comment's own
  // complaint/direct signal remains distinguishable and actionable. Comments
  // under unrelated third-party videos remain untouched.
  if (identityAliases.length === 0 && !trustedOwnedSource && isCommentLike(input)) {
    const ownedOrOfficialSource = Boolean(sourceLink && ["OWNED", "OFFICIAL"].includes(sourceLink.relationType))
    const parentMatchedSubject = Boolean(input.parentMatchContext?.subjectIds?.includes(subject.id))
    const negativeInBrandContext = (ownedOrOfficialSource || parentMatchedSubject)
      && hasCommentComplaintSignal(input.text)
    if (negativeInBrandContext) {
      return {
        subjectId: subject.id,
        status: "MATCHED",
        reason: "comment_negative_in_brand_context",
        confidence: ownedOrOfficialSource ? 0.8 : 0.75,
        matchedAliasIds: [],
        matchedTerms: [],
        contextSignals: {
          commentComplaintSignal: true,
          brandContext: ownedOrOfficialSource ? "owned_source" : "parent_post_match",
          sourceId,
          sourceRelationType: sourceLink?.relationType ?? null,
          parentMentionId: input.parentMatchContext?.parentMentionId ?? null,
        },
      }
    }
  }

  // Inheritance is a fallback, not a replacement for the comment's own
  // direct/complaint signal. This preserves actionable reasons and workflow
  // behavior for comments that independently match the subject, while still
  // accepting neutral/off-topic third-party context from the negative thread.
  if (identityAliases.length === 0 && inheritsNegativeParent) {
    return inheritedNegativeParentDecision()
  }
  if (identityAliases.length === 0 && !trustedOwnedSource) return null

  const strongest = identityAliases.reduce((best, alias) => Math.max(best, alias.weight), trustedOwnedSource ? sourceLink!.trustWeight : 0)
  const ambiguousOnly = identityAliases.length > 0 && identityAliases.every(alias => alias.isAmbiguous)
  const collectorMatchedTerm = normalizeSubjectTerm(input.matchedTerm ?? "")
  const verifiedGoogleAlertsExactAlias = Boolean(collectorMatchedTerm)
    && identityAliases.some(alias =>
      !alias.isAmbiguous
      && normalizeSubjectTerm(alias.normalizedValue) === collectorMatchedTerm,
    )
    && hasVerifiedGoogleAlertsRssProvenance(input, sourceLink ?? null)
  // Неоднозначный алиас сам по себе ничего не доказывает: «Oba Market» есть и в
  // Баку, и в Бенин-Сити. Нужен второй, подтверждающий сигнал.
  //
  // Язык здесь — именно подтверждение, а не вето (вето разжаловано в #666).
  // Замер на 1109 находках показал, почему без него нельзя: если пометить
  // родовые алиасы неоднозначными, приём теряют 187 находок, среди которых 36
  // местных — включая жалобы вида «Oba market çox mənasızdır», у которых нет ни
  // географии в тексте, ни контекстного алиаса, ни собственного источника.
  // Обогащение географии городами спасало лишь треть из них. Совпадение языка
  // отделяет такую жалобу от нигерийского тёзки, ничего не отбирая у остальных.
  // Приговор судьи (#646) вторым сигналом БОЛЬШЕ НЕ СЧИТАЕТСЯ.
  //
  // Прод 2026-08-03: включение вернуло в ленту 49 находок, и это оказались
  // чужие тёзки — «Back To School Sale at your Bravo on 41» (США), «Oba market
  // Benin city» (Нигерия), немецкий прайс на баранину. Судья отвечал «про
  // нас» честно: текст правда про магазин с таким названием. Но он не знал, что
  // отслеживается АЗЕРБАЙДЖАНСКИЙ бренд, — а гейт неоднозначного алиаса ровно
  // для этого и стоял.
  //
  // Замер перед включением этого не поймал: группа «прямое совпадение алиаса»
  // состояла из УЖЕ принятых находок, то есть местных. 40 из 40 там означало
  // «судья согласен с верными приёмами», а не «судья отсекает тёзок» — то есть
  // измерялась не та популяция, к которой правило потом применили.
  //
  // Вернуть можно только после того, как в промпт попадёт география объекта и
  // замер пройдёт на выборке С ТЁЗКАМИ. Провенанс в contextSignals оставлен:
  // по нему видно, какие находки держались на слове судьи.
  const hasSecondSignal = contextAliases.length > 0
    || requiredContextMatches.length > 0
    || geographyMatches.length > 0
    || Boolean(trustedOwnedSource)
    || verifiedGoogleAlertsExactAlias
    || languageMatchesSubject
  const missingRequiredContext = subject.requiredContext.length > 0
    && requiredContextMatches.length === 0
    && !trustedOwnedSource
    && !verifiedGoogleAlertsExactAlias
  const needsReview = missingRequiredContext || (ambiguousOnly && !hasSecondSignal)
  const confidence = Math.max(0, Math.min(1,
    strongest
      + (requiredContextMatches.length > 0 ? 0.05 : 0)
      - (ambiguousOnly ? 0.2 : 0)
      - (missingRequiredContext ? 0.25 : 0),
  ))

  if (needsReview && inheritsNegativeParent) {
    return inheritedNegativeParentDecision()
  }

  return {
    subjectId: subject.id,
    status: needsReview ? "REJECTED" : "MATCHED",
    reason: missingRequiredContext
      ? "required_context_missing"
      : ambiguousOnly && !hasSecondSignal
        ? "ambiguous_alias_requires_second_signal"
        : trustedOwnedSource && identityAliases.length === 0
          ? "trusted_subject_source"
          : "subject_alias_match",
    confidence: inheritsNegativeParent ? Math.max(confidence, 1) : confidence,
    matchedAliasIds: matchedAliases.map(alias => alias.id),
    matchedTerms: [...identityAliases.map(alias => alias.value), ...requiredContextMatches],
    contextSignals: {
      requiredContextMatches,
      contextAliasIds: contextAliases.map(alias => alias.id),
      sourceId,
      sourceRelationType: sourceLink?.relationType ?? null,
      trustedOwnedSource: Boolean(trustedOwnedSource),
      verifiedGoogleAlertsExactAlias,
      ambiguousOnly,
      officialHosts: subjectOfficialHosts(subject),
      // Не решение, а наблюдение: по нему можно фильтровать показ и считать,
      // насколько часто язык расходится с настройками объекта.
      languageMismatch,
      // Подтверждающая сторона: видно, что находку удержал именно язык.
      languageMatchesSubject,
    },
  }
}

/**
 * Чистое ядро решения о релевантности: те же exact/context/classifier стадии, но
 * без обращения к БД. Позволяет offline-evaluator-у прогонять gold dataset без
 * Prisma. `evaluateSubjectRelevance` — тонкая обёртка, добавляющая fetch subjects.
 */
export function decideSubjectRelevance(
  subjects: SubjectForMatch[],
  input: IngestInput,
  confidencePolicy: RelevanceConfidencePolicy = DEFAULT_RELEVANCE_CONFIDENCE_POLICY,
): SubjectRelevanceDecision {
  assertValidRelevanceConfidencePolicy(confidencePolicy)
  const corpus = inputCorpus(input)
  const ownMatches = subjects
    .map((subject: SubjectForMatch) => evaluateSubject(subject, input, corpus))
    .filter((match: SubjectMatchDecision | null): match is SubjectMatchDecision => Boolean(match))
  const matches = ownMatches.sort((a: SubjectMatchDecision, b: SubjectMatchDecision) => b.confidence - a.confidence)
  const accepted = matches.filter((match: SubjectMatchDecision) => (
    match.status === "MATCHED" && match.confidence >= confidencePolicy.minAutoAcceptConfidence
  ))
  if (accepted.length > 0) {
    // The aggregate envelope reason is audit/UI metadata. Prefer a signal from
    // the comment itself over context-only inheritance even when both carry
    // confidence 1, then make ties deterministic across database row order.
    const representative = [...accepted].sort((a, b) => {
      const aContextOnly = a.reason === "negative_parent_post_inheritance" ? 1 : 0
      const bContextOnly = b.reason === "negative_parent_post_inheritance" ? 1 : 0
      return aContextOnly - bContextOnly
        || b.confidence - a.confidence
        || a.subjectId.localeCompare(b.subjectId)
    })[0]
    return {
      status: "ACCEPTED",
      reason: representative.reason,
      confidence: representative.confidence,
      matchedTerms: Array.from(new Set(accepted.flatMap((match: SubjectMatchDecision) => match.matchedTerms))),
      matches,
    }
  }
  const rejected = matches.filter(match => match.status === "REJECTED")
  if (rejected.length > 0 && rejected.length === matches.length) {
    return { status: "REJECTED", reason: rejected[0].reason, confidence: rejected[0].confidence, matchedTerms: Array.from(new Set(rejected.flatMap(match => match.matchedTerms))), matches }
  }
  if (matches.length > 0) {
    return {
      status: "REVIEW",
      reason: matches[0].reason,
      confidence: matches[0].confidence,
      matchedTerms: Array.from(new Set(matches.flatMap((match: SubjectMatchDecision) => match.matchedTerms))),
      matches,
    }
  }
  return { status: "REJECTED", reason: "no_monitoring_subject_match", confidence: 1, matchedTerms: [], matches: [] }
}

export async function evaluateSubjectRelevance(input: IngestInput): Promise<SubjectRelevanceDecision | null> {
  // A few legacy unit tests use deliberately narrow Prisma mocks. Treat an
  // absent delegate like the pre-PR3 schema; the real generated client always
  // exposes it.
  const delegate = (prisma as unknown as { monitoringSubject?: typeof prisma.monitoringSubject }).monitoringSubject
  if (!delegate?.findMany) return null
  const subjects = await delegate.findMany({
    where: { organizationId: input.organizationId, status: "active" },
    include: { aliases: true, sources: { include: { source: true } } },
  })
  if (subjects.length === 0) return null
  const metadata = input.sourceMetadata && typeof input.sourceMetadata === "object" && !Array.isArray(input.sourceMetadata)
    ? input.sourceMetadata as Record<string, unknown>
    : {}
  const targetSubjectId = typeof metadata.targetSubjectId === "string"
    ? metadata.targetSubjectId.trim()
    : ""
  const relevantSubjects = targetSubjectId
    ? subjects.filter((subject: { id: string }) => subject.id === targetSubjectId)
    : subjects
  // A profile-scoped provider result must fail closed if its selected subject
  // disappeared between dispatch and import. Falling back to all active
  // subjects would let one monitoring run alter another monitoring's results.
  if (targetSubjectId && relevantSubjects.length === 0) {
    return decideSubjectRelevance([], input)
  }
  return decideSubjectRelevance(relevantSubjects as SubjectForMatch[], input)
}

export async function persistSubjectMatches(
  organizationId: string,
  mentionId: string,
  matches: SubjectMatchDecision[],
) {
  // Official-author observations are deliberately excluded from client-match
  // metrics, but their subject link must survive so the explicit Official
  // author filter can retrieve the archived post.
  for (const match of matches.filter(item => item.status === "MATCHED" || (item.status === "REJECTED" && item.reason === "official_author"))) {
    const create = {
      organizationId,
      mentionId,
      subjectId: match.subjectId,
      status: match.status,
      reason: match.reason,
      confidence: match.confidence,
      matchedAliasIds: match.matchedAliasIds,
      contextSignals: match.contextSignals as Prisma.InputJsonValue,
      matcherVersion: SUBJECT_MATCHER_VERSION,
    }
    const update = {
      status: match.status,
      reason: match.reason,
      confidence: match.confidence,
      matchedAliasIds: match.matchedAliasIds,
      contextSignals: match.contextSignals as Prisma.InputJsonValue,
      matcherVersion: SUBJECT_MATCHER_VERSION,
      decidedAt: new Date(),
    }
    if (match.reason === "operator_review_accept") {
      // An explicit operator decision is authoritative and may replace an
      // earlier automatic match/rejection for the same tenant + subject.
      await prisma.socialMentionSubjectMatch.upsert({
        where: { organizationId_mentionId_subjectId: { organizationId, mentionId, subjectId: match.subjectId } },
        create,
        update,
      })
      continue
    }

    // Automatic re-evaluation may update an automatic row, but it must never
    // overwrite a durable manual MATCHED decision. updateMany gives us a CAS;
    // create then handles the missing-row case without a read/write race.
    const updated = await prisma.socialMentionSubjectMatch.updateMany({
      where: {
        organizationId,
        mentionId,
        subjectId: match.subjectId,
        reason: { not: "operator_review_accept" },
      },
      data: update,
    })
    if (updated.count > 0) continue
    try {
      await prisma.socialMentionSubjectMatch.create({ data: create })
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2002") throw error
      // The unique row appeared between CAS and create. It can only be the
      // protected operator decision (an automatic row would have updated).
    }
  }

  // Do not create a durable row for every rejected observation, but never let
  // an existing MATCHED row survive after the same mention is re-evaluated as
  // REVIEW/REJECTED (for example after adding required geography/context).
  // updateMany is intentional: a previously unseen rejection remains absent,
  // while an existing client-visible link is reconciled in place.
  for (const match of matches.filter(item => item.status !== "MATCHED" && !(item.status === "REJECTED" && item.reason === "official_author"))) {
    await prisma.socialMentionSubjectMatch.updateMany({
      where: {
        organizationId,
        mentionId,
        subjectId: match.subjectId,
        reason: { not: "operator_review_accept" },
      },
      data: {
        status: match.status,
        reason: match.reason,
        confidence: match.confidence,
        matchedAliasIds: match.matchedAliasIds,
        contextSignals: match.contextSignals as Prisma.InputJsonValue,
        matcherVersion: SUBJECT_MATCHER_VERSION,
        decidedAt: new Date(),
      },
    })
  }
}
