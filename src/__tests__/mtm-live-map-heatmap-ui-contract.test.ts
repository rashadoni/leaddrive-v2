import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const page = readFileSync(resolve("src/app/(dashboard)/mtm/map/page.tsx"), "utf8")
const map = readFileSync(resolve("src/components/mtm/live-map.tsx"), "utf8")

describe("SWM-12 live heatmap UI contract", () => {
  it("exposes an accessible stateful toggle and passes its state to the map", () => {
    expect(page).toContain('data-testid="mtm-map-heatmap-toggle"')
    expect(page).toContain("aria-pressed={showHeatmap}")
    expect(page).toContain("setShowHeatmap((current) => !current)")
    expect(page).toContain("showHeatmap={showHeatmap}")
  })

  it("reuses the bounded viewport cluster selection for density", () => {
    expect(map).toContain("showHeatmap?: boolean")
    expect(map).toContain("showHeatmap = false")
    expect(map).toContain("const markerSelection = useMemo(")
    expect(map).toContain("const heatPoints = useMemo(")
    expect(map).toContain("markerSelection.markers.map((marker)")
    expect(map).toContain('{showHeatmap && heatPoints.map((point) => (')
    expect(map).toContain("center={[point.latitude, point.longitude]}")
    expect(map).toContain('data-testid="mtm-live-map-canvas"')
    expect(map).toContain('data-rendered-agent-ids={renderedAgentIds.join(",")}')
    expect(map).toContain("data-heatmap-point-count={showHeatmap ? heatPoints.length : 0}")
  })

  it("keeps the density overlay non-interactive", () => {
    expect(map).toContain("interactive={false}")
    expect(map).toContain("bubblingMouseEvents={false}")
  })
})
