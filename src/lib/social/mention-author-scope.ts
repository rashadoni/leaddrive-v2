import { Prisma } from "@prisma/client"

export type MentionAuthorScope = "all" | "others" | "official"

export type MonitoringAuthorIdentityInput = {
  name: string
  aliases?: Array<{ kind: string; value: string }>
  sources?: Array<{
    source: {
      id: string
      platform?: string | null
      sourceType: string
      handle: string | null
      url: string | null
      query?: string | null
    }
  }>
}

export type MonitoringAuthorIdentity = {
  authorNames: string[]
  /** Legacy display labels stored in the handle field of an OWNED/OFFICIAL source. */
  sourceAuthorNames?: string[]
  sourceIds: string[]
  webHosts: string[]
  profileUrls: string[]
}

export type MonitoringSourceIdentityCandidate = {
  platform?: string | null
  sourceType?: string | null
  url?: string | null
  handle?: string | null
  query?: string | null
}

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "twitter.com",
  "vk.com",
  "x.com",
  "youtube.com",
])

function normalizedIdentity(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().replace(/^@/, "").toLocaleLowerCase()
  return normalized || null
}

function normalizedHost(value: string | null | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`)
    return url.hostname.toLocaleLowerCase().replace(/^www\./, "") || null
  } catch {
    return null
  }
}

function normalizedProfileUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLocaleLowerCase().replace(/^www\./, "")
    const path = url.pathname.replace(/\/+$/, "").toLocaleLowerCase()
    if (!host || !path) return null
    return `https://${host}${path}`
  } catch {
    return null
  }
}

function profileHandle(url: string | null): string | null {
  if (!url) return null
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean)
    return parts.at(-1)?.replace(/^@/, "") ?? null
  } catch {
    return null
  }
}

function hostMatchesOwnedHost(candidate: string, owned: string): boolean {
  return candidate === owned
    || candidate.endsWith(`.${owned}`)
    || owned.endsWith(`.${candidate}`)
}

/**
 * Detects an owned domain/profile even when a legacy source row was
 * accidentally linked as MONITORS/external. Generic keyword discovery is
 * deliberately allowed: the brand term must still be searched across third
 * party pages, while the owned host/profile is excluded from provider input.
 */
export function monitoringSourceMatchesOwnedIdentity(
  source: MonitoringSourceIdentityCandidate,
  identity: MonitoringAuthorIdentity,
): boolean {
  const platform = source.platform?.trim().toLocaleLowerCase() ?? ""
  const sourceType = source.sourceType?.trim().toLocaleLowerCase() ?? ""
  const social = isSocialSource(platform, source.url ?? null)

  if (!social) {
    const candidateHost = normalizedHost(source.url ?? source.query)
    return candidateHost
      ? identity.webHosts.some(ownedHost => hostMatchesOwnedHost(candidateHost, ownedHost))
      : false
  }

  // Search/keyword/hashtag sources describe a discovery query, not the author
  // being collected. Do not block them merely because the query contains the
  // selected brand name.
  if (["search", "search_url", "keyword", "campaign", "hashtag"].includes(sourceType)) {
    return false
  }

  const candidateProfile = normalizedProfileUrl(source.url)
  if (candidateProfile && identity.profileUrls.some(owned => candidateProfile === owned)) {
    return true
  }

  const ownedNames = new Set(
    identity.authorNames
      .map(normalizedIdentity)
      .filter((value): value is string => Boolean(value)),
  )
  const candidateNames = [
    normalizedIdentity(source.handle),
    normalizedIdentity(profileHandle(source.url ?? null)),
  ].filter((value): value is string => Boolean(value))
  return candidateNames.some(value => ownedNames.has(value))
}

export function ownedWebSearchExclusionHosts(identity: MonitoringAuthorIdentity): string[] {
  return Array.from(new Set(
    identity.webHosts
      .map(normalizedHost)
      .filter((value): value is string => Boolean(value)),
  )).sort()
}

