/**
 * An employee's marker on the live map, and the ring of his own colour.
 *
 * Owner, 2026-10-09, of the tracking product shown as the model: a manager
 * gives an employee a colour and finds him on the map by it. The marker
 * already speaks — its fill, its shape and its opacity say how fresh the GPS
 * point is — so the colour may only be added around it, never instead of it.
 * And the marker is a string of HTML: nothing typed on a card may get into it.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { MTM_AGENT_MAP_COLOR_KEYS, MTM_AGENT_MAP_COLORS } from "@/lib/mtm/agent-tags"
import { liveMapAgentMarker } from "@/lib/mtm/live-map-agent-marker"

const FRESHNESS = ["ONLINE", "DELAYED", "STALE"] as const
const marker = (over: Partial<Parameters<typeof liveMapAgentMarker>[0]> = {}) =>
  liveMapAgentMarker({ name: "Aynur", freshness: "ONLINE", focused: false, ...over })
/** One declaration of the marker's inline style, as written. */
const declared = (html: string, property: string) => new RegExp(`(?:^|[;"\\s])${property}:([^;]+);`).exec(html)?.[1] ?? null
/** The marker with its shadow taken out: everything that is not the ring. */
const withoutShadow = (html: string) => html.replace(/box-shadow:[^;]+;/, "box-shadow:;")

describe("the employee's marker", () => {
  it("is ringed with the colour from his card, outside its white border — each of the eight in its own hex", () => {
    for (const key of MTM_AGENT_MAP_COLOR_KEYS) {
      const shadow = declared(marker({ mapColor: key }).html, "box-shadow")
      // A spread-only shadow of three pixels: a ring that follows the marker's shape.
      expect(shadow, key).toContain(`0 0 0 3px ${MTM_AGENT_MAP_COLORS[key]}`)
      // The white border between the fill and the ring is still there.
      expect(marker({ mapColor: key }).html, key).toMatch(/border:2\.5px solid white;/)
    }
    const rings = MTM_AGENT_MAP_COLOR_KEYS.map((key) => declared(marker({ mapColor: key }).html, "box-shadow"))
    expect(new Set(rings).size).toBe(8)
  })

  it("closes the ring with a white hairline, so a dark colour is seen on the dark map too", () => {
    expect(declared(marker({ mapColor: "black" }).html, "box-shadow"))
      .toBe("0 0 0 3px #0f172a, 0 0 0 4px rgba(255,255,255,0.9), 0 2px 8px rgba(0,0,0,0.3)")
  })

  it("still says how fresh the GPS point is — by fill, shape and opacity — exactly as without a colour", () => {
    const said = FRESHNESS.map((freshness) => {
      const html = marker({ freshness }).html
      return [declared(html, "background"), declared(html, "border-radius"), declared(html, "opacity")]
    })
    expect(said).toEqual([
      ["#15803d", "50%", "1"],
      ["#b45309", "30% 70% 30% 70%", "1"],
      ["#64748b", "6px", "0.72"],
    ])
    // Whatever the colour, selected or not: the ring is the only thing that differs.
    for (const freshness of FRESHNESS) {
      for (const focused of [false, true]) {
        const plain = marker({ freshness, focused })
        for (const key of MTM_AGENT_MAP_COLOR_KEYS) {
          const coloured = marker({ freshness, focused, mapColor: key })
          expect(withoutShadow(coloured.html), `${freshness} ${key}`).toBe(withoutShadow(plain.html))
          expect(coloured.html).not.toBe(plain.html)
          // The ring is drawn outside the marker's box: it moves and resizes nothing.
          expect(coloured.size).toBe(plain.size)
        }
      }
    }
    expect([marker().size, marker({ focused: true }).size]).toEqual([32, 38])
  })

  it("has no ring for a card without a colour, or with a colour this build does not know", () => {
    const plain = marker()
    expect(declared(plain.html, "box-shadow")).toBe("0 2px 8px rgba(0,0,0,0.3)")
    // A key dropped from the palette later, a row written by a newer build
    // during a rollback, names every object answers to.
    for (const mapColor of [null, undefined, "", "ultraviolet", "PINK", "constructor", "__proto__", "toString"]) {
      expect(marker({ mapColor }), String(mapColor)).toEqual(plain)
    }
  })

  it("never lets text from a card into its HTML: a colour is a key of the palette or nothing", () => {
    const plain = marker()
    const hostile = [
      "#db2777",
      "red",
      "red;background:url(//example.invalid/x)",
      '#fff"><img src=x onerror=alert(1)>',
      "0 0 0 99px red, ",
    ]
    for (const mapColor of hostile) {
      const drawn = marker({ mapColor })
      expect(drawn, mapColor).toEqual(plain)
      expect(drawn.html).not.toMatch(/example\.invalid|onerror|99px/)
    }
  })

  it("writes the first letter of the name as text, whatever the name looks like", () => {
    expect(marker({ name: "əli" }).html).toMatch(/">Ə<\/div>$/)
    expect(marker({ name: "<script>alert(1)</script>" }).html).toMatch(/">&lt;<\/div>$/)
    expect(marker({ name: '"quoted"' }).html).toMatch(/">&quot;<\/div>$/)
    expect(marker({ name: "" }).html).toMatch(/">\?<\/div>$/)
  })
})

describe("the map that draws it", () => {
  const map = readFileSync("src/components/mtm/live-map.tsx", "utf8")
  const page = readFileSync("src/app/(dashboard)/mtm/map/page.tsx", "utf8")

  it("builds every employee's marker from that description, handing it the key stored on his card", () => {
    expect(map).toContain("const { html, size } = liveMapAgentMarker({ name, freshness, focused, mapColor })")
    expect(map).toContain("icon={agentIcon(agent.name, agent.freshness, isFocused, agent.mapColor)}")
    // The page passes the roster's row on whole, so the colour comes with it.
    expect(page).toContain("return [{ ...agent, freshness, latitude: agent.latitude, longitude: agent.longitude, recordedAt: agent.recordedAt }]")
  })

  it("leaves a cluster as it was: several people have no one colour", () => {
    const cluster = map.slice(map.indexOf("function clusterIcon("), map.indexOf("function routeStopIcon("))
    expect(cluster).toContain("mtm-agent-cluster-marker")
    expect(cluster).not.toMatch(/mapColor|liveMapAgentMarker/)
  })
})
