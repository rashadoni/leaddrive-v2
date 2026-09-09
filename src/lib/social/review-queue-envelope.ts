import { effectiveMonitoringPlatform } from "@/lib/social/effective-platform"

type ReviewQueueSubjectSource = {
  scenarioId: string | null
  subject: { id: string; name: string } | null
}

export type ReviewQueueEnvelopeRow = {
  id: string
  platform: unknown
  contentKind: unknown
  text: string | null
  url: string | null
  canonicalUrl: string | null
  parentPostUrl: string | null
  publishedAt: Date | null
  relevanceReason: string | null
  matchedTerms: string[]
  providerKey: string | null
  subjectDecision: unknown
  policySnapshot: unknown
  source: {
    query: string | null
    handle: string | null
    url: string | null
    keywords: string[]
    settings: unknown
    subjectSources: ReviewQueueSubjectSource[]
  } | null
  routePlan: { scenarioId: string | null } | null
  providerRun: {
    status: string
    inputSnapshot: unknown
    routePlan: { scenarioId: string | null } | null
  } | null
  tiktokPublicationRevisit: { coverageClass: string } | null
  createdAt: Date
  purgeAt: Date
}

type NamedReference = {
  id: string
  name: string | null
}

type ReviewQueueLinkState = "supported" | "questionable" | "missing"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const valueTrimmed = value.trim()
    return valueTrimmed ? [valueTrimmed] : []
  }
  if (!Array.isArray(value)) return []
  return value
    .map(stringValue)
    .filter((item): item is string => Boolean(item))
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function namedReferences(values: NamedReference[]): NamedReference[] {
  const references = new Map<string, NamedReference>()
  for (const value of values) {
    const current = references.get(value.id)
    if (!current || (!current.name && value.name)) references.set(value.id, value)
  }
  return Array.from(references.values())
}

function sourceScenarioLinks(settings: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(settings.scenarioLinks)
    ? settings.scenarioLinks.map(record).filter(item => Boolean(stringValue(item.scenarioId)))
    : []
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some(octet => octet < 0 || octet > 255)) return false
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

function publicHttpUrl(value: string | null): URL | null {
  const normalized = stringValue(value)
  if (!normalized || normalized.length > 2_048) return null
  try {
    const parsed = new URL(normalized)
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
    const bareHostname = hostname.replace(/^\[/, "").replace(/\]$/, "")
    const ipv6 = bareHostname.includes(":")
    if (!["http:", "https:"].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password || !hostname) return null
    if (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || bareHostname === "::1"
      || (ipv6 && (/^(fc|fd)/.test(bareHostname) || /^fe[89ab]/.test(bareHostname)))
      || isPrivateIpv4(hostname)
    ) return null
    return parsed
  } catch {
    return null
  }
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "")
}

