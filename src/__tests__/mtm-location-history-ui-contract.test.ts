import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const panel = readFileSync(resolve("src/components/mtm/location-history-panel.tsx"), "utf8")
const map = readFileSync(resolve("src/components/mtm/location-history-map.tsx"), "utf8")
const locales = ["en", "ru", "az"].map((locale) =>
  JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8"))
)

describe("SWM-10 GPS history presentation contract", () => {
  it("renders tenant-timezone moments on both the map and evidence panels", () => {
    expect(panel).toContain("formatInTimezone(value, timezone")
    expect(panel).toContain("timezone={timezone}")
    expect(map).toContain("formatInTimezone(value, timezone")
    expect(panel).not.toContain("formatDateTime(")
    expect(map).not.toContain("formatDateTime(")
  })

  it("localizes domain statuses instead of exposing internal enum values", () => {
    expect(panel).toContain("workdayStatus.${data.workday.status}")
    expect(panel).toContain("timelineSource.${event.source}")
    expect(panel).toContain("visitStatuses.${visit.status}")
    expect(map).toContain("pointStatus.${point.status}")
    expect(panel).not.toContain("<dd>{data.workday.status}</dd>")
    expect(panel).not.toContain(">{event.source}</span>")
    expect(panel).not.toContain(">{visit.status}</td>")
    expect(map).not.toContain("<div>{point.status}</div>")
  })

  it("keeps compact history controls touch-sized", () => {
    expect(panel.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(8)
  })

  it("recovers employee roster and history failures independently", () => {
    expect(panel).toContain('const [rosterError, setRosterError]')
    expect(panel).toContain('const [historyError, setHistoryError]')
    expect(panel).toContain('data-testid="mtm-location-history-roster-retry"')
    expect(panel).toContain('onClick={() => void loadRoster()}')
    expect(panel).toContain('data-testid="mtm-location-history-history-retry"')
    expect(panel).toContain('onClick={() => void loadHistory()}')
    expect(panel).toContain('className="min-h-11"')
  })

  it("aborts stale requests and automatically follows one explicit history deep link", () => {
    expect(panel).toContain("const rosterRequestRef = useRef<AbortController | null>(null)")
    expect(panel).toContain("const historyRequestRef = useRef<AbortController | null>(null)")
    expect(panel).toContain("const requestedHistoryLoadRef")
    expect(panel.match(/\{ signal: controller\.signal \}/g)?.length ?? 0).toBe(2)
    expect(panel).toContain("rosterRequestRef.current?.abort()")
    expect(panel).toContain("historyRequestRef.current?.abort()")
    expect(panel).toContain("setData(null)")
    expect(panel).toContain("selectedFromUrl && resolvedAgentId")
    expect(panel).toContain("requestedHistoryLoadRef.current = { agentId: resolvedAgentId, date: resolvedDate }")
    expect(panel).toContain("if (!requested || loadingRoster || requested.agentId !== agentId || requested.date !== date) return")
    expect(panel).toContain("void loadHistory()")
  })

  it("lays out the full filter row from the panel width instead of the viewport", () => {
    expect(panel).toContain('data-testid="mtm-location-history-filter-form"')
    expect(panel).toContain('className="@container rounded-lg')
    expect(panel).toContain("@min-[64rem]:grid-cols-[minmax(220px,1.4fr)_160px_130px_130px_150px_auto]")
    expect(panel).toContain('data-testid="mtm-location-history-accuracy"')
    expect(panel).toContain('data-testid="mtm-location-history-submit"')
    expect(panel).toContain("@min-[64rem]:w-auto")
    expect(panel).not.toContain("lg:grid-cols-[minmax(220px,1.4fr)_160px_130px_130px_150px_auto]")
    expect(panel).not.toContain("lg:w-auto")
  })

  it("keeps the visit table heading separate from the visit status dictionary", () => {
    for (const messages of locales) {
      const history = messages.mtmMap.history
      expect(history.rosterLoadFailed).toEqual(expect.any(String))
      expect(history.retryEmployees).toEqual(expect.any(String))
      expect(history.retryHistory).toEqual(expect.any(String))
      expect(typeof history.visitStatus).toBe("string")
      expect(history.visitStatuses).toMatchObject({
        CHECKED_IN: expect.any(String),
        CHECKED_OUT: expect.any(String),
        CANCELLED: expect.any(String),
      })
    }
  })

  it("provides deterministic SWM-11 play, pause, restart and scrub controls", () => {
    expect(panel).toContain("const [playbackIndex, setPlaybackIndex]")
    expect(panel).toContain("const [isPlaying, setIsPlaying]")
    expect(panel).toContain('type="range"')
    expect(panel).toContain("playbackIndex={playbackIndex}")
    expect(panel).toContain('aria-current={index === activeTimelineIndex ? "step" : undefined}')
    expect(map).toContain("points.slice(0, visiblePointCount)")
    expect(map).toContain("point.id === activePoint?.id")
    expect(map).toContain("...fullActualPath")
  })

  it("keeps stop evidence visible in every locale", () => {
    expect(panel).toContain('t("battery")')
    expect(map).toContain("stop.batteryStart")
    expect(map).toContain("stop.connectivity === \"ONLINE\"")
    for (const messages of locales) {
      const history = messages.mtmMap.history
      expect(history.replayTitle).toEqual(expect.any(String))
      expect(history.replayPosition).toEqual(expect.any(String))
      expect(history.playbackRate).toEqual(expect.any(String))
    }
  })
})
