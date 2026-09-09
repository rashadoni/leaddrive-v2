import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"
import {
  SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES,
  socialReportEffectiveSubjectWhere,
  socialReportExcludedFeedbackSubjectIds,
  socialReportVisibleMentionWhere,
} from "@/lib/social/report-visibility"
import {
  resolveVisualReportRange,
  type VisualReportRequest,
  type VisualReportSection,
} from "@/lib/social/visual-report-schema"
import {
  mentionSourceLabel,
  type MentionSourceLabel,
} from "@/lib/social/mention-source-label"
import {
  effectiveMonitoringPlatform,
  monitoringPlatformFromUrl,
  normalizeMonitoringPlatform,
} from "@/lib/social/effective-platform"

export const VISUAL_REPORT_DATA_LIMIT = 20_000

export type VisualReportSentiment = "positive" | "neutral" | "negative" | "unknown"

export type VisualReportSource = {
  label: string
  handle: string | null
  url: string | null
  kind: "page" | "group" | "account" | "publisher"
}

export type VisualReportAuthor = {
  name: string | null
  handle: string | null
  label: string
  profileUrl: string | null
}

export type VisualReportContentLinkKind = "direct_comment" | "parent_post" | "publication" | "missing"

export type VisualMonitoringReportItem = {
  id: string
  subjectIds: string[]
  platform: string
  contentType: string
  sentiment: VisualReportSentiment
  publishedAt: string
  // Kept for backwards-compatible cached clients. New renderers use the
  // structured authorProfile value so a name never hides the account handle.
  author: string | null
  authorProfile: VisualReportAuthor | null
  text: string
  // Best available content destination. For comments this is the direct
  // permalink when the provider supplied one, otherwise the parent post.
  url: string | null
  directCommentUrl: string | null
  parentPostUrl: string | null
  linkKind: VisualReportContentLinkKind
  source: VisualReportSource | null
  engagement: number
  reach: number
}

type VisualMonitoringReportObservedSource = {
  platform: string
  sourceType: string
  handle: string | null
  url: string | null
  displayName?: string | null
}

type VisualMonitoringReportParentSource = {
  platform: string
  authorName: string | null
  authorHandle: string | null
  url: string | null
}

export type VisualMonitoringReportMention = {
  id: string
  externalId?: string | null
  platform: string
  contentKind: string
  sourceType: string
  sentiment: string | null
  publishedAt: Date | null
  // Момент появления в системе. Для коллекторов, которые не могут доверенно
  // определить дату публикации (браузерный поиск Facebook), это единственная
  // дата, и без неё находка выпала бы из отчёта целиком.
  createdAt: Date
  authorName: string | null
  authorHandle: string | null
  authorProfileUrl?: string | null
  text: string
  url: string | null
  canonicalUrl?: string | null
  evidenceUrl?: string | null
  // Ссылка на родительский пост: для комментария это единственный след
  // площадки (страницы или группы), под которой он оставлен.
  parentPostUrl: string | null
  observedSource?: VisualMonitoringReportObservedSource | null
  parentSource?: VisualMonitoringReportParentSource | null
  engagement: number
  reach: number
  subjectIds: string[]
}

export type VisualMonitoringReportSnapshot = {
  schemaVersion: "1"
  locale: VisualReportRequest["locale"]
  generatedAt: string
  range: {
    from: string
    to: string
    fromInclusive: string
    toExclusive: string
    days: number
  }
  sections: VisualReportSection[]
  organization: {
    name: string
    primaryColor: string
  }
  subjects: Array<{
    id: string
    name: string
    total: number
    positive: number
    neutral: number
    negative: number
    unknown: number
  }>
  totals: {
    findings: number
    positive: number
    neutral: number
    negative: number
    unknown: number
    engagement: number
    reach: number
  }
  summaryText: string
  sentiment: Array<{
    sentiment: VisualReportSentiment
    count: number
    percentage: number
  }>
  platforms: Array<{
    platform: string
    count: number
    percentage: number
  }>
  trend: Array<{
    date: string
    total: number
    positive: number
    neutral: number
    negative: number
    unknown: number
  }>
  contentTypes: Array<{
    contentType: string
    count: number
    percentage: number
  }>
  topFindings: VisualMonitoringReportItem[]
  // Раздел находок может быть сужен по тональности, тогда как счётчики выше
  // остаются по всем находкам периода. Отчёт обязан объявить это сам.
  topFindingsFilter: {
    sentiments: VisualReportSentiment[]
    matched: number
    shown: number
  }
  // Relevant comments/replies have their own quota so high-engagement posts
  // cannot crowd them out of a client report.
  comments: VisualMonitoringReportItem[]
  commentsFilter: {
    matched: number
    shown: number
  }
  methodology: {
    // Отчёт обязан объявлять, по какой дате он собран: для находок без даты
    // публикации берётся дата обнаружения, иначе они молча выпадали бы.
    dateField: "publishedAt|firstSeenAt"
    globalDeduplication: "mentionId"
    subjectMatchStatus: "MATCHED"
    unclassifiedSentiment: "unknown"
    dataLimit: number
    truncated: boolean
  }
}

export class VisualReportSubjectsNotFoundError extends Error {
  readonly code = "visual_report_subjects_not_found"

  constructor() {
    super("One or more monitoring subjects were not found")
    this.name = "VisualReportSubjectsNotFoundError"
  }
}

type BuildVisualMonitoringReportInput = {
  locale: VisualReportRequest["locale"]
  range: VisualReportRequest["range"]
  sections: VisualReportSection[]
  topFindingsLimit: number
  commentsLimit: number
  topFindingsSentiments: VisualReportSentiment[]
  organization: { name: string; primaryColor?: string | null }
  subjects: Array<{ id: string; name: string }>
  mentions: VisualMonitoringReportMention[]
  commentMentions?: VisualMonitoringReportMention[]
  commentsMatched?: number
  generatedAt?: Date
  truncated?: boolean
}

