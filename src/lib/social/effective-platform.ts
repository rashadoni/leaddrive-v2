export type EffectiveMonitoringPlatform =
  | "web"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "twitter"
  | "telegram"
  | "vkontakte"

type PlatformRecord = {
  platform: unknown
  url?: string | null
  canonicalUrl?: string | null
  parentPostUrl?: string | null
}

type UrlField = "url" | "canonicalUrl" | "parentPostUrl"

const URL_FIELDS: UrlField[] = ["canonicalUrl", "url", "parentPostUrl"]

const PLATFORM_ALIASES: Record<string, EffectiveMonitoringPlatform> = {
  web: "web",
  facebook: "facebook",
  fb: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
  twitter: "twitter",
  x: "twitter",
  telegram: "telegram",
  vk: "vkontakte",
  vkontakte: "vkontakte",
}

const PLATFORM_HOSTS: Record<Exclude<EffectiveMonitoringPlatform, "web">, string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.watch"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  twitter: ["twitter.com", "x.com"],
  telegram: ["t.me", "telegram.me"],
  vkontakte: ["vk.com"],
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function hostnameMatches(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`)
}

export function normalizeMonitoringPlatform(value: unknown): string | null {
  const normalized = stringValue(value)?.toLowerCase() ?? null
  return normalized ? PLATFORM_ALIASES[normalized] ?? normalized : null
}

export function monitoringPlatformFromUrl(value: string | null | undefined): EffectiveMonitoringPlatform | null {
  const normalized = stringValue(value)
  if (!normalized) return null

  try {
    const hostname = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "")
    for (const [platform, roots] of Object.entries(PLATFORM_HOSTS)) {
      if (roots.some(root => hostnameMatches(hostname, root))) {
        return platform as Exclude<EffectiveMonitoringPlatform, "web">
      }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Search providers can persist a social-network result as WEB because WEB is
 * the acquisition route. UI filters must describe the destination content,
 * so a recognized result URL takes precedence over the acquisition label.
 */
export function effectiveMonitoringPlatform(record: PlatformRecord): string {
  for (const field of URL_FIELDS) {
    const inferred = monitoringPlatformFromUrl(record[field])
    if (inferred) return inferred
  }
  return normalizeMonitoringPlatform(record.platform) ?? "web"
}

function storedPlatformVariants(platform: string): string[] {
  const normalized = normalizeMonitoringPlatform(platform) ?? platform.toLowerCase()
  if (normalized === "twitter") return ["twitter", "TWITTER", "x", "X"]
  if (normalized === "vkontakte") return ["vkontakte", "VKONTAKTE", "vk", "VK"]
  return [normalized, normalized.toUpperCase()]
}

function urlContainsPlatform(platform: Exclude<EffectiveMonitoringPlatform, "web">) {
  return {
    OR: URL_FIELDS.flatMap(field =>
      PLATFORM_HOSTS[platform].map(host => ({
        [field]: { contains: host, mode: "insensitive" as const },
      })),
    ),
  }
}

function noSocialDestinationWhere() {
  const socialHosts = Object.values(PLATFORM_HOSTS).flat()

  return {
    AND: URL_FIELDS.map(field => ({
      OR: [
        { [field]: null },
        {
          NOT: {
            OR: socialHosts.map(host => ({
              [field]: { contains: host, mode: "insensitive" as const },
            })),
          },
        },
      ],
    })),
  }
}

/**
 * Prisma-compatible predicate for destination-platform filtering. It keeps
 * native platform rows and reclassifies WEB acquisition rows by their result
 * URL. Selecting Web explicitly excludes every recognized social destination.
 * Nullable URL fields are accepted explicitly because SQL `NOT (... OR NULL)`
 * evaluates to unknown and would otherwise hide legitimate Web rows.
 */
export function effectiveMonitoringPlatformWhere(requestedPlatforms: string[]): Record<string, unknown> {
  const requested = Array.from(new Set(
    requestedPlatforms
      .map(normalizeMonitoringPlatform)
      .filter((platform): platform is string => Boolean(platform)),
  ))
  if (requested.length === 0) return {}

  return {
    OR: requested.map(platform => {
      if (platform === "web") {
        return {
          AND: [
            { platform: { in: storedPlatformVariants("web") } },
            noSocialDestinationWhere(),
          ],
        }
      }

      const recognizedPlatform = platform as Exclude<EffectiveMonitoringPlatform, "web">
      if (!PLATFORM_HOSTS[recognizedPlatform]) {
        return { platform: { in: storedPlatformVariants(platform) } }
      }

      return {
        OR: [
          { platform: { in: storedPlatformVariants(platform) } },
          {
            AND: [
              { platform: { in: storedPlatformVariants("web") } },
              urlContainsPlatform(recognizedPlatform),
            ],
          },
        ],
      }
    }),
  }
}
