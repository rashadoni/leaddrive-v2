export const DISCOVERY_AUTO_REVIEW_VERSION = "discovery_auto_review_v1"
export const DISCOVERY_AUTO_REVIEW_ROLLBACK_WINDOW_MS = 24 * 60 * 60_000
export const DISCOVERY_AUTO_REVIEW_MIN_ROLLBACK_WINDOW_MS = 15 * 60_000
export const DISCOVERY_AUTO_REVIEW_RETENTION_SAFETY_MARGIN_MS = 5 * 60_000
// RELEASE decisions are materialized from the stored envelope after the
// rollback window. Preserve enough payload lifetime for the 15-minute replay
// lease plus a small scheduling/clock margin.
export const DISCOVERY_AUTO_REVIEW_RELEASE_RETENTION_SAFETY_MARGIN_MS = 20 * 60_000

const SUPPORTED_DISCOVERY_REVIEW_REASONS = new Set([
  "discovery_missing_published_at",
  "discovery_outside_lookback_window",
  "discovery_snippet_only_match",
])

const CLOCK_SKEW_MS = 5 * 60_000

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "ref",
  "ref_src",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
])

const EVERGREEN_PATH = /^\/(?:search|directory|directories|catalog|categories|category(?:\/[^/]+)?|tags?(?:\/[^/]+)?|archive(?:\/(?:\d{4}(?:\/\d{1,2})?)?)?|sitemap|topics?(?:\/[^/]+)?)\/?$/iu

export type DiscoveryAutoReviewAction =
  | "REJECT"
  | "RELEASE_TO_NORMAL_PIPELINE"
  | "KEEP_REVIEW"

export type DiscoveryCandidateUrlClassification =
  | "CONTENT"
  | "PROFILE_OR_CHANNEL"
  | "EVERGREEN_DIRECTORY"
  | "OFFICIAL_DOMAIN"
  | "INVALID"
  | "MISSING"

export type DiscoveryProviderWindow = {
  since: Date | string | number
  until: Date | string | number
}

export type DiscoveryAutoReviewInput = {
  reviewReason: string
  url?: string | null
  canonicalUrl?: string | null
  publishedAt?: Date | string | number | null
  rawPayload?: unknown
  providerWindow: DiscoveryProviderWindow
  subjectIdentityTerms: readonly string[]
  officialHosts?: readonly string[]
}

export type DiscoveryAutoReviewEvidence = {
  policyVersion: typeof DISCOVERY_AUTO_REVIEW_VERSION
  reviewReason: string
  canonicalUrl: string | null
  urlClassification: DiscoveryCandidateUrlClassification
  urlHost: string | null
  matchedOfficialHost: string | null
  resolvedPublishedAt: string | null
  publishedAtSource: string | null
  freshness: "IN_WINDOW" | "OUTSIDE_WINDOW" | "UNKNOWN"
  titleIdentityTerms: string[]
  urlIdentityTerms: string[]
}

export type DiscoveryAutoReviewDecision = {
  action: DiscoveryAutoReviewAction
  reason: string
  evidence: DiscoveryAutoReviewEvidence
}

export type DiscoveryCandidateUrlDecision = {
  canonicalUrl: string | null
  classification: DiscoveryCandidateUrlClassification
  host: string | null
  matchedOfficialHost: string | null
}

export type DiscoveryStoredSubjectAcceptanceEvidence = {
  decisionStatus: string | null
  decisionConfidence: number | null
  targetMatchStatus: string | null
  targetMatchConfidence: number | null
  accepted: boolean
}

type DateEvidence = {
  date: Date | null
  source: string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function boundedConfidence(value: unknown): number | null {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
    ? value
    : null
}

function validDate(value: Date): Date | null {
  return Number.isFinite(value.getTime()) ? value : null
}

function parseAbsoluteDate(value: unknown): Date | null {
  if (value instanceof Date) return validDate(new Date(value.getTime()))
  if (typeof value === "number" && Number.isFinite(value)) {
    return validDate(new Date(Math.abs(value) < 10_000_000_000 ? value * 1_000 : value))
  }
  const raw = nonEmptyString(value)
  if (!raw) return null
  if (/^-?\d{10,13}$/u.test(raw)) {
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) {
      return validDate(new Date(Math.abs(numeric) < 10_000_000_000 ? numeric * 1_000 : numeric))
    }
  }
  return validDate(new Date(raw))
}

