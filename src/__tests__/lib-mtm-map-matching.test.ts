import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  MATCH_CHUNK_SIZE,
  buildMatchChunks,
  mapMatchingBaseUrl,
  matchTrack,
  osrmMatchUrl,
  parseOsrmMatch,
  resetMapMatchingState,
} from "@/lib/mtm/map-matching"

/**
 * Owner 2026-09-27: the day's track along the streets, on our own OSRM. The
 * drawing improves; nothing depends on it — no answer means straight lines.
 */
const at = (second: number) => new Date(Date.UTC(2026, 8, 27, 7, 0, 0) + second * 1_000)
const fix = (second: number, latitude = 40.4, longitude = 49.85, accuracy: number | null = 10) => ({ latitude, longitude, recordedAt: at(second), accuracy })

beforeEach(() => resetMapMatchingState())

describe("where OSRM is", () => {
  it("is the production host's own port, an explicit URL, or nowhere", () => {
    expect(mapMatchingBaseUrl({ NODE_ENV: "production" })).toBe("http://127.0.0.1:5055")
    expect(mapMatchingBaseUrl({ NODE_ENV: "test" })).toBeNull()
    expect(mapMatchingBaseUrl({ NODE_ENV: "production", MTM_MAP_MATCHING_URL: "off" })).toBeNull()
    expect(mapMatchingBaseUrl({ MTM_MAP_MATCHING_URL: "http://osrm:5000/" })).toBe("http://osrm:5000")
  })
})

describe("cutting a day into traces", () => {
  it("does not invent a road across a silence of more than ten minutes", () => {
    const chunks = buildMatchChunks([fix(0), fix(30), fix(60), fix(60 + 11 * 60), fix(60 + 11 * 60 + 30)])
    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 2])
  })

  it("keeps each request within the limit and joins requests on a shared fix", () => {
    const day = Array.from({ length: 250 }, (_, index) => fix(index * 30))
    const chunks = buildMatchChunks(day)
    expect(chunks.every((chunk) => chunk.length <= MATCH_CHUNK_SIZE)).toBe(true)
    expect(chunks[1][0]).toBe(chunks[0].at(-1))
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0) - (chunks.length - 1)).toBe(250)
  })

  it("drops a repeated second — OSRM refuses timestamps that do not increase", () => {
    expect(buildMatchChunks([fix(0), fix(0, 40.41), fix(30)])[0]).toHaveLength(2)
  })
})

describe("the OSRM request and answer", () => {
  it("sends longitude first, whole seconds and the fix's accuracy as the search radius", () => {
    const url = osrmMatchUrl("http://127.0.0.1:5055", [fix(0, 40.4, 49.85, 3), fix(30, 40.41, 49.86, null), fix(60, 40.42, 49.87, 400)])
    expect(url.startsWith("http://127.0.0.1:5055/match/v1/driving/49.850000,40.400000;49.860000,40.410000;49.870000,40.420000?")).toBe(true)
    const query = new URL(url).searchParams
    expect(query.get("radiuses")).toBe("5;25;50")
    expect(query.get("timestamps")).toBe([0, 30, 60].map((second) => Math.floor(at(second).getTime() / 1_000)).join(";"))
    expect(query.get("gaps")).toBe("split")
    expect(query.get("geometries")).toBe("geojson")
  })

  it("turns OSRM's [longitude, latitude] into the map's [latitude, longitude] and counts matched fixes", () => {
    expect(parseOsrmMatch({
      code: "Ok",
      matchings: [{ geometry: { coordinates: [[49.85, 40.4], [49.86, 40.41]] } }, { geometry: { coordinates: [[49.9, 40.5]] } }],
      tracepoints: [{}, null, {}],
    })).toEqual({ segments: [[[40.4, 49.85], [40.41, 49.86]]], matchedPoints: 2 })
    expect(parseOsrmMatch({ code: "NoMatch" })).toBeNull()
  })
})

