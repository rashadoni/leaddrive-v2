type MetaSearchSource = {
  platform: string
  sourceType: string
  url?: string | null
  query?: string | null
  keywords?: readonly string[] | null
  settings?: unknown
}

type JsonRecord = Record<string, unknown>

const GLOBAL_META_SOURCE_TYPES = new Set(["keyword", "hashtag", "campaign"])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
    : []
}

export function metaSearchUrlQueryTerm(source: MetaSearchSource): string | null {
  if (source.sourceType !== "search_url" || !source.url) return null
  try {
    const parsed = new URL(source.url)
    return ["q", "query", "keyword", "search"]
      .map(parameter => stringValue(parsed.searchParams.get(parameter)))
      .find((value): value is string => Boolean(value)) ?? null
  } catch {
    return null
  }
}

export function isMetaGlobalSearchSource(source: MetaSearchSource): boolean {
  if (!["facebook", "instagram"].includes(source.platform)) return false
  if (GLOBAL_META_SOURCE_TYPES.has(source.sourceType)) return true
  if (source.sourceType !== "search_url") return false

  if (
    stringValue(source.query)
    || stringList(source.keywords).length > 0
    || metaSearchUrlQueryTerm(source)
  ) return true

  const settings = record(source.settings)
  if (
    stringList(settings.keywords).length > 0
    || stringList(settings.hashtags).length > 0
    || stringList(settings.aliases).length > 0
  ) return true

  const expandedQueries = Array.isArray(settings.expandedQueries) ? settings.expandedQueries : []
  return expandedQueries.some(value => {
    const expanded = record(value)
    return Boolean(
      stringValue(expanded.query)
      || stringValue(expanded.term)
      || stringValue(expanded.displayTerm)
      || stringList(expanded.terms).length > 0
    )
  })
}
