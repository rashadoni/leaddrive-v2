/**
 * The Panel's help article quotes only labels the Panel still draws.
 *
 * Until 2026-10-11 the article described three quick-action buttons, a period
 * filter, four KPI cards, a completion ring and a «recent visits» table for a
 * month after they left the screen (2026-09-14, 2026-09-21). Their keys were
 * never removed from messages/*.json, so «the label exists in messages» would
 * have proved nothing: a quoted label has to belong to a key the screen's
 * source still reads through `t(…)`.
 *
 * Checked in all three articles: every <HelpKey> and every «…» / “…”
 * quotation. A quotation may carry sample values («Неделя: 42 визита») or an
 * ellipsis in place of one («На связи: …»).
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const LOCALES = ["ru", "az", "en"] as const
type Locale = (typeof LOCALES)[number]

const HOME = ["mtmDashboardPage", "home"] as const
const WEEK = ["mtmDashboardPage", "operationalWeek"] as const

/**
 * Where the Panel reads its text: file, translator variable, namespace.
 * The home cards pick many keys from tables (`t(STATE_KEY[state.kind])`), so
 * for them a key counts when the file names it at all (`call: null`).
 */
const SCREEN: ReadonlyArray<{ file: string; call: string | null; namespace: readonly string[] }> = [
  { file: "src/app/(dashboard)/mtm/page.tsx", call: "t", namespace: ["nav"] },
  { file: "src/app/(dashboard)/mtm/page.tsx", call: "td", namespace: ["mtmDashboardPage"] },
  { file: "src/components/mtm/operational-week-home.tsx", call: "t", namespace: WEEK },
  { file: "src/components/mtm/home-dashboard.tsx", call: null, namespace: HOME },
  { file: "src/components/mtm/home-dashboard.tsx", call: "tw", namespace: WEEK },
  { file: "src/components/mtm/home-attention-card.tsx", call: null, namespace: HOME },
  { file: "src/components/mtm/home-team-card.tsx", call: null, namespace: HOME },
  { file: "src/components/mtm/home-team-card.tsx", call: "tw", namespace: WEEK },
  { file: "src/components/mtm/home-insight-cards.tsx", call: null, namespace: HOME },
]

type Messages = { [key: string]: string | Messages }

function messagesFor(locale: Locale): Messages {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
}

function namespaceOf(messages: Messages, path: readonly string[]): Messages {
  let node: string | Messages = messages
  for (const part of path) node = typeof node === "string" ? {} : node[part] ?? {}
  return typeof node === "string" ? {} : node
}

const PLACEHOLDER = "\u0000"

/** A message as the patterns a reader may see: one per plural branch, values as wildcards. */
function patternsOf(message: string): RegExp[] {
  // Plain {name} first, so a plural branch that carries one is a flat string.
  const flat = message.replace(/\{\s*\w+\s*\}/g, PLACEHOLDER)
  const branches = /,\s*plural\s*,/.test(flat)
    ? [...flat.matchAll(/(?:=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g)].map((match) => match[1])
    : [flat]
  return branches.map((branch) => {
    const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`^${escaped.replace(new RegExp(`${PLACEHOLDER}|#`, "g"), ".+")}$`)
  })
}

/** Every label the screen can draw in this locale. */
function drawnLabels(locale: Locale): RegExp[] {
  const messages = messagesFor(locale)
  const patterns: RegExp[] = []
  for (const { file, call, namespace } of SCREEN) {
    const source = readFileSync(file, "utf8")
    for (const [key, value] of Object.entries(namespaceOf(messages, namespace))) {
      if (typeof value !== "string") continue
      // `t("key")`, and `t(cond ? "a" : "key", …)` on one line.
      const drawn = call ? new RegExp(`\\b${call}\\([^\\n]*"${key}"`).test(source) : source.includes(`"${key}"`)
      if (drawn) patterns.push(...patternsOf(value))
    }
  }
  // The module's name in the sidebar; the sidebar, not the page, draws it.
  const moduleName = namespaceOf(messages, ["nav", "groups"])["Route & Field"]
  if (typeof moduleName === "string") patterns.push(...patternsOf(moduleName))
  return patterns
}

function quotationsIn(locale: Locale): string[] {
  const source = readFileSync(`src/content/help/mtm-overview/${locale}.tsx`, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{" "\}/g, " ")
  const quoted = locale === "en" ? /“([^”]+)”/g : /«([^»]+)»/g
  return [...source.matchAll(/<HelpKey>([\s\S]*?)<\/HelpKey>/g), ...source.matchAll(quoted)]
    .map((match) => match[1].replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/\s+/g, " ").trim())
}

describe("MTM Panel help article — quoted labels exist on the screen", () => {
  it.each(LOCALES)("%s: every quotation is a label the Panel draws", (locale) => {
    const labels = drawnLabels(locale)
    const quotations = quotationsIn(locale)
    // An extractor that finds nothing would pass every article.
    expect(quotations.length, `${locale}: quotations found`).toBeGreaterThan(30)
    const unknown = [...new Set(quotations)].filter((quotation) => !labels.some((label) => label.test(quotation)))
    expect(unknown, `${locale}: quoted in the help article, not drawn by the Panel`).toEqual([])
  })

  it("matches sample values and ellipses against placeholders and plural branches", () => {
    const gps = patternsOf("с подтверждением по GPS {percent}%")
    expect(gps.some((pattern) => pattern.test("с подтверждением по GPS 90%"))).toBe(true)
    expect(gps.some((pattern) => pattern.test("с подтверждением по GPS"))).toBe(false)
    const more = patternsOf("{count, plural, one {Ещё # сотрудник} few {Ещё # сотрудника} many {Ещё # сотрудников} other {Ещё # сотрудника}}")
    expect(more.some((pattern) => pattern.test("Ещё 6 сотрудников"))).toBe(true)
    expect(more.some((pattern) => pattern.test("Ещё сотрудников"))).toBe(false)
  })
})