function parseRelativeDate(value: unknown, relativeTo: Date): Date | null {
  const raw = nonEmptyString(value)?.toLocaleLowerCase().replace(/\s+/gu, " ")
  if (!raw || !validDate(relativeTo)) return null
  if (raw === "today") return new Date(relativeTo)
  if (raw === "yesterday") return new Date(relativeTo.getTime() - 86_400_000)

  const match = raw.match(/^(?:about )?(?:(\d{1,4})|a|an|one) (second|minute|hour|day|week|month|year)s? ago$/u)
  if (!match) return null
  const amount = match[1] ? Number(match[1]) : 1
  const unit = match[2]
  const maximumByUnit: Record<string, number> = {
    second: 31_536_000,
    minute: 525_600,
    hour: 8_760,
    day: 3_650,
    week: 520,
    month: 120,
    year: 10,
  }
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > maximumByUnit[unit]) return null

  let parsed: Date
  if (unit === "month" || unit === "year") {
    const months = amount * (unit === "year" ? 12 : 1)
    const sourceMonth = relativeTo.getUTCFullYear() * 12 + relativeTo.getUTCMonth()
    const targetMonth = sourceMonth - months
    const targetYear = Math.floor(targetMonth / 12)
    const targetMonthOfYear = ((targetMonth % 12) + 12) % 12
    const lastTargetDay = new Date(Date.UTC(targetYear, targetMonthOfYear + 1, 0)).getUTCDate()
    parsed = new Date(relativeTo)
    parsed.setUTCFullYear(targetYear, targetMonthOfYear, Math.min(relativeTo.getUTCDate(), lastTargetDay))
  } else {
    const millisecondsByUnit: Record<string, number> = {
      second: 1_000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 7 * 86_400_000,
    }
    parsed = new Date(relativeTo.getTime() - amount * millisecondsByUnit[unit])
  }
  return validDate(parsed)
}

function resolvePublishedAt(
  publishedAt: DiscoveryAutoReviewInput["publishedAt"],
  rawPayload: unknown,
  providerUntil: Date | null,
): DateEvidence {
  const explicit = parseAbsoluteDate(publishedAt)
  if (explicit) return { date: explicit, source: "input.publishedAt" }

  const raw = record(rawPayload)
  for (const key of [
    "publishedAt",
    "createdAt",
    "timestamp",
    "createTimeISO",
    "date",
    "datePublished",
    "uploadDate",
  ]) {
    const parsed = parseAbsoluteDate(raw[key])
    if (parsed) return { date: parsed, source: `rawPayload.${key}` }
  }

  if (providerUntil) {
    for (const key of ["lastUpdated", "publishedTimeText", "dateText"]) {
      const parsed = parseRelativeDate(raw[key], providerUntil)
      if (parsed) return { date: parsed, source: `rawPayload.${key}` }
    }
  }
  return { date: null, source: null }
}

function normalizedHost(raw: string): string | null {
  const value = raw.trim().replace(/^\*\./u, "")
  if (!value) return null
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`)
    return parsed.hostname.toLocaleLowerCase().replace(/^www\./u, "").replace(/\.$/u, "") || null
  } catch {
    return null
  }
}

function hostMatches(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`)
}

/**
 * Canonicalizes provider candidates without treating malformed values as a
 * usable identity signal. Query parameters that identify content are retained;
 * only known tracking parameters and fragments are removed.
 */
export function canonicalizeDiscoveryCandidateUrl(raw: string | null | undefined): string | null {
  const value = nonEmptyString(raw)
  if (!value) return null
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    url.hash = ""
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "").replace(/\.$/u, "")

    for (const key of Array.from(url.searchParams.keys())) {
      const normalized = key.toLocaleLowerCase()
      if (TRACKING_PARAMETERS.has(normalized) || normalized.startsWith("utm_")) {
        url.searchParams.delete(key)
      }
    }
    const parameters = Array.from(url.searchParams.entries())
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
      ))
    url.search = ""
    for (const [key, parameterValue] of parameters) url.searchParams.append(key, parameterValue)
    url.pathname = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "") || "/"

    const canonical = url.toString()
    return url.pathname === "/" && !url.search
      ? canonical.replace(/\/$/u, "")
      : canonical
  } catch {
    return null
  }
}

