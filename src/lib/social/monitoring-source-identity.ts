export const MONITORING_IDENTITY_RELATION_TYPES = new Set(["OWNED", "OFFICIAL"])

export type MonitoringSourceSubjectRelation = {
  relationType?: string | null
}

export type MonitoringSourceIdentityRole = "official" | "external" | "mixed"

export type MonitoringSourceCanonicalIdentityInput = {
  platform: string
  sourceType?: string | null
  url?: string | null
  handle?: string | null
}

const RESERVED_ACCOUNT_PATHS: Record<string, Set<string>> = {
  facebook: new Set([
    "events", "groups", "hashtag", "marketplace", "pages", "people", "permalink.php",
    "photo.php", "photos", "reel", "reels", "search", "share", "story.php", "watch",
  ]),
  instagram: new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories", "tv"]),
  tiktok: new Set(["discover", "explore", "search", "tag", "video"]),
  twitter: new Set(["compose", "explore", "hashtag", "home", "i", "intent", "search"]),
  vkontakte: new Set(["away.php", "feed", "im", "search", "video"]),
  youtube: new Set(["feed", "playlist", "results", "shorts", "watch"]),
}

function normalizedPlatform(value: string): string {
  const platform = value.trim().toLowerCase()
  return platform === "x" ? "twitter" : platform
}

function normalizedIdentityPart(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().replace(/^@+/, "")
  if (!raw) return null
  try {
    return decodeURIComponent(raw).normalize("NFKC").toLocaleLowerCase()
  } catch {
    return raw.normalize("NFKC").toLocaleLowerCase()
  }
}

function canonicalHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/^www\./, "")
  if (["m.facebook.com", "mbasic.facebook.com"].includes(host)) return "facebook.com"
  if (host === "mobile.twitter.com" || host === "twitter.com") return "x.com"
  if (host === "m.youtube.com") return "youtube.com"
  return host
}

function canonicalAccountKey(platform: string, value: string | null | undefined): string | null {
  const identity = normalizedIdentityPart(value)
  return identity ? `${platform}:account:${identity}` : null
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").map(segment => segment.trim()).filter(Boolean)
}

function accountIdentityFromUrl(platform: string, url: URL): string | null {
  const host = canonicalHost(url.hostname)
  const segments = pathSegments(url)
  const first = normalizedIdentityPart(segments[0])

  if (platform === "instagram" && host === "instagram.com") {
    if (!first || RESERVED_ACCOUNT_PATHS.instagram.has(first)) return null
    return canonicalAccountKey(platform, first)
  }
  if (platform === "facebook" && host === "facebook.com") {
    if (url.pathname.toLowerCase().endsWith("/profile.php") || url.pathname.toLowerCase() === "/profile.php") {
      return canonicalAccountKey(platform, url.searchParams.get("id"))
    }
    if (["pages", "people"].includes(first ?? "") && segments.length >= 3) {
      return canonicalAccountKey(platform, segments[2])
    }
    if (!first || RESERVED_ACCOUNT_PATHS.facebook.has(first)) return null
    return canonicalAccountKey(platform, first)
  }
  if (platform === "tiktok" && host === "tiktok.com") {
    if (!first || RESERVED_ACCOUNT_PATHS.tiktok.has(first)) return null
    return canonicalAccountKey(platform, first)
  }
  if (platform === "youtube" && host === "youtube.com") {
    if (!first || RESERVED_ACCOUNT_PATHS.youtube.has(first)) return null
    if (first.startsWith("@")) return canonicalAccountKey(platform, first)
    if (["c", "channel", "user"].includes(first) && segments[1]) {
      const kind = first === "channel" ? "channel" : "account"
      const identity = normalizedIdentityPart(segments[1])
      return identity ? `${platform}:${kind}:${identity}` : null
    }
    return canonicalAccountKey(platform, first)
  }
  if (platform === "twitter" && host === "x.com") {
    if (!first || RESERVED_ACCOUNT_PATHS.twitter.has(first)) return null
    return canonicalAccountKey(platform, first)
  }
  if (platform === "telegram" && host === "t.me") return canonicalAccountKey(platform, first)
  if (platform === "vkontakte" && host === "vk.com") {
    if (!first || RESERVED_ACCOUNT_PATHS.vkontakte.has(first)) return null
    return canonicalAccountKey(platform, first)
  }
  if (platform === "linkedin" && host === "linkedin.com") {
    if (!["company", "in", "school"].includes(first ?? "") || !segments[1]) return null
    return canonicalAccountKey(platform, segments[1])
  }
  return null
}