function isSocialSource(platform: string | null | undefined, url: string | null): boolean {
  const normalizedPlatform = platform?.trim().toLocaleLowerCase()
  if (normalizedPlatform && normalizedPlatform !== "web") return true
  const host = normalizedHost(url)
  return host ? SOCIAL_HOSTS.has(host) : false
}

function addUnique(map: Map<string, string>, value: string | null | undefined, normalize: (value: string) => string | null) {
  const candidate = value?.trim()
  if (!candidate) return
  const normalized = normalize(candidate)
  if (normalized && !map.has(normalized)) map.set(normalized, normalized)
}

export function monitoringAuthorIdentity(input: MonitoringAuthorIdentityInput): MonitoringAuthorIdentity {
  const names = new Map<string, string>()
  const sourceNames = new Map<string, string>()
  const webHosts = new Map<string, string>()
  const profileUrls = new Map<string, string>()
  const sourceIds = new Set<string>()
  const addName = (value: string | null | undefined) => {
    const normalized = normalizedIdentity(value)
    if (normalized && !names.has(normalized)) names.set(normalized, value!.trim().replace(/^@/, ""))
  }
  const addSourceName = (value: string | null | undefined) => {
    const normalized = normalizedIdentity(value)
    if (normalized && !sourceNames.has(normalized)) sourceNames.set(normalized, value!.trim().replace(/^@/, ""))
  }

  for (const alias of input.aliases ?? []) {
    if (alias.kind === "HANDLE") addName(alias.value)
    if (alias.kind === "DOMAIN") addUnique(webHosts, alias.value, normalizedHost)
    // Older monitoring records may contain the official domain as a generic
    // keyword/name alias (for example "bakuelectronics.az"). Treat a
    // syntactically valid domain as owned identity as long as it is not a
    // social handle or hashtag.
    if (!["HANDLE", "HASHTAG"].includes(alias.kind) && alias.value.includes(".")) {
      addUnique(webHosts, alias.value, normalizedHost)
    }
  }

  for (const { source } of input.sources ?? []) {
    sourceIds.add(source.id)
    if (isSocialSource(source.platform, source.url)) {
      if (["profile", "page"].includes(source.sourceType)) {
        if (source.handle?.trim() && /\s/u.test(source.handle.trim())) addSourceName(source.handle)
        else addName(source.handle)
        addName(profileHandle(source.url))
        addUnique(profileUrls, source.url, normalizedProfileUrl)
      }
      continue
    }

    addUnique(webHosts, source.url ?? source.query, normalizedHost)
  }

  return {
    authorNames: [...names.values()],
    sourceAuthorNames: [...sourceNames.values()],
    sourceIds: [...sourceIds],
    webHosts: [...webHosts.values()],
    profileUrls: [...profileUrls.values()],
  }
}

export function mergeMonitoringAuthorIdentities(
  identities: MonitoringAuthorIdentity[],
): MonitoringAuthorIdentity {
  const authorNames = new Map<string, string>()
  const sourceAuthorNames = new Map<string, string>()
  const sourceIds = new Set<string>()
  const webHosts = new Set<string>()
  const profileUrls = new Set<string>()

  for (const identity of identities) {
    for (const name of identity.authorNames) {
      const key = normalizedIdentity(name)
      if (key && !authorNames.has(key)) authorNames.set(key, name)
    }
    for (const name of identity.sourceAuthorNames ?? []) {
      const key = normalizedIdentity(name)
      if (key && !sourceAuthorNames.has(key)) sourceAuthorNames.set(key, name)
    }
    for (const sourceId of identity.sourceIds) sourceIds.add(sourceId)
    for (const host of identity.webHosts) webHosts.add(host)
    for (const url of identity.profileUrls) profileUrls.add(url)
  }

  return {
    authorNames: [...authorNames.values()],
    sourceAuthorNames: [...sourceAuthorNames.values()],
    sourceIds: [...sourceIds],
    webHosts: [...webHosts],
    profileUrls: [...profileUrls],
  }
}