function isKnownEvergreenDirectory(url: URL): boolean {
  const host = url.hostname.toLocaleLowerCase().replace(/^www\./u, "")
  const path = url.pathname.toLocaleLowerCase().replace(/\/+$/u, "") || "/"
  if (
    (hostMatches(host, "google.com") && path === "/search")
    || (hostMatches(host, "bing.com") && path === "/search")
    || (hostMatches(host, "yahoo.com") && path === "/search")
    || (hostMatches(host, "youtube.com") && ["/results", "/feed", "/playlist"].includes(path))
    || (hostMatches(host, "instagram.com") && /^\/explore(?:\/|$)/u.test(path))
    || (hostMatches(host, "facebook.com") && /^\/(?:search|pages)(?:\/|$)/u.test(path))
    || (hostMatches(host, "linkedin.com") && /^\/(?:search|directory)(?:\/|$)/u.test(path))
    || (hostMatches(host, "wikipedia.org") && /^\/wiki\/Category:/iu.test(path))
  ) return true
  if (EVERGREEN_PATH.test(path)) return true
  return path === "/" && ["q", "query", "search", "s"].some(key => url.searchParams.has(key))
}

function isFacebookContent(url: URL): boolean {
  const path = url.pathname.toLocaleLowerCase()
  return /\/(?:posts|videos|reel)\/[^/]+/u.test(path)
    || /\/photos\/[^/]+\/[^/]+/u.test(path)
    || /\/share\/[prv]\/[^/]+/u.test(path)
    || /\/groups\/[^/]+\/posts\/[^/]+/u.test(path)
    || (["/story.php", "/permalink.php"].includes(path) && Boolean(url.searchParams.get("story_fbid")))
    || (["/photo.php", "/photo"].includes(path) && Boolean(url.searchParams.get("fbid")))
    || (path === "/watch" && Boolean(url.searchParams.get("v")))
}

