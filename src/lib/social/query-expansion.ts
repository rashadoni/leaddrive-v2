export type QueryExpansionReason =
  | "base_query"
  | "hashtag_variant"
  | "keyword"
  | "alias"
  | "spacing_variant"
  | "ascii_variant"
  | "compact_variant"

export interface MonitoringQueryExpansion {
  term: string
  displayTerm: string
  normalizedTerm: string
  reason: QueryExpansionReason
  language: "az" | "ru" | "en" | "unknown"
  priority: number
  cadenceMinutes: number
}

export interface QueryExpansionInput {
  sourceType: string
  query?: string | null
  keywords?: string[]
  aliases?: string[]
}

const AZ_ASCII: Record<string, string> = {
  ə: "e",
  ı: "i",
  ö: "o",
  ü: "u",
  ğ: "g",
  ş: "s",
  ç: "c",
}

function stripMarker(value: string): string {
  return value.trim().replace(/^[@#]+/, "")
}

function normalizeTerm(value: string): string {
  return stripMarker(value)
    .toLocaleLowerCase("az")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function compactTerm(value: string): string {
  return normalizeTerm(value).replace(/\s+/g, "")
}

function splitCamelCase(value: string): string {
  return stripMarker(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function asciiAz(value: string): string {
  return value.replace(/[əıöüğşç]/gi, (char) => {
    const lower = char.toLocaleLowerCase("az")
    const mapped = AZ_ASCII[lower]
    if (!mapped) return char
    return char === lower ? mapped : mapped.toUpperCase()
  })
}

function detectLanguage(value: string): MonitoringQueryExpansion["language"] {
  if (/[а-яё]/i.test(value)) return "ru"
  if (/[əƏıİöÖüÜğĞşŞçÇ]/.test(value)) return "az"
  if (/[a-z]/i.test(value)) return "en"
  return "unknown"
}

function cadenceForPriority(priority: number): number {
  if (priority >= 90) return 30
  if (priority >= 75) return 60
  return 360
}

function priorityFor(reason: QueryExpansionReason): number {
  if (reason === "base_query") return 100
  if (reason === "hashtag_variant") return 95
  if (reason === "keyword") return 82
  if (reason === "alias") return 78
  return 68
}

function displayFor(sourceType: string, term: string, reason: QueryExpansionReason): string {
  if (sourceType === "hashtag" && reason === "hashtag_variant") return `#${compactTerm(term)}`
  return normalizeTerm(term)
}

export function expandMonitoringQueries(input: QueryExpansionInput): MonitoringQueryExpansion[] {
  const rows: MonitoringQueryExpansion[] = []
  const seen = new Set<string>()

  const add = (raw: string | null | undefined, reason: QueryExpansionReason) => {
    if (!raw) return
    const normalized = normalizeTerm(raw)
    if (!normalized) return
    const displayTerm = displayFor(input.sourceType, raw, reason)
    const dedupeKey = `${reason === "hashtag_variant" ? "hash:" : ""}${normalizeTerm(displayTerm)}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    const priority = priorityFor(reason)
    rows.push({
      term: normalized,
      displayTerm,
      normalizedTerm: normalized,
      reason,
      language: detectLanguage(raw),
      priority,
      cadenceMinutes: cadenceForPriority(priority),
    })
  }

  add(input.query, "base_query")
  if (input.sourceType === "hashtag" && input.query) add(compactTerm(input.query), "hashtag_variant")

  const allKeywords = input.keywords ?? []
  for (const keyword of allKeywords) add(keyword, "keyword")
  for (const alias of input.aliases ?? []) add(alias, "alias")

  const seedTerms = [input.query, ...allKeywords, ...(input.aliases ?? [])].filter((value): value is string => Boolean(value?.trim()))
  for (const seed of seedTerms) {
    const split = splitCamelCase(seed)
    if (split && split !== stripMarker(seed)) add(split, "spacing_variant")

    const ascii = asciiAz(seed)
    if (ascii !== seed) add(ascii, "ascii_variant")

    const compact = compactTerm(seed)
    if (compact && compact !== normalizeTerm(seed)) add(compact, "compact_variant")
  }

  return rows.sort((a, b) => b.priority - a.priority || a.displayTerm.localeCompare(b.displayTerm))
}

export function suggestedCadenceFromExpansions(expansions: MonitoringQueryExpansion[], fallbackMinutes: number): number {
  if (expansions.length === 0) return fallbackMinutes
  return Math.min(fallbackMinutes, ...expansions.map((item) => item.cadenceMinutes))
}