function canonicalUrlResourceKey(platform: string, url: URL): string {
  const host = canonicalHost(url.hostname)
  const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/"
  const search = new URLSearchParams(url.searchParams)
  for (const key of Array.from(search.keys())) {
    if (/^(fbclid|gclid|igshid|ref|ref_|source|utm_)/i.test(key)) search.delete(key)
  }
  search.sort()
  const suffix = search.toString() ? `?${search.toString()}` : ""
  return `${platform}:url:${host}${pathname.toLocaleLowerCase()}${suffix}`
}

/**
 * Stronger than the database duplicate key: joins URL and @handle forms and
 * ignores presentation-only variants (`www`, mobile hosts, http/https and
 * tracking parameters).
 */
export function monitoringSourceCanonicalIdentityKeys(
  source: MonitoringSourceCanonicalIdentityInput,
): string[] {
  const platform = normalizedPlatform(source.platform)
  const keys = new Set<string>()
  const handleKey = canonicalAccountKey(platform, source.handle)
  if (handleKey) keys.add(handleKey)
  if (source.url) {
    try {
      const url = new URL(source.url.trim())
      const accountKey = accountIdentityFromUrl(platform, url)
      if (accountKey) keys.add(accountKey)
      else if (platform === "web") keys.add(`${platform}:domain:${canonicalHost(url.hostname)}`)
      else keys.add(canonicalUrlResourceKey(platform, url))
    } catch {
      // Persisted URLs are validated; malformed legacy rows stay protected by ID.
    }
  }
  return Array.from(keys)
}

export function monitoringSourcesShareCanonicalIdentity(
  left: MonitoringSourceCanonicalIdentityInput,
  right: MonitoringSourceCanonicalIdentityInput,
): boolean {
  const leftKeys = new Set(monitoringSourceCanonicalIdentityKeys(left))
  return leftKeys.size > 0
    && monitoringSourceCanonicalIdentityKeys(right).some(key => leftKeys.has(key))
}

export function isMonitoringIdentityRelation(relationType: string | null | undefined): boolean {
  return MONITORING_IDENTITY_RELATION_TYPES.has((relationType ?? "").trim().toUpperCase())
}

/**
 * Physical source ownership cannot describe how the same page is used by a
 * monitoring subject. Brand-protection tenants persist official pages as
 * `ownership=external`, while the subject link is the authoritative identity
 * signal. Keep that distinction in one helper so UI, manual runs and cron all
 * fail closed in the same way.
 */
export function monitoringSourceIdentityRole(
  relations: MonitoringSourceSubjectRelation[] | null | undefined,
): MonitoringSourceIdentityRole {
  const relationTypes = (relations ?? [])
    .map(relation => (relation.relationType ?? "").trim().toUpperCase())
    .filter(Boolean)
  const hasIdentity = relationTypes.some(isMonitoringIdentityRelation)
  const hasExternalTarget = relationTypes.some(relationType => !isMonitoringIdentityRelation(relationType))

  if (hasIdentity && hasExternalTarget) return "mixed"
  if (hasIdentity) return "official"
  return "external"
}

export function isOfficialIdentityOnly(
  relations: MonitoringSourceSubjectRelation[] | null | undefined,
): boolean {
  return monitoringSourceIdentityRole(relations) === "official"
}