describe("matching a day", () => {
  const okResponse = () => new Response(JSON.stringify({
    code: "Ok",
    matchings: [{ geometry: { coordinates: [[49.85, 40.4], [49.851, 40.401], [49.86, 40.41]] } }],
    tracepoints: [{}, {}],
  }))

  it("draws along the roads when OSRM answers, and asks once for the same day", async () => {
    const fetchImpl = vi.fn(async () => okResponse())
    const day = [fix(0), fix(30, 40.41, 49.86)]
    const first = await matchTrack(day, { baseUrl: "http://osrm", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(first).toMatchObject({ matchedPoints: 2, totalPoints: 2, source: "osrm" })
    expect(first?.segments[0]).toHaveLength(3)
    await matchTrack(day, { baseUrl: "http://osrm", fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("keeps straight lines when OSRM is down, and stops asking for a minute", async () => {
    let clock = 1_000_000
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed: ECONNREFUSED") })
    const options = { baseUrl: "http://osrm", fetchImpl: fetchImpl as unknown as typeof fetch, now: () => clock }
    expect(await matchTrack([fix(0), fix(30)], options)).toBeNull()
    expect(await matchTrack([fix(0), fix(60)], options)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    clock += 61_000
    await matchTrack([fix(0), fix(90)], options)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("asks nothing where no OSRM is configured", async () => {
    const fetchImpl = vi.fn()
    expect(await matchTrack([fix(0), fix(30)], { baseUrl: null, fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("the history map", () => {
  const map = readFileSync("src/components/mtm/location-history-map.tsx", "utf8")
  const panel = readFileSync("src/components/mtm/location-history-panel.tsx", "utf8")
  const route = readFileSync("src/app/api/v1/mtm/location-history/route.ts", "utf8")

  it("gets the road track from the same points it draws", () => {
    expect(route).toContain("const matchedTrack = await matchTrack(points, { scope: `${auth.orgId}|${agentId}` }).catch(() => null)")
  })

  it("draws the roads only once the replay has shown the whole day, with the straight fixes kept thin underneath", () => {
    expect(map).toContain("layers.roads !== false && matchedTrack && visiblePointCount === points.length")
    expect(map).toContain("{ color: HISTORY_MAP_COLORS.raw, weight: 2, opacity: 0.7, dashArray: \"2 6\" }")
    expect(panel).toContain('.filter((layer) => layer !== "roads" || Boolean(data?.matchedTrack))')
    expect(panel).toContain('{data.matchedTrack && layers.roads ? t("legendRoads") : t("legendTrack")}')
  })
})

describe("the OSRM on production", () => {
  const workflow = readFileSync(".github/workflows/mtm-map-matching.yml", "utf8")
  const switchScript = readFileSync("scripts/ops/mtm-osrm-switch.sh", "utf8")

  it("builds the graph on a hosted runner and proves a match before anything reaches production", () => {
    expect(workflow).toContain("osrm-extract -p /opt/car.lua /data/azerbaijan-latest.osm.pbf")
    expect(workflow).toContain("jq -e '.code == \"Ok\" and (.matchings | length) > 0'")
    expect(workflow.indexOf("Prove it matches")).toBeLessThan(workflow.indexOf("Put the graph on production"))
    expect(workflow).toContain("needs: build")
    expect(workflow).not.toMatch(/^ {2}push:/m)
  })

  it("serves on the host's loopback only, stages a new graph on a side port, and keeps the old one when it fails", () => {
    expect(switchScript).toContain('-p "127.0.0.1:${port}:5000"')
    expect(switchScript).toContain("run_osrm mtm-osrm-next \"$next_port\" no")
    expect(switchScript).toContain("FATAL: the new graph did not answer; the live one is untouched")
    expect(switchScript.indexOf("answers \"$next_port\"")).toBeLessThan(switchScript.indexOf("docker rm -f mtm-osrm >/dev/null"))
  })
})
