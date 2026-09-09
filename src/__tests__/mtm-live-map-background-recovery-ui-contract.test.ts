import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const map = readFileSync(resolve("src/components/mtm/live-map.tsx"), "utf8")

describe("SWM-12 live map background recovery UI contract", () => {
  it("waits for repeated CARTO tile errors before showing a distinct background warning", () => {
    expect(map).toContain("const BASE_MAP_TILE_ERROR_THRESHOLD = 3")
    expect(map).toContain("onLoading={handleBaseMapLoading}")
    expect(map).toContain("onError={handleBaseMapTileError}")
    expect(map).toContain("onLoad={handleBaseMapTileSuccess}")
    expect(map).toContain("baseMapTileSuccessCountRef.current > 0")
    expect(map).toContain("window.setTimeout(() =>")
    expect(map).toContain('data-testid="mtm-live-map-background-error"')
    expect(map).toContain('tMap("mapBackgroundUnavailable")')
    expect(map).toContain('tMap("mapBackgroundUnavailableHint")')
  })

  it("offers a touch-sized retry that remounts only the CARTO background layer", () => {
    expect(map).toContain("setBaseMapRevision((current) => current + 1)")
    expect(map).toContain("resetBaseMapAttempt()")
    expect(map).toContain("key={`carto-${baseMapRevision}`}")
    expect(map).toContain("onClick={retryBaseMap}")
    expect(map).toContain('className="mt-2 inline-flex min-h-11')
    expect(map).toContain('tMap("retryMapBackground")')
  })

  it("preserves the employee-coordinate and heatmap rendering contracts", () => {
    expect(map).toContain('data-testid="mtm-live-map-canvas"')
    expect(map).toContain("data-ready={ready}")
    expect(map).toContain('data-rendered-agent-ids={renderedAgentIds.join(",")}')
    expect(map).toContain("data-heatmap-point-count={showHeatmap ? heatPoints.length : 0}")
    expect(map).toContain("{showHeatmap && heatPoints.map((point) => (")
  })
})