export function isOfficialMonitoringAuthor(
  mention: { authorName?: string | null; authorHandle?: string | null; evidenceSourceIds?: string[] },
  identity: MonitoringAuthorIdentity,
): boolean {
  // Evidence source IDs identify provenance, not the mention author. External
  // comments under official posts must remain in the other-authors feed.
  const candidates = new Set(identity.authorNames.map(normalizedIdentity).filter((value): value is string => Boolean(value)))
  const sourceNames = new Set((identity.sourceAuthorNames ?? []).map(normalizedIdentity).filter((value): value is string => Boolean(value)))
  const normalizedHandle = normalizedIdentity(mention.authorHandle)
  if (normalizedHandle && candidates.has(normalizedHandle)) return true
  const normalizedName = normalizedIdentity(mention.authorName)
  return normalizedName ? sourceNames.has(normalizedName) : false
}

function nullableFieldDoesNotMatch(
  field: "authorHandle" | "authorName",
  names: string[],
): Prisma.SocialMentionWhereInput {
  return {
    OR: [
      { [field]: null },
      {
        AND: names.map(name => ({
          [field]: { not: name, mode: "insensitive" },
        })),
      },
    ],
  }
}

function nonCommentLikeWhere(): Prisma.SocialMentionWhereInput {
  return {
    AND: [
      { contentKind: { notIn: ["COMMENT", "REPLY"] } },
      { sourceType: { notIn: ["comment", "reply"] } },
    ],
  }
}

function ingestNonCommentLikeWhere(): Prisma.IngestEnvelopeWhereInput {
  return { contentKind: { notIn: ["COMMENT", "REPLY"] } }
}

function urlBoundaryClauses(
  field: "url" | "canonicalUrl",
  roots: string[],
): Array<Record<string, unknown>> {
  return roots.flatMap(root => [
    { [field]: { equals: root, mode: "insensitive" as const } },
    { [field]: { equals: `${root}/`, mode: "insensitive" as const } },
    { [field]: { startsWith: `${root}/`, mode: "insensitive" as const } },
    { [field]: { startsWith: `${root}?`, mode: "insensitive" as const } },
    { [field]: { startsWith: `${root}#`, mode: "insensitive" as const } },
  ])
}

function ownedUrlRoots(identity: MonitoringAuthorIdentity): string[] {
  const roots = new Set<string>()
  for (const host of identity.webHosts) {
    roots.add(`https://${host}`)
    roots.add(`http://${host}`)
    roots.add(`https://www.${host}`)
    roots.add(`http://www.${host}`)
  }
  for (const profileUrl of identity.profileUrls) {
    roots.add(profileUrl)
    const parsed = new URL(profileUrl)
    roots.add(`https://www.${parsed.hostname}${parsed.pathname}`)
    roots.add(`http://${parsed.hostname}${parsed.pathname}`)
    roots.add(`http://www.${parsed.hostname}${parsed.pathname}`)
  }
  return [...roots]
}

function officialPublicationWhere(identity: MonitoringAuthorIdentity): Prisma.SocialMentionWhereInput | null {
  const provenance: Prisma.SocialMentionWhereInput[] = []
  if (identity.sourceIds.length > 0) {
    provenance.push({ evidences: { some: { sourceId: { in: identity.sourceIds } } } })
  }
  const roots = ownedUrlRoots(identity)
  if (roots.length > 0) {
    provenance.push(
      ...urlBoundaryClauses("url", roots) as Prisma.SocialMentionWhereInput[],
      ...urlBoundaryClauses("canonicalUrl", roots) as Prisma.SocialMentionWhereInput[],
    )
  }
  if (provenance.length === 0) return null
  return {
    AND: [
      nonCommentLikeWhere(),
      { OR: provenance },
    ],
  }
}