function hostMatches(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`)
}

function isSupportedPlatformUrl(platformValue: unknown, url: URL): boolean {
  const host = normalizedHost(url)
  const path = url.pathname.toLowerCase()
  let platform = stringValue(platformValue)?.toLowerCase() ?? ""

  // Google/Web discovery keeps the source platform as WEB even when the
  // candidate itself points to a social network. Apply that network's strict
  // post/permalink rules by hostname; otherwise a Facebook profile root can
  // redirect to an opaque `/dcb/tcnle` page and look like valid evidence.
  if (platform === "web") {
    if (host === "fb.watch" || hostMatches(host, "facebook.com")) platform = "facebook"
    else if (hostMatches(host, "instagram.com")) platform = "instagram"
    else if (hostMatches(host, "tiktok.com")) platform = "tiktok"
    else if (host === "youtu.be" || hostMatches(host, "youtube.com")) platform = "youtube"
    else if (hostMatches(host, "twitter.com") || hostMatches(host, "x.com")) platform = "x"
    else if (host === "t.me") platform = "telegram"
    else if (hostMatches(host, "vk.com")) platform = "vk"
  }

  if (platform === "facebook") {
    if (host === "fb.watch") return path.split("/").filter(Boolean).length > 0
    if (!hostMatches(host, "facebook.com")) return false
    return /\/(posts|videos|reel)\/[^/]+/.test(path)
      || /\/photos\/[^/]+\/[^/]+/.test(path)
      || /\/share\/[prv]\/[^/]+/.test(path)
      || /\/groups\/[^/]+\/posts\/[^/]+/.test(path)
      || (["/story.php", "/permalink.php"].includes(path) && Boolean(url.searchParams.get("story_fbid")))
      || (["/photo.php", "/photo", "/photo/"].includes(path) && Boolean(url.searchParams.get("fbid")))
      || (["/watch", "/watch/"].includes(path) && Boolean(url.searchParams.get("v")))
  }

  if (platform === "instagram") {
    return hostMatches(host, "instagram.com") && /^\/(p|reel|tv|stories)\//.test(path)
  }

  if (platform === "tiktok") {
    return hostMatches(host, "tiktok.com") && /^\/@[^/]+\/video\/\d+/.test(path)
  }

  if (platform === "youtube") {
    if (host === "youtu.be") return path.split("/").filter(Boolean).length > 0
    return hostMatches(host, "youtube.com")
      && ((path === "/watch" && Boolean(url.searchParams.get("v"))) || /^\/(shorts|live)\//.test(path))
  }

  if (platform === "twitter" || platform === "x") {
    return (hostMatches(host, "twitter.com") || hostMatches(host, "x.com"))
      && /\/status\/\d+/.test(path)
  }

  if (platform === "telegram") {
    return host === "t.me"
      && (/^\/[^/]+\/\d+/.test(path) || /^\/s\/[^/]+\/\d+/.test(path))
  }

  if (platform === "vk" || platform === "vkontakte") {
    return hostMatches(host, "vk.com") && /^\/(wall|video|clip)[^/]+/.test(path)
  }

  // Unknown/web sources still get strict scheme, credential and local-network
  // checks. Platform-specific profile URLs stay non-clickable because they can
  // redirect away from the reviewed post (Facebook's `/dcb/tcnle` is one such
  // redirect target).
  return true
}

function reviewLink(
  platform: unknown,
  canonicalUrl: string | null,
  originalUrl: string | null,
  parentPostUrl: string | null,
): { openUrl: string | null; linkState: ReviewQueueLinkState } {
  const candidates = uniqueStrings([canonicalUrl, originalUrl, parentPostUrl])
  if (candidates.length === 0) return { openUrl: null, linkState: "missing" }

  for (const candidate of candidates) {
    const parsed = publicHttpUrl(candidate)
    if (parsed && isSupportedPlatformUrl(platform, parsed)) {
      return { openUrl: parsed.toString(), linkState: "supported" }
    }
  }
  return { openUrl: null, linkState: "questionable" }
}

export function mapReviewQueueEnvelope(envelope: ReviewQueueEnvelopeRow) {
  const decision = record(envelope.subjectDecision)
  const policy = record(envelope.policySnapshot)
  const providerInput = record(envelope.providerRun?.inputSnapshot)
  const sourceSettings = record(envelope.source?.settings)
  const scenarioLinks = sourceScenarioLinks(sourceSettings)

  const explicitScenarioIds = [
    uniqueStrings([...stringArray(decision.scenarioIds), stringValue(decision.scenarioId)]),
    uniqueStrings([...stringArray(policy.scenarioIds), stringValue(policy.scenarioId)]),
    uniqueStrings([stringValue(providerInput.leadDriveTargetScenarioId)]),
    uniqueStrings([envelope.routePlan?.scenarioId]),
    uniqueStrings([envelope.providerRun?.routePlan?.scenarioId]),
    uniqueStrings([stringValue(sourceSettings.scenarioId)]),
  ].find(ids => ids.length > 0) ?? []
  const scenarioIds = explicitScenarioIds.length
    ? explicitScenarioIds
    : uniqueStrings([
      ...scenarioLinks.map(link => stringValue(link.scenarioId)),
      ...(envelope.source?.subjectSources ?? []).map(item => item.scenarioId),
    ])
  const relevantScenarioLinks = scenarioIds.length
    ? scenarioLinks.filter(link => scenarioIds.includes(stringValue(link.scenarioId) ?? ""))
    : scenarioLinks

  const scenarios = namedReferences(scenarioIds.map(id => {
    const link = relevantScenarioLinks.find(candidate => stringValue(candidate.scenarioId) === id)
    const directName = stringValue(sourceSettings.scenarioId) === id
      ? stringValue(sourceSettings.scenarioName)
      : null
    return { id, name: stringValue(link?.scenarioName) ?? directName }
  }))

  const decisionMatches = Array.isArray(decision.matches) ? decision.matches.map(record) : []
  const suggestedSubjectId = stringValue(providerInput.leadDriveTargetSubjectId)
    ?? stringValue(policy.targetSubjectId)
  const sourceSubjectSources = envelope.source?.subjectSources ?? []
  const relevantSubjectSources = scenarioIds.length
    ? sourceSubjectSources.filter(item => item.scenarioId && scenarioIds.includes(item.scenarioId))
    : sourceSubjectSources
  const providerSubjectReferences = suggestedSubjectId
    ? [{ id: suggestedSubjectId, name: null }]
    : []
  const decisionSubjectReferences = decisionMatches.flatMap(match => {
      const id = stringValue(match.subjectId)
      return id ? [{ id, name: stringValue(match.subjectName) }] : []
    })
  const scenarioSubjectReferences = [
    ...relevantScenarioLinks.flatMap(link => {
      const id = stringValue(link.subjectId)
      return id ? [{ id, name: stringValue(link.subjectName) }] : []
    }),
    ...relevantSubjectSources.flatMap(item => (
      item.subject ? [{ id: item.subject.id, name: stringValue(item.subject.name) }] : []
    )),
  ]
  const sourceSubjectReferences = sourceSubjectSources.flatMap(item => (
    item.subject ? [{ id: item.subject.id, name: stringValue(item.subject.name) }] : []
  ))
  // Mirror the replay boundary's provenance precedence. Showing subjects from
  // lower tiers would let the UI submit an option the server must reject.
  const authoritativeSubjectReferences = [
    providerSubjectReferences,
    decisionSubjectReferences,
    scenarioSubjectReferences,
    sourceSubjectReferences,
  ].find(references => references.length > 0) ?? []
  const allSubjectReferences = namedReferences([
    ...decisionSubjectReferences,
    ...scenarioSubjectReferences,
    ...sourceSubjectReferences,
  ])
  const subjects = authoritativeSubjectReferences.map(reference => ({
    ...reference,
    name: reference.name
      ?? allSubjectReferences.find(candidate => candidate.id === reference.id)?.name
      ?? null,
  }))

  const query = stringValue(decision.query)
    ?? stringValue(policy.query)
    ?? stringValue(envelope.source?.query)
    ?? stringValue(relevantScenarioLinks[0]?.targetValue)
    ?? stringValue(sourceSettings.scenarioTargetValue)
    ?? stringValue(envelope.source?.handle)
    ?? stringValue(envelope.source?.url)
    ?? stringValue(envelope.source?.keywords[0])
    ?? envelope.matchedTerms.map(stringValue).find((item): item is string => Boolean(item))
    ?? null
  const effectivePlatform = effectiveMonitoringPlatform(envelope)
  const link = reviewLink(effectivePlatform, envelope.canonicalUrl, envelope.url, envelope.parentPostUrl)

  return {
    id: envelope.id,
    platform: effectivePlatform,
    acquisitionPlatform: envelope.platform,
    contentKind: envelope.contentKind,
    text: envelope.text,
    // Preserve every stored URL verbatim for audit/debugging. `openUrl` is the
    // only field the UI may turn into a clickable link.
    url: envelope.url,
    originalUrl: envelope.url,
    canonicalUrl: envelope.canonicalUrl,
    parentPostUrl: envelope.parentPostUrl,
    openUrl: link.openUrl,
    linkState: link.linkState,
    publishedAt: envelope.publishedAt,
    relevanceReason: envelope.relevanceReason,
    matchedTerms: envelope.matchedTerms,
    createdAt: envelope.createdAt,
    purgeAt: envelope.purgeAt,
    query,
    scenarioIds,
    scenarios,
    subjects,
    suggestedSubjectId,
    provider: envelope.providerKey ?? stringValue(decision.provider),
    coverageClass: envelope.tiktokPublicationRevisit?.coverageClass
      ?? stringValue(policy.coverageClass)
      ?? envelope.providerRun?.status
      ?? "UNKNOWN",
    lastCompletePage: numberValue(policy.lastCompleteCommentPage)
      ?? numberValue(providerInput.lastCompleteCommentPage),
  }
}
