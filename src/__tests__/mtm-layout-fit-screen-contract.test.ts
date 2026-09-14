import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { defaultBroadcastAudience, operationsRoleKey } from "@/lib/mtm/operations-audience"

/**
 * Owner report 2026-09-14: on MTM pages "the right part goes off the screen",
 * "texts go off the screen", the Panel squeezed the whole week into a strip
 * at 1600 px, and the team-messages recipient list was a scroll box showing
 * four people out of sixteen.
 *
 * The dashboard <main> is `overflow-x-hidden`: anything wider than it is cut
 * off at the right edge without a scrollbar, so these shapes never announce
 * themselves in a test run or a narrow review. This file pins the shapes that
 * produced them.
 *
 * Folders owned by other in-flight work (visits, map, routes, photos and
 * their components) are deliberately out of scope here.
 */

const EXCLUDED = [
  /^src\/app\/\(dashboard\)\/mtm\/(visits|map|routes|photos)\//,
  /^src\/components\/mtm\/visit-[^/]*\.tsx$/,
  /^src\/components\/mtm\/location-history-panel\.tsx$/,
  /^src\/components\/mtm\/route-map\.tsx$/,
]

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return path.endsWith(".tsx") ? [path] : []
  })
}

const MTM_SOURCES = [...walk("src/app/(dashboard)/mtm"), ...walk("src/components/mtm")]
  .map((path) => path.split("\\").join("/"))
  .filter((path) => !EXCLUDED.some((pattern) => pattern.test(path)))

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length
}

/** Every "…" / `…` literal on one line — where Tailwind class lists live. */
function classLiterals(source: string): Array<{ text: string; index: number }> {
  const literals: Array<{ text: string; index: number }> = []
  for (const match of source.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
    literals.push({ text: match[0], index: match.index ?? 0 })
  }
  return literals
}

// Content width available to a page at the lower edge of each breakpoint:
// the sidebar is 4rem below lg and 16rem from lg, <main> pads 1rem below lg
// and 2rem from lg on each side.
const CONTENT_WIDTH_PX: Record<string, number> = {
  sm: 640 - 64 - 32,
  md: 768 - 64 - 32,
  lg: 1024 - 256 - 64,
  xl: 1280 - 256 - 64,
  "2xl": 1536 - 256 - 64,
}
// An `auto` track holds a button or a select; count a modest minimum for it.
const AUTO_TRACK_PX = 96
const GAP_PX = 16

function lengthPx(value: string): number | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)(rem|px)$/)
  if (!match) return null
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1)
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of value) {
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ""
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
}

function trackMinimumPx(track: string): number {
  const trimmed = track.trim()
  const repeat = trimmed.match(/^repeat\((\d+),(.*)\)$/)
  if (repeat) return Number(repeat[1]) * trackMinimumPx(repeat[2]) + (Number(repeat[1]) - 1) * GAP_PX
  const minmax = trimmed.match(/^minmax\((.*)\)$/)
  if (minmax) {
    const [min] = splitTopLevel(minmax[1], ",")
    return trackMinimumPx(min)
  }
  const fixed = lengthPx(trimmed)
  if (fixed !== null) return fixed
  if (/^(auto|min-content|max-content)$/.test(trimmed) || trimmed.startsWith("fit-content")) return AUTO_TRACK_PX
  return 0 // fr, 0
}

/** Pure: the rule itself, exercised on known inputs below. */
function gridTemplateMinimumPx(template: string): number {
  const tracks = splitTopLevel(template, "_")
  return tracks.reduce((sum, track) => sum + trackMinimumPx(track), 0) + (tracks.length - 1) * GAP_PX
}