function officialEnvelopePublicationWhere(
  identity: MonitoringAuthorIdentity,
): Prisma.IngestEnvelopeWhereInput | null {
  const provenance: Prisma.IngestEnvelopeWhereInput[] = []
  if (identity.sourceIds.length > 0) {
    provenance.push({ sourceId: { in: identity.sourceIds } })
  }
  const roots = ownedUrlRoots(identity)
  if (roots.length > 0) {
    provenance.push(
      ...urlBoundaryClauses("url", roots) as Prisma.IngestEnvelopeWhereInput[],
      ...urlBoundaryClauses("canonicalUrl", roots) as Prisma.IngestEnvelopeWhereInput[],
    )
  }
  if (provenance.length === 0) return null
  return {
    AND: [
      ingestNonCommentLikeWhere(),
      { OR: provenance },
    ],
  }
}

export function mentionAuthorScopeWhere(
  scope: MentionAuthorScope,
  identity: MonitoringAuthorIdentity,
): Prisma.SocialMentionWhereInput {
  if (scope === "all") return {}
  const hasIdentity = identity.authorNames.length > 0
    || (identity.sourceAuthorNames?.length ?? 0) > 0
    || identity.sourceIds.length > 0
    || identity.webHosts.length > 0
    || identity.profileUrls.length > 0
  if (!hasIdentity) {
    return scope === "official" ? { id: "__no_official_author_identity__" } : {}
  }

  // Provider/search provenance is authoritative when it points at a source
  // linked as OWNED/OFFICIAL. The non-comment guard is intentional: a customer
  // comment under an official post must remain visible in external monitoring.
  const officialPublication = officialPublicationWhere(identity)
  const official: Prisma.SocialMentionWhereInput = {
    OR: [
      ...identity.authorNames.map(name => ({
        authorHandle: { equals: name, mode: "insensitive" as const },
      })),
      ...(identity.sourceAuthorNames ?? []).map(name => ({
        authorName: { equals: name, mode: "insensitive" as const },
      })),
      ...(officialPublication ? [officialPublication] : []),
    ],
  }
  if (scope === "official") return official

  // Prisma does not treat an empty nested AND inside OR as an unconditional
  // match. With provenance-only identities (for example an owned domain but
  // no configured social handle), building these guards from [] collapses
  // each one to `author* IS NULL` and hides every named external author.
  const andClauses: Prisma.SocialMentionWhereInput[] = identity.authorNames.length > 0
    ? [
        nullableFieldDoesNotMatch("authorHandle", identity.authorNames),
      ]
    : []
  if ((identity.sourceAuthorNames?.length ?? 0) > 0) {
    andClauses.push(nullableFieldDoesNotMatch("authorName", identity.sourceAuthorNames!))
  }
  if (officialPublication) andClauses.push({ NOT: officialPublication })
  return { AND: andClauses }
}

export function ingestEnvelopeOtherAuthorsWhere(
  identity: MonitoringAuthorIdentity,
): Prisma.IngestEnvelopeWhereInput {
  const hasIdentity = identity.authorNames.length > 0
    || (identity.sourceAuthorNames?.length ?? 0) > 0
    || identity.sourceIds.length > 0
    || identity.webHosts.length > 0
    || identity.profileUrls.length > 0
  if (!hasIdentity) return {}

  const officialPublication = officialEnvelopePublicationWhere(identity)
  const clauses: Prisma.IngestEnvelopeWhereInput[] = identity.authorNames.length > 0
    ? [
        {
          OR: [
            { authorHandle: null },
            {
              AND: identity.authorNames.map(name => ({
                authorHandle: { not: name, mode: "insensitive" as const },
              })),
            },
          ],
        },
      ]
    : []
  if ((identity.sourceAuthorNames?.length ?? 0) > 0) {
    clauses.push({
      OR: [
        { authorName: null },
        {
          AND: identity.sourceAuthorNames!.map(name => ({
            authorName: { not: name, mode: "insensitive" as const },
          })),
        },
      ],
    })
  }
  if (officialPublication) clauses.push({ NOT: officialPublication })
  return { AND: clauses }
}
