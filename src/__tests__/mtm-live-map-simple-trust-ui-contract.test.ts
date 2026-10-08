import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const page = readFileSync(resolve("src/app/(dashboard)/mtm/map/page.tsx"), "utf8")
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
  it("says on every card what the employee is doing, in the chip's own word, without a click", () => {
    const status = page.indexOf("data-testid={`live-map-agent-status-${agent.agentId}`}")
    expect(status).toBeGreaterThan(-1)
    expect(status).toBeLessThan(page.indexOf("{isSelected ? ("))
    const line = page.slice(status, page.indexOf("tMap(`presence.", status))
    expect(line).toContain("tMap(`fieldStatus.${cfg.labelKey}`)")
    // The status is said once: not again in the detail a click opens.
    expect(page.match(/tMap\(`fieldStatus\.\$\{cfg\.labelKey\}`\)/g) ?? []).toHaveLength(1)
    // «On site» in a visit opened on an earlier day says when it was opened, with the date.
    expect(line).toContain('agent.fieldStatus === "CHECKED_IN" && agent.openVisitSince')
    expect(line).toContain("visitOpenedOnAnotherDay(agent.openVisitSince, contract?.timezone)")
    for (const messages of locales) {
      expect(messages.mtmMap.visitOpenedAt).toContain("{time}")
    }
  })

  it("shows presence, GPS and workday truth before expanding optional detail", () => {
    expect(page).toContain('tMap(`presence.${appPresent ? "online" : "offline"}`)')
    expect(page).toContain('tMap(`freshness.${agent.freshness.toLowerCase()}`)')
    expect(page).toContain('tMap(`workday.${agent.workdayState.toLowerCase()}`)')
    expect(page.indexOf('tMap(`workday.${agent.workdayState.toLowerCase()}`)')).toBeLessThan(
      page.indexOf("{isSelected ? (")
    )
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