const SENTIMENTS: VisualReportSentiment[] = ["positive", "neutral", "negative", "unknown"]

function normalizeSentiment(value: string | null): VisualReportSentiment {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "positive" || normalized === "neutral" || normalized === "negative") return normalized
  return "unknown"
}

function normalizeLabel(value: string, fallback: string): string {
  return value.trim().toLowerCase() || fallback
}

function percentage(count: number, total: number): number {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0
}

function safePrimaryColor(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#f97316"
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some(octet => octet < 0 || octet > 255)) return false
  const [first, second, third] = octets
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
}

function safeHttpUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || normalized.length > 2_048) return null
  try {
    const parsed = new URL(normalized)
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
    const bareHostname = hostname.replace(/^\[/, "").replace(/\]$/, "")
    const ipv6 = bareHostname.includes(":")
    if (!hostname || !["http:", "https:"].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password) return null
    if (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || bareHostname === "::"
      || bareHostname === "::1"
      || (ipv6 && (/^(fc|fd)/.test(bareHostname) || /^fe[89ab]/.test(bareHostname) || /^::ffff:/i.test(bareHostname)))
      || isPrivateIpv4(hostname)
    ) return null
    return parsed.toString()
  } catch {
    return null
  }
}

const TRACKING_QUERY_PARAMS = [
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]

function comparableUrl(value: string | null): string | null {
  const safe = safeHttpUrl(value)
  if (!safe) return null
  const parsed = new URL(safe)
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "")
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/"
  for (const parameter of TRACKING_QUERY_PARAMS) parsed.searchParams.delete(parameter)
  const parameters = [...parsed.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ))
  parsed.search = ""
  for (const [key, parameterValue] of parameters) parsed.searchParams.append(key, parameterValue)
  return parsed.toString()
}

