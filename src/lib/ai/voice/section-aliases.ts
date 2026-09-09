import { navItems, type NavItem } from "@/lib/nav-items"
import ruMessages from "../../../../messages/ru.json"
import azMessages from "../../../../messages/az.json"
import enMessages from "../../../../messages/en.json"
import { VOICE_SECTION_KEYS, VOICE_SECTIONS } from "./sections"

export type VoiceSectionLocale = "ru" | "az" | "en"
export type VoiceSectionResolution =
  | { status: "resolved"; section: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found"; candidates: [] }

type NavMessages = {
  nav?: Record<string, unknown>
  navDesc?: Record<string, unknown>
}

const LOCALIZED_NAV: Record<VoiceSectionLocale, NavMessages> = {
  ru: ruMessages,
  az: azMessages,
  en: enMessages,
}

function translatedGroup(messages: NavMessages, group: string): string {
  const groups = messages.nav?.groups
  if (!groups || typeof groups !== "object") return group
  const label = (groups as Record<string, unknown>)[group]
  return typeof label === "string" && label.trim() ? label.trim() : group
}

const NAV_ITEM_BY_SECTION = new Map<string, NavItem>()
for (const item of navItems) {
  const match = Object.entries(VOICE_SECTIONS).find(([, href]) => href === item.href)
  if (match) NAV_ITEM_BY_SECTION.set(match[0], item)
}

/**
 * Real menu labels, grouped by stable section key and locale.
 *
 * Both the plain label and group-qualified label are advertised. The plain
 * form stays natural; the qualified form gives the model a deterministic way
 * to disambiguate real collisions such as two "Analytics" menu items.
 */
/**
 * Spoken names a menu label does not carry.
 *
 * Kept deliberately tiny. This catalog is re-read by the provider on every
 * response and its size is a hard limit on answers per minute — the account's
 * realtime ceiling was hit mid-demo once already. So only sections people
 * actually say a different word for get an entry, and only the words they say:
 * the owner reported the assistant could not work out where "доска" was, and
 * the menu says "Доски" while people say "канбан" and "доска задач".
 */
const EXTRA_SECTION_ALIASES: Record<string, Record<VoiceSectionLocale, string[]>> = {
  boards: {
    ru: ["Канбан", "Доска задач"],
    az: ["Kanban", "Tapşırıq lövhəsi"],
    en: ["Kanban", "Task board"],
  },
}

export const VOICE_SECTION_ALIASES: Record<string, Record<VoiceSectionLocale, string[]>> =
  Object.fromEntries(VOICE_SECTION_KEYS.map((section) => {
    const item = NAV_ITEM_BY_SECTION.get(section)
    const localized = Object.fromEntries((Object.keys(LOCALIZED_NAV) as VoiceSectionLocale[]).map((locale) => {
      const label = item ? LOCALIZED_NAV[locale].nav?.[item.tKey] : undefined
      if (typeof label !== "string" || !label.trim() || !item) return [locale, []]
      const cleanLabel = label.trim()
      const group = translatedGroup(LOCALIZED_NAV[locale], item.group)
      const extra = EXTRA_SECTION_ALIASES[section]?.[locale] ?? []
      return [locale, [cleanLabel, `${group}: ${cleanLabel}`, ...extra]]
    })) as Record<VoiceSectionLocale, string[]>
    return [section, localized]
  }))

/** Real launcher summaries; kept separate so descriptions are never aliases. */
export const VOICE_SECTION_SUMMARIES: Record<string, Record<VoiceSectionLocale, string | null>> =
  Object.fromEntries(VOICE_SECTION_KEYS.map((section) => {
    const item = NAV_ITEM_BY_SECTION.get(section)
    const localized = Object.fromEntries((Object.keys(LOCALIZED_NAV) as VoiceSectionLocale[]).map((locale) => {
      const summary = item ? LOCALIZED_NAV[locale].navDesc?.[item.tKey] : undefined
      return [locale, typeof summary === "string" && summary.trim() ? summary.trim() : null]
    })) as Record<VoiceSectionLocale, string | null>
    return [section, localized]
  }))

function normalizeSectionAlias(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function containsWholeAlias(text: string, alias: string): boolean {
  return text === alias || text.startsWith(`${alias} `) || text.endsWith(` ${alias}`) || text.includes(` ${alias} `)
}

/** Resolve a localized label without silently choosing a duplicate menu item. */
export function resolveVoiceSectionAlias(
  value: string,
  locale?: VoiceSectionLocale,
): VoiceSectionResolution {
  const input = normalizeSectionAlias(value)
  if (!input) return { status: "not_found", candidates: [] }

  const locales: VoiceSectionLocale[] = locale ? [locale] : ["ru", "az", "en"]
  const matches: Array<{ section: string; length: number }> = []
  for (const section of VOICE_SECTION_KEYS) {
    for (const language of locales) {
      for (const rawAlias of VOICE_SECTION_ALIASES[section][language]) {
        const alias = normalizeSectionAlias(rawAlias)
        if (alias && containsWholeAlias(input, alias)) matches.push({ section, length: alias.length })
      }
    }
  }
  if (matches.length === 0) return { status: "not_found", candidates: [] }

  const longest = Math.max(...matches.map((match) => match.length))
  const candidates = [...new Set(matches.filter((match) => match.length === longest).map((match) => match.section))].sort()
  return candidates.length === 1
    ? { status: "resolved", section: candidates[0] }
    : { status: "ambiguous", candidates }
}
