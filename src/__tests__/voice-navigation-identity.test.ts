import { describe, expect, it } from "vitest"
import { navItems } from "@/lib/nav-items"
import {
  isVoiceSection,
  voiceSectionFromLocation,
  voiceSectionPath,
  VOICE_SECTION_KEYS,
} from "@/lib/ai/voice/sections"
import {
  resolveVoiceSectionAlias,
  VOICE_SECTION_ALIASES,
  VOICE_SECTION_SUMMARIES,
} from "@/lib/ai/voice/section-aliases"

const SOCIAL_KEYS = [
  "social_monitoring_overview",
  "social_monitoring_monitors",
  "social_monitoring_mentions",
  "social_monitoring_replies",
  "social_monitoring_sources",
  "social_monitoring_scenarios",
  "social_monitoring_subjects",
  "social_monitoring_media",
  "social_monitoring_reports",
  "social_monitoring_agent",
  "social_monitoring_legal",
]

describe("voice navigation identity", () => {
  it("keeps every safe Social Monitoring view as an exact query-backed destination", () => {
    expect(VOICE_SECTION_KEYS.filter((key) => key.startsWith("social_monitoring_"))).toEqual(SOCIAL_KEYS)
    for (const key of SOCIAL_KEYS) {
      const destination = voiceSectionPath(key)
      const url = new URL(destination, "https://voice.invalid")
      expect(isVoiceSection(key)).toBe(true)
      expect(voiceSectionFromLocation(url.pathname, url.search)).toBe(key)
    }
  })

  it("excludes Social Monitoring settings from voice navigation", () => {
    const settings = navItems.find((item) => item.tKey === "socialMonitoringSettings")
    expect(settings?.href).toContain("view=settings")
    expect(Object.values(VOICE_SECTION_ALIASES).flatMap((entry) => entry.ru)).not.toContain("Настройки мониторинга")
    expect(VOICE_SECTION_KEYS).not.toContain("social_monitoring_settings")
    expect(voiceSectionFromLocation("/social-monitoring", "?scope=all&view=settings")).toBeNull()
  })

  it("recognizes exact Social views inside a brand workspace without scope=all", () => {
    expect(voiceSectionFromLocation(
      "/social-monitoring",
      "?monitoringId=brand-1&subjectId=subject-1&view=mentions",
    )).toBe("social_monitoring_mentions")
    expect(voiceSectionFromLocation(
      "/social-monitoring",
      "?monitoringId=brand-1&subjectName=Brand&view=overview",
    )).toBe("social_monitoring_overview")
    expect(voiceSectionFromLocation(
      "/social-monitoring",
      "?monitoringId=brand-1&subjectName=Brand",
    )).toBe("social_monitoring_monitors")
  })

  it("publishes a real label and launcher summary in every supported locale", () => {
    for (const key of VOICE_SECTION_KEYS) {
      for (const locale of ["ru", "az", "en"] as const) {
        expect(VOICE_SECTION_ALIASES[key][locale].length, `${key}/${locale}`).toBeGreaterThanOrEqual(2)
        expect(VOICE_SECTION_SUMMARIES[key][locale], `${key}/${locale}`).toBeTruthy()
      }
    }
  })

  it("resolves unique plain labels but never first-wins duplicate localized labels", () => {
    expect(resolveVoiceSectionAlias("Лиды", "ru")).toEqual({ status: "resolved", section: "leads" })
    expect(resolveVoiceSectionAlias("Аналитика", "ru")).toEqual({
      status: "ambiguous",
      candidates: ["contracts_analytics", "mtm_analytics"],
    })
    expect(resolveVoiceSectionAlias("VoIP Звонки", "ru")).toEqual({
      status: "ambiguous",
      candidates: ["inbox_voip", "support_voip"],
    })
  })

  it("resolves every group-qualified collision deterministically in RU, AZ and EN", () => {
    const duplicateLabels = new Map<string, Set<string>>()
    for (const section of VOICE_SECTION_KEYS) {
      for (const locale of ["ru", "az", "en"] as const) {
        const plain = VOICE_SECTION_ALIASES[section][locale][0]
        const bucket = duplicateLabels.get(`${locale}:${plain}`) ?? new Set<string>()
        bucket.add(section)
        duplicateLabels.set(`${locale}:${plain}`, bucket)
      }
    }

    const collisions = [...duplicateLabels.entries()].filter(([, sections]) => sections.size > 1)
    expect(collisions.length).toBeGreaterThan(0)
    for (const [identity, sections] of collisions) {
      const locale = identity.slice(0, 2) as "ru" | "az" | "en"
      for (const section of sections) {
        const qualified = VOICE_SECTION_ALIASES[section][locale][1]
        expect(resolveVoiceSectionAlias(qualified, locale), `${locale}: ${qualified}`).toEqual({
          status: "resolved",
          section,
        })
      }
    }
  })
})

describe("spoken names the menu label does not carry", () => {
  it("finds the board section by the words people actually use", () => {
    // Reported by the owner: the assistant could not work out where to go for
    // the boards. The menu says "Доски"; people say "канбан" or "доска задач".
    expect(resolveVoiceSectionAlias("канбан", "ru")).toEqual({ status: "resolved", section: "boards" })
    expect(resolveVoiceSectionAlias("доска задач", "ru")).toEqual({ status: "resolved", section: "boards" })
    expect(resolveVoiceSectionAlias("tapşırıq lövhəsi", "az")).toEqual({ status: "resolved", section: "boards" })
    expect(resolveVoiceSectionAlias("kanban", "en")).toEqual({ status: "resolved", section: "boards" })
  })

  it("stays small — the catalog is re-read on every response", () => {
    // One rate-limit outage already came from this payload's size.
    const extra = Object.values(VOICE_SECTION_ALIASES)
      .flatMap((entry) => [...entry.ru, ...entry.az, ...entry.en])
      .length
      - Object.values(VOICE_SECTION_ALIASES)
        .flatMap((entry) => [entry.ru, entry.az, entry.en])
        .filter((list) => list.length > 0)
        .length * 2
    // Every section carries its label and its group-qualified label; anything
    // beyond that is a deliberate synonym, and there must be very few.
    expect(extra).toBeLessThanOrEqual(12)
  })
})