function sameUrl(left: string | null, right: string | null): boolean {
  const normalizedLeft = comparableUrl(left)
  const normalizedRight = comparableUrl(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function hasDirectCommentLocator(value: string): boolean {
  const url = new URL(value)
  const queryKeys = [...url.searchParams.keys()].map(key => key.toLowerCase())
  return queryKeys.some(key => [
    "comment",
    "comment_id",
    "thread_comment_id",
    "reply",
    "reply_id",
    "reply_comment_id",
    "lc",
  ].includes(key))
    || /(?:comment|reply)/i.test(url.hash)
}

function isReplyMention(mention: Pick<VisualMonitoringReportMention, "contentKind" | "sourceType">): boolean {
  return (mention.contentKind || "").trim().toUpperCase() === "REPLY"
    || (mention.sourceType || "").trim().toLowerCase() === "reply"
}

function urlTargetsExternalId(value: string, externalId: string | null | undefined): boolean {
  const identity = externalId?.trim()
  if (!identity) return false
  try {
    const url = new URL(value)
    const candidates = [
      ...url.searchParams.values(),
      ...url.pathname.split("/").filter(Boolean),
      url.hash.replace(/^#/, ""),
    ]
    return candidates.some(candidate => {
      try {
        return decodeURIComponent(candidate) === identity
      } catch {
        return candidate === identity
      }
    })
  } catch {
    return false
  }
}

// Источник находки собирается из тех же полей, что уже пишут адаптеры, и
// нормализуется до безопасных для PDF длин. null остаётся null: подставлять
// вместо неизвестной страницы поисковую фразу нельзя — это дезинформация.
// У комментария и ответа автор — посторонний человек, а не площадка.

function isCommentMention(mention: Pick<VisualMonitoringReportMention, "contentKind" | "sourceType">): boolean {
  const kind = (mention.contentKind || "").trim().toUpperCase()
  const sourceType = (mention.sourceType || "").trim().toLowerCase()
  return kind === "COMMENT" || kind === "REPLY" || sourceType === "comment" || sourceType === "reply"
}

function reportMentionContentType(
  mention: Pick<VisualMonitoringReportMention, "contentKind" | "sourceType">,
): string {
  if (isReplyMention(mention)) return "reply"
  if (isCommentMention(mention)) return "comment"
  return normalizeLabel(mention.contentKind || mention.sourceType, "unknown")
}

function cleanHandle(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^@+/, "")
  return normalized && !/[\s/?#]/.test(normalized) ? normalized : null
}

function profileUrlForHandle(platformValue: string, handleValue: string | null | undefined): string | null {
  const platform = normalizeMonitoringPlatform(platformValue) ?? platformValue.toLowerCase()
  const handle = cleanHandle(handleValue)
  if (!handle) return null
  const encoded = encodeURIComponent(handle)
  if (platform === "facebook") return `https://www.facebook.com/${encoded}`
  if (platform === "instagram") return `https://www.instagram.com/${encoded}/`
  if (platform === "tiktok") return `https://www.tiktok.com/@${encoded}`
  if (platform === "twitter") return `https://x.com/${encoded}`
  if (platform === "telegram") return `https://t.me/${encoded}`
  if (platform === "vkontakte") return `https://vk.com/${encoded}`
  if (platform === "youtube") {
    return /^UC[\w-]{16,}$/i.test(handle)
      ? `https://www.youtube.com/channel/${encoded}`
      : `https://www.youtube.com/@${encoded}`
  }
  return null
}

function safePlatformProfileUrl(platformValue: string, value: string | null | undefined): string | null {
  const safe = safeHttpUrl(value)
  if (!safe) return null
  const expected = normalizeMonitoringPlatform(platformValue)
  const actual = monitoringPlatformFromUrl(safe)
  if (!expected || expected === "web" || actual !== expected) return null

  const url = new URL(safe)
  const path = url.pathname.split("/").filter(Boolean)
  const first = path[0]?.toLowerCase() ?? ""
  if (expected === "facebook") {
    const isNumericProfile = first === "profile.php" && Boolean(url.searchParams.get("id"))
    const isPeopleProfile = first === "people" && path.length >= 3
    const isSlugProfile = path.length === 1
      && !["posts", "videos", "video", "reel", "reels", "groups", "story.php", "permalink.php"].includes(first)
    if (!isNumericProfile && !isPeopleProfile && !isSlugProfile) return null
  }
  if (expected === "instagram" && (path.length !== 1 || ["p", "reel", "reels", "tv", "stories", "explore"].includes(first))) return null
  if (expected === "tiktok" && (!first.startsWith("@") || path.length !== 1)) return null
  if (expected === "youtube" && !(
    (first.startsWith("@") && path.length === 1)
    || (["channel", "c", "user"].includes(first) && path.length === 2)
  )) return null
  if (expected === "twitter" && (path.length !== 1 || first === "status")) return null
  if (expected === "telegram" && path.length !== 1) return null
  if (expected === "vkontakte" && (/^(wall|video|clip)/.test(first) || path.length !== 1)) return null
  return url.toString()
}

function decodedPathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map(segment => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
}

function profileIdentityFromUrl(
  platformValue: string,
  profileUrl: string | null,
): { handle: string | null; label: string } | null {
  if (!profileUrl) return null
  const url = new URL(profileUrl)
  const platform = normalizeMonitoringPlatform(platformValue)
  const path = decodedPathSegments(url)
  const first = path[0] ?? ""

  if (platform === "facebook" && first.toLowerCase() === "profile.php") {
    const id = boundedText(url.searchParams.get("id")?.trim() ?? "", 120)
    return id ? { handle: null, label: `facebook.com/profile.php?id=${id}` } : null
  }
  if (platform === "facebook" && first.toLowerCase() === "people") {
    const name = boundedText((path[1] ?? "").replace(/-+/g, " ").trim(), 160)
    return name ? { handle: null, label: name } : null
  }

  const identity = platform === "youtube" && !first.startsWith("@")
    ? path[1]
    : first.replace(/^@+/, "")
  const handle = cleanHandle(identity)
  if (handle) {
    return {
      handle,
      label: platform === "facebook" ? handle : `@${handle}`,
    }
  }
  const fallback = boundedText(`${url.hostname.replace(/^www\./, "")}${url.pathname}`, 180)
  return fallback ? { handle: null, label: fallback } : null
}

const SOCIAL_LINK_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "twitter",
  "telegram",
  "vkontakte",
])

function safeContentUrl(platformValue: string, value: string | null | undefined): string | null {
  const safe = safeHttpUrl(value)
  if (!safe) return null
  const platform = normalizeMonitoringPlatform(platformValue)
  if (platform && SOCIAL_LINK_PLATFORMS.has(platform) && monitoringPlatformFromUrl(safe) !== platform) return null
  return safe
}

function normalizeReportSource(source: MentionSourceLabel, platform: string): VisualReportSource | null {
  const label = boundedText(source.label, 120)
  if (!label) return null
  const handle = source.handle ? boundedText(source.handle, 120) || null : null
  return {
    label,
    handle,
    url: safeContentUrl(platform, source.url)
      ?? safeContentUrl(platform, profileUrlForHandle(platform, handle)),
    kind: source.kind,
  }
}

const PROFILE_SOURCE_TYPES = new Set(["profile", "page", "account", "channel", "competitor", "influencer"])

function sourceFromObserved(
  source: VisualMonitoringReportObservedSource | null | undefined,
  platform: string,
): VisualReportSource | null {
  if (!source || !PROFILE_SOURCE_TYPES.has(source.sourceType.trim().toLowerCase())) return null
  const observedPlatform = effectiveMonitoringPlatform({
    platform: source.platform || platform,
    url: source.url,
  })
  const sourcePlatform = observedPlatform === "web" && SOCIAL_LINK_PLATFORMS.has(platform)
    ? platform
    : observedPlatform
  const resolved = mentionSourceLabel({
    platform: sourcePlatform,
    url: source.url,
    authorName: source.displayName,
    authorHandle: source.handle,
    isComment: false,
  })
  return resolved ? normalizeReportSource(resolved, platform) : null
}

function reportMentionSource(mention: VisualMonitoringReportMention, platform: string): VisualReportSource | null {
  if (isCommentMention(mention) && mention.parentSource) {
    const parentSource = mentionSourceLabel({
      platform: effectiveMonitoringPlatform({
        platform: mention.parentSource.platform || platform,
        url: mention.parentSource.url,
        parentPostUrl: mention.parentPostUrl,
      }),
      url: mention.parentSource.url,
      parentPostUrl: mention.parentPostUrl,
      authorName: mention.parentSource.authorName,
      authorHandle: mention.parentSource.authorHandle,
      isComment: false,
    })
    if (parentSource) return normalizeReportSource(parentSource, platform)
  }

  const observed = sourceFromObserved(mention.observedSource, platform)
  if (observed) return observed

  const source = mentionSourceLabel({
    platform,
    url: mention.canonicalUrl ?? mention.url,
    parentPostUrl: mention.parentPostUrl,
    authorName: mention.authorName,
    authorHandle: mention.authorHandle,
    isComment: isCommentMention(mention),
  })
  return source ? normalizeReportSource(source, platform) : null
}

function reportMentionAuthor(mention: VisualMonitoringReportMention, platform: string): VisualReportAuthor | null {
  const name = boundedText(mention.authorName?.trim() || "", 160) || null
  const explicitProfileUrl = safePlatformProfileUrl(platform, mention.authorProfileUrl)
  const inferredIdentity = profileIdentityFromUrl(platform, explicitProfileUrl)
  const handle = boundedText(mention.authorHandle?.trim() || inferredIdentity?.handle || "", 120) || null
  const profileUrl = explicitProfileUrl ?? profileUrlForHandle(platform, handle)
  if (!name && !handle && !profileUrl) return null
  const displayHandle = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : null
  const comparableName = name?.replace(/^@+/, "").toLocaleLowerCase() ?? null
  const comparableHandle = handle?.replace(/^@+/, "").toLocaleLowerCase() ?? null
  const label = name && displayHandle && comparableName !== comparableHandle
    ? `${name} · ${displayHandle}`
    : displayHandle ?? name ?? inferredIdentity?.label ?? ""
  return {
    name,
    handle,
    label: boundedText(label, 220),
    profileUrl,
  }
}

function reportMentionPlatform(
  mention: Pick<VisualMonitoringReportMention, "platform" | "canonicalUrl" | "url" | "parentPostUrl">,
): string {
  return normalizeLabel(effectiveMonitoringPlatform({
    platform: mention.platform,
    canonicalUrl: mention.canonicalUrl,
    url: mention.url,
    parentPostUrl: mention.parentPostUrl,
  }), "unknown")
}

function reportMentionLinks(
  mention: VisualMonitoringReportMention,
  platform: string,
): Pick<VisualMonitoringReportItem, "url" | "directCommentUrl" | "parentPostUrl" | "linkKind"> {
  const parentPostUrl = safeContentUrl(platform, mention.parentPostUrl)
  const storedUrl = safeContentUrl(platform, mention.url)
  const canonicalUrl = safeContentUrl(platform, mention.canonicalUrl)
  const evidenceUrl = safeContentUrl(platform, mention.evidenceUrl)
  const candidates = [canonicalUrl, evidenceUrl, storedUrl]
    .filter((value): value is string => Boolean(value))
  const uniqueCandidates = [...new Set(candidates)]

  if (isCommentMention(mention)) {
    // `canonicalUrl` is not always a comment permalink: some providers store a
    // normalized parent-post URL there when no direct link exists. A raw stored
    // URL is trusted only when it differs from a known parent; other provenance
    // links must carry a platform comment locator (`comment_id`, `lc`, `reply`).
    const reply = isReplyMention(mention)
    const directCommentUrl = [
      storedUrl
      && (parentPostUrl ? !sameUrl(storedUrl, parentPostUrl) : hasDirectCommentLocator(storedUrl))
        ? storedUrl
        : null,
      ...[canonicalUrl, evidenceUrl].map(candidate => (
        candidate
        && !sameUrl(candidate, parentPostUrl)
        && hasDirectCommentLocator(candidate)
        && (!reply || urlTargetsExternalId(candidate, mention.externalId))
          ? candidate
          : null
      )),
    ].find((value): value is string => Boolean(value)) ?? null
    const publicationUrl = parentPostUrl ?? uniqueCandidates[0] ?? null
    if (directCommentUrl) {
      return { url: directCommentUrl, directCommentUrl, parentPostUrl, linkKind: "direct_comment" }
    }
    if (publicationUrl) {
      return { url: publicationUrl, directCommentUrl: null, parentPostUrl: publicationUrl, linkKind: "parent_post" }
    }
    return { url: null, directCommentUrl: null, parentPostUrl: null, linkKind: "missing" }
  }

  const publicationUrl = uniqueCandidates[0] ?? parentPostUrl
  return {
    url: publicationUrl,
    directCommentUrl: null,
    parentPostUrl,
    linkKind: publicationUrl ? "publication" : "missing",
  }
}

function boundedText(value: string, limit: number): string {
  const normalized = value.trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function summaryText(
  locale: VisualReportRequest["locale"],
  subjectCount: number,
  total: number,
  negative: number,
  range: VisualReportRequest["range"],
): string {
  if (locale === "az") {
    return `${range.from}–${range.to} tarixlərində ${subjectCount} brend üzrə ${total} tapıntı qeydə alınıb; ${negative} tapıntı mənfidir.`
  }
  if (locale === "ru") {
    return `За период ${range.from}–${range.to} по ${subjectCount} брендам найдено ${total} материалов; негативных — ${negative}.`
  }
  return `${total} findings were recorded for ${subjectCount} brands from ${range.from} to ${range.to}; ${negative} are negative.`
}

export function buildVisualMonitoringReportSnapshot(
  input: BuildVisualMonitoringReportInput,
): VisualMonitoringReportSnapshot {
  const { from, toExclusive, days } = resolveVisualReportRange(input.range)
  const selectedSubjectIds = new Set(input.subjects.map(subject => subject.id))
  // Дата, по которой находка попадает в период отчёта: публикация, а при её
  // отсутствии — обнаружение. Иначе весь браузерный Facebook-сбор исчезал бы
  // из отчёта, оставаясь при этом в счётчиках карточек.
  // Возвращает null, если даты нет вовсе: prisma-клиент типизирован как any,
  // поэтому пропущенное поле не поймает ни tsc, ни сборка — а падение здесь
  // роняло бы весь отчёт целиком. Такие находки просто не попадают в период.
  function reportMentionDate(mention: VisualMonitoringReportMention): Date | null {
    return mention.publishedAt ?? mention.createdAt ?? null
  }

  const rank: Record<VisualReportSentiment, number> = { negative: 0, neutral: 1, positive: 2, unknown: 3 }
  function compareReportMentions(left: VisualMonitoringReportMention, right: VisualMonitoringReportMention): number {
    const leftSentiment = normalizeSentiment(left.sentiment)
    const rightSentiment = normalizeSentiment(right.sentiment)
    return rank[leftSentiment] - rank[rightSentiment]
      || finiteNonNegative(right.engagement) - finiteNonNegative(left.engagement)
      || (reportMentionDate(right)?.getTime() ?? 0) - (reportMentionDate(left)?.getTime() ?? 0)
      || left.id.localeCompare(right.id)
  }

  function reportItem(mention: VisualMonitoringReportMention): VisualMonitoringReportItem {
    const platform = reportMentionPlatform(mention)
    const authorProfile = reportMentionAuthor(mention, platform)
    return {
      id: mention.id,
      subjectIds: [...mention.subjectIds],
      platform,
      contentType: reportMentionContentType(mention),
      sentiment: normalizeSentiment(mention.sentiment),
      publishedAt: (reportMentionDate(mention) ?? from).toISOString(),
      author: authorProfile?.label ?? null,
      authorProfile,
      text: boundedText(mention.text, 2_000),
      ...reportMentionLinks(mention, platform),
      source: reportMentionSource(mention, platform),
      engagement: finiteNonNegative(mention.engagement),
      reach: finiteNonNegative(mention.reach),
    }
  }

  // A mention may arrive more than once in a composed data source. Merge its
  // subject associations and retain one global row so portfolio totals cannot
  // be inflated by a many-to-many subject match.
  const deduplicated = new Map<string, VisualMonitoringReportMention>()
  for (const mention of input.mentions) {
    const observedAt = reportMentionDate(mention)
    if (!observedAt || observedAt < from || observedAt >= toExclusive) continue
    const subjectIds = [...new Set(mention.subjectIds.filter(id => selectedSubjectIds.has(id)))]
    if (subjectIds.length === 0) continue

    const existing = deduplicated.get(mention.id)
    if (existing) {
      existing.subjectIds = [...new Set([...existing.subjectIds, ...subjectIds])]
      continue
    }
    deduplicated.set(mention.id, { ...mention, subjectIds })
  }

  const mentions = [...deduplicated.values()]
  const sentimentCounts: Record<VisualReportSentiment, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
    unknown: 0,
  }
  const platformCounts = new Map<string, number>()
  const contentTypeCounts = new Map<string, number>()
  const trend = new Map<string, {
    date: string
    total: number
    positive: number
    neutral: number
    negative: number
    unknown: number
  }>()
  const subjectCounts = new Map(input.subjects.map(subject => [subject.id, {
    id: subject.id,
    name: subject.name,
    total: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
    unknown: 0,
  }]))

  for (let index = 0; index < days; index += 1) {
    const date = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10)
    trend.set(date, { date, total: 0, positive: 0, neutral: 0, negative: 0, unknown: 0 })
  }

  let engagement = 0
  let reach = 0
  for (const mention of mentions) {
    const sentiment = normalizeSentiment(mention.sentiment)
    const platform = reportMentionPlatform(mention)
    const contentType = reportMentionContentType(mention)
    const day = (reportMentionDate(mention) ?? from).toISOString().slice(0, 10)

    sentimentCounts[sentiment] += 1
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1)
    contentTypeCounts.set(contentType, (contentTypeCounts.get(contentType) ?? 0) + 1)
    const bucket = trend.get(day)
    if (bucket) {
      bucket.total += 1
      bucket[sentiment] += 1
    }

    for (const subjectId of mention.subjectIds) {
      const subject = subjectCounts.get(subjectId)
      if (!subject) continue
      subject.total += 1
      subject[sentiment] += 1
    }
    engagement += finiteNonNegative(mention.engagement)
    reach += finiteNonNegative(mention.reach)
  }

  const total = mentions.length
  // Фильтр применяется ТОЛЬКО к разделу находок и обязательно до среза по
  // лимиту: иначе выбравший «25 негативных» получил бы три карточки — те, что
  // случайно оказались негативными в первой двадцатке общего рейтинга.
  const selectedSentiments = new Set<VisualReportSentiment>(input.topFindingsSentiments)
  const findingCandidates = [...mentions]
    .filter(mention => selectedSentiments.has(normalizeSentiment(mention.sentiment)))
    .sort(compareReportMentions)
  const topFindings = findingCandidates
    .slice(0, input.topFindingsLimit)
    .map(reportItem)
  const commentCandidates = (input.commentMentions ?? mentions)
    .filter(isCommentMention)
    .sort(compareReportMentions)
  const comments = commentCandidates
    .slice(0, input.commentsLimit)
    .map(reportItem)

  const organizationName = boundedText(input.organization.name, 200) || "LeadDrive"
  return {
    schemaVersion: "1",
    locale: input.locale,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    range: {
      from: input.range.from,
      to: input.range.to,
      fromInclusive: from.toISOString(),
      toExclusive: toExclusive.toISOString(),
      days,
    },
    sections: [...input.sections],
    organization: {
      name: organizationName,
      primaryColor: safePrimaryColor(input.organization.primaryColor),
    },
    subjects: input.subjects.map(subject => subjectCounts.get(subject.id)!),
    totals: {
      findings: total,
      positive: sentimentCounts.positive,
      neutral: sentimentCounts.neutral,
      negative: sentimentCounts.negative,
      unknown: sentimentCounts.unknown,
      engagement,
      reach,
    },
    summaryText: summaryText(input.locale, input.subjects.length, total, sentimentCounts.negative, input.range),
    sentiment: SENTIMENTS.map(sentiment => ({
      sentiment,
      count: sentimentCounts[sentiment],
      percentage: percentage(sentimentCounts[sentiment], total),
    })),
    platforms: [...platformCounts.entries()]
      .map(([platform, count]) => ({ platform, count, percentage: percentage(count, total) }))
      .sort((left, right) => right.count - left.count || left.platform.localeCompare(right.platform)),
    trend: [...trend.values()],
    contentTypes: [...contentTypeCounts.entries()]
      .map(([contentType, count]) => ({ contentType, count, percentage: percentage(count, total) }))
      .sort((left, right) => right.count - left.count || left.contentType.localeCompare(right.contentType)),
    topFindings,
    topFindingsFilter: {
      sentiments: [...input.topFindingsSentiments],
      matched: findingCandidates.length,
      shown: topFindings.length,
    },
    comments,
    commentsFilter: {
      matched: Math.max(
        commentCandidates.length,
        Math.trunc(finiteNonNegative(input.commentsMatched ?? commentCandidates.length)),
      ),
      shown: comments.length,
    },
    methodology: {
      dateField: "publishedAt|firstSeenAt",
      globalDeduplication: "mentionId",
      subjectMatchStatus: "MATCHED",
      unclassifiedSentiment: "unknown",
      dataLimit: VISUAL_REPORT_DATA_LIMIT,
      truncated: input.truncated ?? false,
    },
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function recordString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function parentMentionKey(platform: string, externalId: string): string {
  return `${platform.trim()}\u0000${externalId}`
}

function parentMentionUrlKey(platform: string, value: string | null | undefined): string | null {
  const normalized = comparableUrl(value ?? null)
  if (!normalized) return null
  const parsed = new URL(normalized)
  // Parent publication identity ignores fragments. A fragment may locate a
  // comment, while the persisted parent canonical URL intentionally does not.
  parsed.hash = ""
  return `${platform.trim()}\u0000${parsed.toString()}`
}

function resolveBranding(
  organization: { name: string; branding: unknown } | null,
): { name: string; primaryColor: string | null } {
  const branding = recordValue(organization?.branding)
  const companyName = typeof branding.companyName === "string" ? branding.companyName.trim() : ""
  return {
    name: companyName || organization?.name || "LeadDrive",
    primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : null,
  }
}

export async function getVisualMonitoringReport(options: {
  organizationId: string
  request: VisualReportRequest
}): Promise<VisualMonitoringReportSnapshot> {
  const { from, toExclusive } = resolveVisualReportRange(options.request.range)
  const [organization, foundSubjects] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: options.organizationId },
      select: { name: true, branding: true },
    }),
    prisma.monitoringSubject.findMany({
      where: {
        organizationId: options.organizationId,
        id: { in: options.request.subjectIds },
        status: { notIn: ["archived", "deleted"] },
      },
      select: { id: true, name: true },
    }),
  ])

  if (foundSubjects.length !== options.request.subjectIds.length) {
    throw new VisualReportSubjectsNotFoundError()
  }
  const subjectById = new Map(foundSubjects.map(subject => [subject.id, subject]))
  const subjects = options.request.subjectIds.map(id => subjectById.get(id)!)
  const effectiveSubjectWhere = socialReportEffectiveSubjectWhere({
    organizationId: options.organizationId,
    subjectIds: options.request.subjectIds,
  })

  const rows = await prisma.socialMention.findMany({
    where: {
      organizationId: options.organizationId,
      externalId: { not: "__tg_offset__" },
      purgedAt: null,
      deletedAtSource: null,
      AND: [
        riskRelevantMentionWhere(),
        socialReportVisibleMentionWhere(),
        effectiveSubjectWhere,
      ],
      // Находки без даты публикации отбираем по дате обнаружения — тем же
      // правилом, что и лента находок.
      OR: [
        { publishedAt: { gte: from, lt: toExclusive } },
        { AND: [{ publishedAt: null }, { createdAt: { gte: from, lt: toExclusive } }] },
      ],
    },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: VISUAL_REPORT_DATA_LIMIT + 1,
    select: {
      id: true,
      externalId: true,
      platform: true,
      contentKind: true,
      sourceType: true,
      sentiment: true,
      publishedAt: true,
      createdAt: true,
      authorName: true,
      authorHandle: true,
      text: true,
      postExternalId: true,
      canonicalUrl: true,
      url: true,
      parentPostUrl: true,
      engagement: true,
      reach: true,
      subjectMatches: {
        where: {
          organizationId: options.organizationId,
          subjectId: { in: options.request.subjectIds },
          status: "MATCHED",
          reason: { not: "parent_post_match" },
        },
        select: { subjectId: true },
      },
      relevanceFeedback: {
        where: {
          organizationId: options.organizationId,
          subjectId: { in: options.request.subjectIds },
          feedbackType: { in: [...SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES] },
        },
        select: { subjectId: true, feedbackType: true },
      },
    },
  })
  // Comments are queried independently from the 20k aggregation window. A
  // busy period with many posts must not make the dedicated comments section
  // claim there were no comments merely because they fell outside that slice.
  const commentWhere = {
    organizationId: options.organizationId,
    externalId: { not: "__tg_offset__" },
    purgedAt: null,
    deletedAtSource: null,
    AND: [
      riskRelevantMentionWhere(),
      socialReportVisibleMentionWhere(),
      effectiveSubjectWhere,
      {
        OR: [
          { publishedAt: { gte: from, lt: toExclusive } },
          { AND: [{ publishedAt: null }, { createdAt: { gte: from, lt: toExclusive } }] },
        ],
      },
      {
        OR: [
          { contentKind: { in: ["COMMENT", "REPLY", "comment", "reply"] } },
          { sourceType: { in: ["comment", "reply", "COMMENT", "REPLY"] } },
        ],
      },
    ],
  } satisfies Prisma.SocialMentionWhereInput
  // Rank only IDs in SQL so the bounded comments query uses the exact same
  // semantics as the snapshot: normalized sentiment, non-negative engagement,
  // and discovery time when a publication time is unavailable. PostgreSQL's
  // default NULL ordering cannot express that last rule through Prisma
  // `orderBy: { publishedAt: "desc" }` without dropping newer undated rows.
  const [rankedCommentIds, commentsMatched] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT sm."id"
      FROM "social_mentions" AS sm
      WHERE sm."organizationId" = ${options.organizationId}
        AND sm."externalId" <> '__tg_offset__'
        AND sm."purgedAt" IS NULL
        AND sm."deletedAtSource" IS NULL
        AND sm."status" <> 'ignored'
        AND COALESCE(sm."publishedAt", sm."createdAt") >= ${from}
        AND COALESCE(sm."publishedAt", sm."createdAt") < ${toExclusive}
        AND (
          sm."contentKind" IN ('COMMENT', 'REPLY', 'comment', 'reply')
          OR sm."sourceType" IN ('comment', 'reply', 'COMMENT', 'REPLY')
        )
        AND LOWER(BTRIM(COALESCE(sm."sentiment", ''))) IN ('negative', 'neutral')
        AND EXISTS (
          SELECT 1
          FROM "social_mention_subject_matches" AS msm
          WHERE msm."organizationId" = ${options.organizationId}
            AND msm."mentionId" = sm."id"
            AND msm."subjectId" IN (${Prisma.join(options.request.subjectIds)})
            AND msm."status" = 'MATCHED'
            AND msm."reason" <> 'parent_post_match'
            AND NOT EXISTS (
              SELECT 1
              FROM "social_relevance_feedback" AS feedback
              WHERE feedback."organizationId" = msm."organizationId"
                AND feedback."mentionId" = msm."mentionId"
                AND feedback."subjectId" = msm."subjectId"
                AND feedback."feedbackType" IN (${Prisma.join([...SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES])})
            )
        )
      ORDER BY
        CASE LOWER(BTRIM(COALESCE(sm."sentiment", '')))
          WHEN 'negative' THEN 0
          WHEN 'neutral' THEN 1
          WHEN 'positive' THEN 2
          ELSE 3
        END,
        GREATEST(sm."engagement", 0) DESC,
        COALESCE(sm."publishedAt", sm."createdAt") DESC,
        sm."id" ASC
      LIMIT ${options.request.commentsLimit}
    `),
    prisma.socialMention.count({ where: commentWhere }),
  ])
  const rankedCommentIdValues = rankedCommentIds.map(row => row.id)
  const unorderedCommentRows = rankedCommentIdValues.length > 0
    ? await prisma.socialMention.findMany({
      where: { ...commentWhere, id: { in: rankedCommentIdValues } },
      select: {
        id: true,
        externalId: true,
        platform: true,
        contentKind: true,
        sourceType: true,
        sentiment: true,
        publishedAt: true,
        createdAt: true,
        authorName: true,
        authorHandle: true,
        text: true,
        postExternalId: true,
        canonicalUrl: true,
        url: true,
        parentPostUrl: true,
        engagement: true,
        reach: true,
        subjectMatches: {
          where: {
            organizationId: options.organizationId,
            subjectId: { in: options.request.subjectIds },
            status: "MATCHED",
            reason: { not: "parent_post_match" },
          },
          select: { subjectId: true },
        },
        relevanceFeedback: {
          where: {
            organizationId: options.organizationId,
            subjectId: { in: options.request.subjectIds },
            feedbackType: { in: [...SOCIAL_REPORT_EXCLUDED_FEEDBACK_TYPES] },
          },
          select: { subjectId: true, feedbackType: true },
        },
      },
    })
    : []
  const unorderedCommentRowsById = new Map(unorderedCommentRows.map(row => [row.id, row]))
  const commentRows = rankedCommentIdValues
    .map(id => unorderedCommentRowsById.get(id))
    .filter((row): row is (typeof unorderedCommentRows)[number] => Boolean(row))
  const truncated = rows.length > VISUAL_REPORT_DATA_LIMIT
  const reportRows = rows.slice(0, VISUAL_REPORT_DATA_LIMIT)

  const rowSentimentRank: Record<VisualReportSentiment, number> = {
    negative: 0,
    neutral: 1,
    positive: 2,
    unknown: 3,
  }
  const compareRows = (left: (typeof reportRows)[number], right: (typeof reportRows)[number]) => {
    const leftSentiment = normalizeSentiment(left.sentiment)
    const rightSentiment = normalizeSentiment(right.sentiment)
    return rowSentimentRank[leftSentiment] - rowSentimentRank[rightSentiment]
      || finiteNonNegative(right.engagement) - finiteNonNegative(left.engagement)
      || (right.publishedAt ?? right.createdAt).getTime() - (left.publishedAt ?? left.createdAt).getTime()
      || left.id.localeCompare(right.id)
  }
  const selectedSentiments = new Set<VisualReportSentiment>(options.request.topFindingsSentiments)
  const visibleFindingRows = [...reportRows]
    .filter(row => selectedSentiments.has(normalizeSentiment(row.sentiment)))
    .sort(compareRows)
    .slice(0, options.request.topFindingsLimit)
  const rankedCommentRows = commentRows
    .filter(isCommentMention)
    .sort(compareRows)
  const visibleRows = [
    ...visibleFindingRows,
    ...rankedCommentRows.slice(0, options.request.commentsLimit),
  ]
  const visibleRowsById = new Map(visibleRows.map(row => [row.id, row]))
  const visibleIds = [...visibleRowsById.keys()]

  // Source provenance and metadata may contain large JSON payloads. Fetch them
  // only for the at-most-100 rows that can be rendered, instead of joining two
  // observation relations onto the full 20k-row aggregation query.
  const parentKeys = new Map<string, { platform: string; externalId: string }>()
  const parentUrls = new Map<string, { platform: string; url: string }>()
  for (const row of visibleRowsById.values()) {
    if (!isCommentMention(row)) continue
    if (row.postExternalId) {
      // Parent identity follows the raw persisted platform. `FB`, `FACEBOOK`
      // and `facebook` are display aliases, but they are distinct DB identity
      // values and must never be joined through normalization alone.
      parentKeys.set(parentMentionKey(row.platform, row.postExternalId), {
        platform: row.platform,
        externalId: row.postExternalId,
      })
    }
    const parentUrlKey = parentMentionUrlKey(row.platform, row.parentPostUrl)
    if (parentUrlKey && row.parentPostUrl) {
      // Some providers prefix parent external IDs while leaving a child's
      // postExternalId raw. The normalized parent URL remains a stable,
      // tenant/platform-scoped fallback for recovering the page owner.
      parentUrls.set(parentUrlKey, { platform: row.platform, url: row.parentPostUrl })
    }
  }
  const parentLookupFilters: Prisma.SocialMentionWhereInput[] = [
    ...[...parentKeys.values()].map(parent => ({
      platform: parent.platform,
      externalId: parent.externalId,
    })),
    ...[...parentUrls.values()].flatMap(parent => ([
      { platform: parent.platform, canonicalUrl: parent.url },
      { platform: parent.platform, url: parent.url },
    ])),
  ]
  const [detailRows, parentRows] = await Promise.all([
    visibleIds.length > 0
      ? prisma.socialMention.findMany({
          where: {
            organizationId: options.organizationId,
            id: { in: visibleIds },
          },
          select: {
            id: true,
            sourceMetadata: true,
            account: {
              select: { platform: true, handle: true, displayName: true },
            },
            evidences: {
              where: { purgedAt: null },
              orderBy: { capturedAt: "desc" },
              take: 5,
              select: {
                permalink: true,
                source: {
                  select: { platform: true, sourceType: true, handle: true, url: true },
                },
              },
            },
            ingestEnvelopes: {
              where: { purgedAt: null },
              orderBy: { createdAt: "desc" },
              take: 5,
              select: {
                source: {
                  select: { platform: true, sourceType: true, handle: true, url: true },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    parentLookupFilters.length > 0
      ? prisma.socialMention.findMany({
          where: {
            organizationId: options.organizationId,
            purgedAt: null,
            deletedAtSource: null,
            contentKind: { notIn: ["COMMENT", "REPLY", "comment", "reply"] },
            sourceType: { notIn: ["comment", "reply", "COMMENT", "REPLY"] },
            OR: parentLookupFilters,
          },
          select: {
            platform: true,
            externalId: true,
            authorName: true,
            authorHandle: true,
            canonicalUrl: true,
            url: true,
          },
        })
      : Promise.resolve([]),
  ])
  const detailsById = new Map(detailRows.map(detail => [detail.id, detail]))
  const parentByKey = new Map(parentRows.map(parent => [
    parentMentionKey(parent.platform, parent.externalId),
    parent,
  ]))
  const parentByUrl = new Map<string, (typeof parentRows)[number]>()
  for (const parent of parentRows) {
    for (const candidate of [parent.canonicalUrl, parent.url]) {
      const key = parentMentionUrlKey(parent.platform, candidate)
      if (key) parentByUrl.set(key, parent)
    }
  }

  const toReportMention = (row: (typeof reportRows)[number]): VisualMonitoringReportMention => {
    const excludedSubjectIds = socialReportExcludedFeedbackSubjectIds(row.relevanceFeedback)
    const detail = detailsById.get(row.id)
    const metadata = recordValue(detail?.sourceMetadata)
    const platform = reportMentionPlatform(row)
    const evidences = detail?.evidences ?? []
    const evidencePermalinks = evidences
      .map(evidence => safeContentUrl(platform, evidence.permalink))
      .filter((value): value is string => Boolean(value))
    const evidenceUrl = evidencePermalinks.find(candidate => (
      !isCommentMention(row)
      || (
        hasDirectCommentLocator(candidate)
        && (!isReplyMention(row) || urlTargetsExternalId(candidate, row.externalId))
      )
    )) ?? evidencePermalinks[0] ?? null
    const provenanceSources = [
      ...evidences.map(evidence => evidence.source),
      ...(detail?.ingestEnvelopes ?? []).map(envelope => envelope.source),
      detail?.account ? {
        platform: detail.account.platform,
        sourceType: "profile",
        handle: detail.account.handle,
        url: null,
        displayName: detail.account.displayName,
      } : null,
    ]
    const observedSource = provenanceSources.find(source => (
      source
      && PROFILE_SOURCE_TYPES.has(source.sourceType.trim().toLowerCase())
      && Boolean(source.url?.trim() || source.handle?.trim())
    )) ?? null
    const parentUrlKey = parentMentionUrlKey(row.platform, row.parentPostUrl)
    const parent = (row.postExternalId
      ? parentByKey.get(parentMentionKey(row.platform, row.postExternalId))
      : null)
      ?? (parentUrlKey ? parentByUrl.get(parentUrlKey) : null)
    return {
      id: row.id,
      externalId: row.externalId,
      platform: row.platform,
      contentKind: row.contentKind,
      sourceType: row.sourceType,
      sentiment: row.sentiment,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      authorName: row.authorName,
      authorHandle: row.authorHandle,
      authorProfileUrl: recordString(metadata, "authorProfileUrl", "authorUrl", "profileUrl"),
      text: row.text,
      canonicalUrl: row.canonicalUrl,
      evidenceUrl,
      url: row.url,
      parentPostUrl: row.parentPostUrl,
      observedSource,
      parentSource: parent ? {
        platform: parent.platform,
        authorName: parent.authorName,
        authorHandle: parent.authorHandle,
        url: parent.canonicalUrl ?? parent.url,
      } : null,
      engagement: row.engagement,
      reach: row.reach,
      subjectIds: row.subjectMatches
        .map(match => match.subjectId)
        .filter(subjectId => !excludedSubjectIds.has(subjectId)),
    }
  }

  return buildVisualMonitoringReportSnapshot({
    locale: options.request.locale,
    range: options.request.range,
    sections: options.request.sections,
    topFindingsLimit: options.request.topFindingsLimit,
    commentsLimit: options.request.commentsLimit,
    topFindingsSentiments: options.request.topFindingsSentiments,
    organization: resolveBranding(organization),
    subjects,
    mentions: reportRows.map(toReportMention),
    commentMentions: commentRows.map(toReportMention),
    commentsMatched,
    truncated,
  })
}
