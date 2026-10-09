import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const page = readFileSync(resolve("src/app/(dashboard)/mtm/map/page.tsx"), "utf8")
// 2026-10-09 the employee cards became a compact table with its own component
// (owner: «список должен быть компактным, завтра будут например 100
// пользователей»). What every row says without a click is asserted there.
const roster = readFileSync(resolve("src/components/mtm/live-map-roster.tsx"), "utf8")
const locales = ["en", "ru", "az"].map((locale) =>
  JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8"))
)

describe("SWM-12 simple and trustworthy live map UI contract", () => {
  it("never loads a full-day GPS replay when an employee is selected in live mode", () => {
    expect(page).not.toContain("handleReplay")
    expect(page).not.toContain("ReplaySnapshot")
    expect(page).not.toContain("replayTrack=")
    expect(page).toContain("void fetchAgentRoute(agentId, tenantToday)")
    expect(page).toContain("mode=history&agentId=")
  })

  // 2026-10-09 the optional tools left the closed panel under the page for
  // «Слои» on the map itself (owner: «как убирать на карте объекты, агентов»).
  // What the rule protects is unchanged: the header stays for the status
  // chips, and the tools are closed until somebody opens them.
  it("keeps the primary header focused and puts optional tools in a control that is closed until opened", () => {
    expect(page).toContain("<LiveMapLayersControl")
    expect(page).not.toContain('tMap("additionalControls")')
    expect(page).toContain('note={tMap("historyOnlyExplicit")}')
    expect(page).toContain('testId: "mtm-map-heatmap-toggle"')
    expect(page).not.toContain("const [showFeed, setShowFeed]")
    const control = readFileSync(resolve("src/components/mtm/live-map-layers-control.tsx"), "utf8")
    expect(control).toContain("const [open, setOpen] = useState(false)")
    expect(control).toContain("{open ? (")
  })

  // Owner, 2026-10-08, counted under «Gecikir (1)» and looking at zeros on the
  // other chips: «почему тут по нулям, я же в приложении?» — his card said he
  // was online with fresh GPS and an active workday, and which chip counted
  // him was told only after a click on the card.
  it("says on every row what the employee is doing, in the chip's own word, without a click", () => {
    // The status is a column of the narrow list — the one beside the map — and
    // cannot be switched off in the wide table either, so it is on every row
    // whatever the width; mtm-live-map-roster.test.ts reads the rendered word
    // («Опаздывает») off an unselected row.
    const lib = readFileSync(resolve("src/lib/mtm/live-map-roster.ts"), "utf8")
    expect(lib).toContain('export const ROSTER_LOCKED_COLUMNS: readonly RosterColumnId[] = ["name", "status"]')
    expect(roster).toContain("const narrowColumns = ROSTER_NARROW_COLUMNS")
    expect(lib).toContain('export const ROSTER_NARROW_COLUMNS: readonly RosterColumnId[] = ["name", "status", "signal"]')
    const status = roster.slice(roster.indexOf('case "status": {'), roster.indexOf('case "signal": {'))
    expect(status).toContain("data-testid={`live-map-agent-status-${agent.agentId}`}")
    expect(status).toContain('valueLabel("status", status)')
    // The status is said once: the detail a click opens does not repeat it.
    expect(page).not.toContain("fieldStatus.${")
    // «On site» in a visit opened on an earlier day says when it was opened, with the date.
    expect(status).toContain('const openedAt = status === "CHECKED_IN" && agent.openVisitSince ? agent.openVisitSince : null')
    expect(status).toContain("const since = openedAt ? formatVisitOpened(openedAt) : \"\"")
    // …and on the narrow list, where the time does not fit, an earlier day is marked on the row.
    expect(status).toContain("const stale = openedAt != null && isEarlierDay(openedAt)")
    expect(page).toContain("isEarlierDay={(value) => visitOpenedOnAnotherDay(value, contract?.timezone)}")
    expect(page).toMatch(/const formatVisitOpened = \(value: string\) => formatDateTime\(value, locale, visitOpenedOnAnotherDay\(value, contract\?\.timezone\)/)
    expect(page).toContain("formatVisitOpened={formatVisitOpened}")
    for (const messages of locales) {
      expect(messages.mtmMap.visitOpenedAt).toContain("{time}")
    }
  })

  // What changed on 2026-10-09, deliberately: a row is one line, so the three
  // truths are no longer three phrases on every card. Each row still carries
  // them — the application as the dot before the name, the GPS as the age of
  // the signal in the freshness colour, both with the words in a tooltip — the
  // wide table has a column for each, and the detail spells all three out.
  it("shows presence, GPS and workday truth on the row, in the table and in words in the detail", () => {
    const name = roster.slice(roster.indexOf('case "name": {'), roster.indexOf('case "status": {'))
    expect(name).toContain('agent.isOnline ? "bg-green-500"')
    expect(name).toContain('tMap(`presence.${agent.isOnline ? "online" : "offline"}`)')
    const signal = roster.slice(roster.indexOf('case "signal": {'), roster.indexOf('case "team": return <span'))
    expect(signal).toContain("rosterSignalAge(agent.recordedAt, nowMs)")
    expect(signal).toContain("tMap(`freshness.${agent.freshness.toLowerCase()}`)")
    expect(roster).toContain("tMap(`workday.${agent.workdayState.toLowerCase()}`)")
    expect(roster).toContain('case "app": return')
    expect(page).toContain('tMap(`presence.${appPresent ? "online" : "offline"}`)')
    expect(page).toContain('tMap(`freshness.${agent.freshness.toLowerCase()}`)')
    expect(page).toContain('tMap(`workday.${agent.workdayState.toLowerCase()}`)')
    expect(page).toContain('tMap("workdayState")')
    // The helper keeps the independent capability boundary explicit: a
    // Routes-only tenant must not filter its map by a Workforce workday, while
    // a Workforce-enabled tenant must retain the workday-aware visibility rule.
    expect(page).toContain("? isLiveMapAgentPositionVisible(freshness, workdayState)")
    expect(page).toContain("hasRenderableLivePosition(freshness, agent.workdayState, workforceEnabled)")
  })

  it("ships the simplified and background-recovery copy in every supported locale", () => {
    for (const messages of locales) {
      expect(messages.mtmMap).toMatchObject({
        workdayState: expect.any(String),
        workday: {
          active: expect.any(String),
          paused: expect.any(String),
          closed: expect.any(String),
          not_started: expect.any(String),
        },
        layers: {
          title: expect.any(String),
          agents: expect.any(String),
          route: expect.any(String),
          zones: expect.any(String),
          heat: expect.any(String),
          hiddenAgents: expect.stringContaining("{count}"),
          showAll: expect.any(String),
        },
        historyOnlyExplicit: expect.any(String),
        selectForDetails: expect.any(String),
        mapBackgroundUnavailable: expect.any(String),
        mapBackgroundUnavailableHint: expect.any(String),
        retryMapBackground: expect.any(String),
      })
    }
  })
})
