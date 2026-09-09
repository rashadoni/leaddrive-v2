export type MonitoringSourcePresentationInput = {
  id: string
  platform: string
  sourceType: string
  url: string | null
  handle: string | null
  query: string | null
  ownership: string
  settings?: unknown
}

export type MonitoringSourcePresentationKind = "direct" | "scenario_query" | "standalone_query"

export type MonitoringScenarioPresentationInput = {
  id: string
  name: string
  platforms: string[]
  search: {
    topics: string[]
    keywords: string[]
    hashtags: string[]
    handles: string[]
    urls: string[]
  }
}

export type MonitoringScenarioSourceReference = {
  key: string
  url: string | null
  handle: string | null
  platforms: string[]
  scenarioIds: string[]
  scenarioNames: string[]
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function monitoringSourcePresentationKind(
  source: MonitoringSourcePresentationInput,
): MonitoringSourcePresentationKind {
  if (source.url || source.handle) return "direct"

  const settings = recordFromUnknown(source.settings)
  if (settings.managedBy === "monitoring_scenario" && nonBlankString(settings.scenarioId)) {
    return "scenario_query"
  }

  return "standalone_query"
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ""
    // A pasted `www.` variant is the same page/profile target. Treating it as
    // a separate key can recreate a source that an operator already classified
    // as official or deleted from a scenario.
    url.hostname = url.hostname.replace(/^www\./i, "")
    return url.toString().replace(/\/+$/, "").toLowerCase()
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase()
  }
}

export function monitoringDirectSourceKey(
  source: Pick<MonitoringSourcePresentationInput, "url" | "handle">,
): string | null {
  if (source.url) return `url:${normalizeUrlKey(source.url)}`
  if (source.handle) return `handle:${source.handle.replace(/^@+/, "").trim().toLowerCase()}`
  return null
}

export function monitoringDirectSourceTargetsMatch(
  left: Pick<MonitoringSourcePresentationInput, "url" | "handle">,
  right: Pick<MonitoringSourcePresentationInput, "url" | "handle">,
): boolean {
  const leftKey = monitoringDirectSourceKey(left)
  return Boolean(leftKey && leftKey === monitoringDirectSourceKey(right))
}

function monitoringHandleUrl(platform: string, handle: string | null): string | null {
  const normalized = handle?.replace(/^@+/, "").trim()
  if (!normalized) return null
  if (platform === "instagram") return `https://www.instagram.com/${normalized}`
  if (platform === "facebook") return `https://www.facebook.com/${normalized}`
  if (platform === "tiktok") return `https://www.tiktok.com/@${normalized}`
  if (platform === "youtube") return `https://www.youtube.com/@${normalized}`
  if (platform === "twitter") return `https://x.com/${normalized}`
  return null
}

/** Remove every saved URL/handle representation that could recreate a source. */
export function scenarioSearchWithoutMonitoringSource(
  search: { urls: string[]; handles: string[] },
  source: Pick<MonitoringSourcePresentationInput, "platform" | "url" | "handle">,
): { urls: string[]; handles: string[]; changed: boolean } {
  const targets = [
    { url: source.url, handle: source.handle },
    { url: monitoringHandleUrl(source.platform, source.handle), handle: null },
  ].filter(target => Boolean(target.url || target.handle))
  const urls = search.urls.filter(url => !targets.some(target => monitoringDirectSourceTargetsMatch(
    { url, handle: null },
    target,
  )))
  const handles = search.handles.filter(handle => !targets.some(target => monitoringDirectSourceTargetsMatch(
    { url: null, handle },
    target,
  )))
  return {
    urls,
    handles,
    changed: urls.length !== search.urls.length || handles.length !== search.handles.length,
  }
}

export function scenarioSourceReferences(
  scenarios: MonitoringScenarioPresentationInput[],
): MonitoringScenarioSourceReference[] {
  const references = new Map<string, {
    key: string
    url: string | null
    handle: string | null
    platforms: Set<string>
    scenarioIds: Set<string>
    scenarioNames: Set<string>
  }>()

  for (const scenario of scenarios) {
    const targets = [
      ...scenario.search.urls.map((url) => ({ url, handle: null })),
      ...scenario.search.handles.map((handle) => ({ url: null, handle: handle.replace(/^@+/, "") })),
    ]
    for (const target of targets) {
      const key = monitoringDirectSourceKey(target)
      if (!key) continue
      const reference = references.get(key) ?? {
        key,
        url: target.url,
        handle: target.handle,
        platforms: new Set<string>(),
        scenarioIds: new Set<string>(),
        scenarioNames: new Set<string>(),
      }
      scenario.platforms.forEach((platform) => reference.platforms.add(platform))
      reference.scenarioIds.add(scenario.id)
      reference.scenarioNames.add(scenario.name)
      references.set(key, reference)
    }
  }

  return Array.from(references.values())
    .map((reference) => ({
      key: reference.key,
      url: reference.url,
      handle: reference.handle,
      platforms: Array.from(reference.platforms).sort(),
      scenarioIds: Array.from(reference.scenarioIds),
      scenarioNames: Array.from(reference.scenarioNames),
    }))
    .sort((left, right) => (left.url ?? left.handle ?? "").localeCompare(right.url ?? right.handle ?? ""))
}

export function monitoringSourceHasScenarioLink(source: MonitoringSourcePresentationInput): boolean {
  const settings = recordFromUnknown(source.settings)
  if (settings.managedBy === "monitoring_scenario" && nonBlankString(settings.scenarioId)) return true
  return Array.isArray(settings.scenarioLinks) && settings.scenarioLinks.length > 0
}