function isSocialProfileOrChannel(url: URL): boolean {
  const host = url.hostname.toLocaleLowerCase().replace(/^www\./u, "")
  const path = url.pathname.toLocaleLowerCase()
  if (host === "fb.watch") return path.split("/").filter(Boolean).length === 0
  if (hostMatches(host, "facebook.com")) return !isFacebookContent(url)
  if (hostMatches(host, "instagram.com")) return !/^\/(?:p|reel|tv|stories)\//u.test(path)
  if (hostMatches(host, "tiktok.com")) return !/^\/@[^/]+\/video\/\d+/u.test(path)
  if (host === "youtu.be") return path.split("/").filter(Boolean).length === 0
  if (hostMatches(host, "youtube.com")) {
    return !(
      (path === "/watch" && Boolean(url.searchParams.get("v")))
      || /^\/(?:shorts|live)\//u.test(path)
    )
  }
  if (hostMatches(host, "twitter.com") || hostMatches(host, "x.com")) return !/\/status\/\d+/u.test(path)
  if (hostMatches(host, "linkedin.com")) {
    return !(/^\/posts\//u.test(path) || /^\/feed\/update\//u.test(path) || /^\/pulse\//u.test(path))
  }
  if (host === "t.me") {
    return !(/^\/[^/]+\/\d+/u.test(path) || /^\/s\/[^/]+\/\d+/u.test(path))
  }
  if (hostMatches(host, "vk.com")) return !/^\/(?:wall|video|clip)[^/]+/u.test(path)
  if (hostMatches(host, "reddit.com")) return !/^\/r\/[^/]+\/comments\/[^/]+/u.test(path)
  return false
}

export function classifyDiscoveryCandidateUrl(
  raw: string | null | undefined,
  officialHosts: readonly string[] = [],
): DiscoveryCandidateUrlDecision {
  const canonicalUrl = canonicalizeDiscoveryCandidateUrl(raw)
  if (!nonEmptyString(raw)) {
    return { canonicalUrl: null, classification: "MISSING", host: null, matchedOfficialHost: null }
  }
  if (!canonicalUrl) {
    return { canonicalUrl: null, classification: "INVALID", host: null, matchedOfficialHost: null }
  }

  const url = new URL(canonicalUrl)
  const host = url.hostname.toLocaleLowerCase().replace(/^www\./u, "")
  const matchedOfficialHost = officialHosts
    .map(normalizedHost)
    .filter((value): value is string => Boolean(value))
    .find(candidate => hostMatches(host, candidate)) ?? null
  if (matchedOfficialHost) {
    return { canonicalUrl, classification: "OFFICIAL_DOMAIN", host, matchedOfficialHost }
  }
  if (isKnownEvergreenDirectory(url)) {
    return { canonicalUrl, classification: "EVERGREEN_DIRECTORY", host, matchedOfficialHost: null }
  }
  if (isSocialProfileOrChannel(url)) {
    return { canonicalUrl, classification: "PROFILE_OR_CHANNEL", host, matchedOfficialHost: null }
  }
  return { canonicalUrl, classification: "CONTENT", host, matchedOfficialHost: null }
}

function normalizedIdentityTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .replace(/^[@#]+/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function normalizedCorpus(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function exactIdentityMatches(value: string, terms: readonly string[]): string[] {
  const corpus = normalizedCorpus(value)
  if (!corpus) return []
  const paddedCorpus = ` ${corpus} `
  return Array.from(new Set(terms.filter(term => {
    const normalized = normalizedIdentityTerm(term)
    return normalized ? paddedCorpus.includes(` ${normalized} `) : false
  }).map(term => term.trim()).filter(Boolean)))
}

function safelyDecoded(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function urlIdentityMatches(canonicalUrl: string | null, terms: readonly string[]): string[] {
  if (!canonicalUrl) return []
  const url = new URL(canonicalUrl)
  const identityValue = safelyDecoded(`${url.hostname} ${url.pathname}`)
  const exact = exactIdentityMatches(identityValue, terms)
  const urlTokens = normalizedCorpus(identityValue).split(" ").filter(Boolean)
  const collapsedMatches = terms.filter(term => {
    const normalized = normalizedIdentityTerm(term)
    const collapsed = normalized.replace(/\s+/gu, "")
    if (collapsed.length < 4) return false
    return urlTokens.some(token => token === collapsed)
  })
  return Array.from(new Set([...exact, ...collapsedMatches].map(term => term.trim()).filter(Boolean)))
}

function makeDecision(
  action: DiscoveryAutoReviewAction,
  reason: string,
  evidence: DiscoveryAutoReviewEvidence,
): DiscoveryAutoReviewDecision {
  return { action, reason, evidence }
}

/**
 * Verifies that the observation's already-persisted subject matcher decision
 * independently accepted the target subject at the configured confidence
 * boundary. This helper never re-runs collection, reads provider data, or
 * treats a generic/snippet match as approval.
 *
 * The shape is intentionally strict and fail-closed. The normal matcher emits
 * exactly one match row per subject; missing, duplicated, malformed, low
 * confidence, or non-MATCHED target rows cannot authorize safe resolution.
 */
export function resolveStoredSubjectAcceptanceEvidence(input: {
  subjectDecision: unknown
  subjectId: string
  minConfidence: number
}): DiscoveryStoredSubjectAcceptanceEvidence {
  const decision = record(input.subjectDecision)
  const decisionStatus = nonEmptyString(decision.status)?.toLocaleUpperCase() ?? null
  const decisionConfidence = boundedConfidence(decision.confidence)
  const minimum = boundedConfidence(input.minConfidence)
  const matches = Array.isArray(decision.matches)
    ? decision.matches.map(record).filter(match => nonEmptyString(match.subjectId) === input.subjectId)
    : []
  const target = matches.length === 1 ? matches[0] : null
  const targetMatchStatus = nonEmptyString(target?.status)?.toLocaleUpperCase() ?? null
  const targetMatchConfidence = boundedConfidence(target?.confidence)
  const accepted = Boolean(
    minimum !== null
    && decisionStatus === "ACCEPTED"
    && decisionConfidence !== null
    && decisionConfidence >= minimum
    && targetMatchStatus === "MATCHED"
    && targetMatchConfidence !== null
    && targetMatchConfidence >= minimum
  )

  return {
    decisionStatus,
    decisionConfidence,
    targetMatchStatus,
    targetMatchConfidence,
    accepted,
  }
}

/**
 * Resolves only the narrow uncertainty introduced by web discovery. It can
 * reject non-content/stale candidates or release sufficiently evidenced items
 * back to the normal tenant subject pipeline; it never accepts content itself.
 */
export function resolveDiscoveryAutoReview(input: DiscoveryAutoReviewInput): DiscoveryAutoReviewDecision {
  const raw = record(input.rawPayload)
  // The observed URL is the distribution evidence the client is reviewing.
  // A copied article may declare the original publisher (including the
  // monitored brand's official site) as its HTML canonical. Classifying that
  // external observation by the declared canonical would erase the very
  // cross-site distribution signal we need to preserve.
  const preferredUrl = canonicalizeDiscoveryCandidateUrl(input.url)
    ?? canonicalizeDiscoveryCandidateUrl(input.canonicalUrl)
  const urlDecision = classifyDiscoveryCandidateUrl(
    preferredUrl ?? input.canonicalUrl ?? input.url,
    input.officialHosts,
  )
  const since = parseAbsoluteDate(input.providerWindow.since)
  const until = parseAbsoluteDate(input.providerWindow.until)
  const windowValid = Boolean(since && until && since.getTime() <= until.getTime())
  const dateEvidence = resolvePublishedAt(input.publishedAt, raw, windowValid ? until : null)
  const timestamp = dateEvidence.date?.getTime() ?? null
  const freshness = !windowValid || timestamp === null
    ? "UNKNOWN" as const
    : timestamp < since!.getTime() || timestamp > until!.getTime() + CLOCK_SKEW_MS
      ? "OUTSIDE_WINDOW" as const
      : "IN_WINDOW" as const
  const title = nonEmptyString(raw.title) ?? ""
  const titleIdentityTerms = exactIdentityMatches(title, input.subjectIdentityTerms)
  const matchedUrlTerms = urlIdentityMatches(urlDecision.canonicalUrl, input.subjectIdentityTerms)
  const evidence: DiscoveryAutoReviewEvidence = {
    policyVersion: DISCOVERY_AUTO_REVIEW_VERSION,
    reviewReason: input.reviewReason,
    canonicalUrl: urlDecision.canonicalUrl,
    urlClassification: urlDecision.classification,
    urlHost: urlDecision.host,
    matchedOfficialHost: urlDecision.matchedOfficialHost,
    resolvedPublishedAt: dateEvidence.date?.toISOString() ?? null,
    publishedAtSource: dateEvidence.source,
    freshness,
    titleIdentityTerms,
    urlIdentityTerms: matchedUrlTerms,
  }

  if (!SUPPORTED_DISCOVERY_REVIEW_REASONS.has(input.reviewReason)) {
    return makeDecision("KEEP_REVIEW", "discovery_auto_review_unsupported_reason", evidence)
  }
  if (urlDecision.classification === "OFFICIAL_DOMAIN") {
    return makeDecision("REJECT", "discovery_auto_review_official_domain", evidence)
  }
  if (urlDecision.classification === "EVERGREEN_DIRECTORY") {
    return makeDecision("REJECT", "discovery_auto_review_evergreen_directory", evidence)
  }
  if (urlDecision.classification === "PROFILE_OR_CHANNEL") {
    return makeDecision("REJECT", "discovery_auto_review_profile_or_channel", evidence)
  }
  if (!windowValid) {
    return makeDecision("KEEP_REVIEW", "discovery_auto_review_invalid_provider_window", evidence)
  }
  if (freshness === "OUTSIDE_WINDOW") {
    return makeDecision("REJECT", "discovery_auto_review_outside_provider_window", evidence)
  }
  if (freshness === "UNKNOWN") {
    return makeDecision("KEEP_REVIEW", "discovery_auto_review_missing_publish_date", evidence)
  }
  if (urlDecision.classification !== "CONTENT") {
    return makeDecision("KEEP_REVIEW", "discovery_auto_review_missing_or_invalid_url", evidence)
  }
  if (titleIdentityTerms.length === 0 && matchedUrlTerms.length === 0) {
    return makeDecision("KEEP_REVIEW", "discovery_auto_review_insufficient_independent_identity", evidence)
  }
  return makeDecision(
    "RELEASE_TO_NORMAL_PIPELINE",
    "discovery_auto_review_fresh_independent_identity",
    evidence,
  )
}