describe("MTM pages fit the screen", () => {
  it("scans the MTM sources it claims to", () => {
    expect(MTM_SOURCES).toContain("src/app/(dashboard)/mtm/operations/page.tsx")
    expect(MTM_SOURCES).toContain("src/components/mtm/operational-week-home.tsx")
    expect(MTM_SOURCES).toContain("src/components/mtm/task-workspace.tsx")
    expect(MTM_SOURCES.some((path) => path.includes("/mtm/visits/"))).toBe(false)
  })

  it("never mixes px arbitrary breakpoints with theme breakpoints in one class list", () => {
    // Tailwind v4 emits `min-[1600px]:` BEFORE `sm:`/`md:`/`lg:`, so on the
    // same property the px variant always loses. `md:grid … min-[1600px]:hidden`
    // kept the compact attention rail on screen at 1600 px, squeezed the week
    // into a 20rem column and showed the block twice. rem arbitrary values
    // (`min-[100rem]:`) sort after the theme breakpoints and are fine.
    const offenders: string[] = []
    for (const path of MTM_SOURCES) {
      const source = readFileSync(path, "utf8")
      for (const { text, index } of classLiterals(source)) {
        if (/(?:^|[\s"`])(?:min|max)-\[\d+(?:\.\d+)?px\]:/.test(text) && /(?:^|[\s"`:])(?:sm|md|lg|xl|2xl):/.test(text)) {
          offenders.push(`${path}:${lineOf(source, index)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps breakpoint grid templates within the content width they switch on at", () => {
    // `lg:grid-cols-[minmax(16rem,1fr)_11rem_13rem_auto]` needs ~784 px on a
    // 704 px content area (1024 px, sidebar open): the last filter button was
    // simply cut off. Same for the contacts and promotions filter rows.
    const offenders: string[] = []
    for (const path of MTM_SOURCES) {
      const source = readFileSync(path, "utf8")
      for (const match of source.matchAll(/(?:^|[\s"`])(sm|md|lg|xl|2xl):grid-cols-\[([^\]\s"`]+)\]/g)) {
        const breakpoint = match[1]
        const needed = gridTemplateMinimumPx(match[2])
        if (needed > CONTENT_WIDTH_PX[breakpoint]) {
          offenders.push(`${path}:${lineOf(source, match.index ?? 0)} ${breakpoint}:grid-cols-[${match[2]}] needs ${needed}px > ${CONTENT_WIDTH_PX[breakpoint]}px`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("measures grid templates the way the rule assumes", () => {
    expect(gridTemplateMinimumPx("minmax(16rem,1fr)_11rem_13rem_auto")).toBe(256 + 176 + 208 + 96 + 3 * 16)
    expect(gridTemplateMinimumPx("minmax(14rem,2fr)_repeat(4,minmax(9rem,1fr))")).toBe(224 + 4 * 144 + 3 * 16 + 16)
    expect(gridTemplateMinimumPx("minmax(0,2fr)_minmax(17rem,1fr)")).toBe(272 + 16)
    expect(gridTemplateMinimumPx("minmax(0,1fr)_auto")).toBe(96 + 16)
  })

  it("wraps every table in its own horizontal scroll container", () => {
    const offenders: string[] = []
    for (const path of MTM_SOURCES) {
      const source = readFileSync(path, "utf8")
      for (const match of source.matchAll(/<table\b/g)) {
        const index = match.index ?? 0
        if (!/overflow-(?:x-)?auto/.test(source.slice(Math.max(0, index - 600), index))) {
          offenders.push(`${path}:${lineOf(source, index)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("renders the Panel week full-width with one attention rail per range", () => {
    const panel = readFileSync("src/components/mtm/operational-week-home.tsx", "utf8")
    expect(panel).not.toContain("md:grid md:grid-cols-2 min-[1600px]:hidden")
    expect(panel).toContain("md:max-[100rem]:grid md:max-[100rem]:grid-cols-2 min-[100rem]:hidden")
    // The wide rail grows with the page instead of scrolling inside itself.
    expect(panel).not.toMatch(/<aside className="hidden[^"]*overflow-y-auto/)
  })

  it("lays the task workspace out in two columns only when both fit", () => {
    const workspace = readFileSync("src/components/mtm/task-workspace.tsx", "utf8")
    expect(workspace).not.toContain("lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]")
    expect(workspace).toContain("xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]")
    expect(workspace).toContain('<aside className="order-1 min-w-0 space-y-6 print:hidden xl:order-2">')
    expect(workspace).not.toContain("lg:sticky")
  })
})

describe("team messages recipients", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/operations/page.tsx", "utf8")
  const picker = page.slice(page.indexOf("function AudiencePicker("), page.indexOf("export default function MtmOperationsPage"))

  it("lists recipients in the page flow, not in a scroll box", () => {
    expect(picker.length).toBeGreaterThan(0)
    expect(picker).not.toMatch(/max-h-[^\s"]+/)
    expect(picker).not.toContain("overflow-y-auto")
    expect(page).not.toContain("max-h-[760px]")
    expect(page).not.toContain("max-h-[820px]")
  })

  it("shows one localized role label instead of the raw enum twice", () => {
    expect(picker).not.toContain("{agent.role}")
    expect(picker).not.toContain("agent.team?.name || agent.role")
    expect(picker).toContain("{roleLabel(agent.role)}")
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const role of ["ADMIN", "MANAGER", "SUPERVISOR", "AGENT", "OTHER"]) {
        expect(messages.mtmOperationsPage.roles[role], `${locale} ${role}`).toEqual(expect.any(String))
      }
    }
  })

  it("pre-selects field staff only", () => {
    expect(page).toContain("setMessageRecipients(defaultBroadcastAudience(data.agents))")
    expect(page).not.toContain("setMessageRecipients(data.agents.map((agent) => agent.id))")
    expect(page).not.toContain("setMessageRecipients(data?.agents.map((agent) => agent.id) ?? [])")
  })

  it("names the section the same in the menu and on the page", () => {
    const expected = { en: "Team messages", ru: "Связь с командой", az: "Komanda ilə əlaqə" } as const
    for (const [locale, label] of Object.entries(expected)) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.nav.mtmOperations).toBe(label)
      expect(messages.mtmOperationsPage.title).toBe(label)
    }
  })
})

describe("operations audience helpers", () => {
  it("defaults a broadcast to agents only", () => {
    expect(defaultBroadcastAudience([
      { id: "m1", role: "MANAGER" },
      { id: "a1", role: "AGENT" },
      { id: "s1", role: "SUPERVISOR" },
      { id: "x1", role: "ADMIN" },
      { id: "a2", role: "agent" },
      { id: "q1", role: null },
    ])).toEqual(["a1", "a2"])
    expect(defaultBroadcastAudience([])).toEqual([])
  })

  it("maps roles to known label keys and everything else to OTHER", () => {
    expect(operationsRoleKey("MANAGER")).toBe("MANAGER")
    expect(operationsRoleKey("supervisor")).toBe("SUPERVISOR")
    expect(operationsRoleKey("QA")).toBe("OTHER")
    expect(operationsRoleKey(undefined)).toBe("OTHER")
  })
})
