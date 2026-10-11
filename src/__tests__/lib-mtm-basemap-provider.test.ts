// @vitest-environment jsdom
/**
 * Whose tiles the MTM maps fall back to (src/lib/mtm/basemap-provider.ts), and
 * the operator job that changes it on the running deployment
 * (.github/workflows/set-map-provider.yml).
 *
 * CARTO's free basemaps may be limited or cut off without warning (terms of
 * 29 September 2026). The settings here are read by the server when a page is
 * asked for, so that naming another provider — or moving every map to it —
 * needs no build. What is tested: what a deployment may say and what is
 * refused as half-said, that the browser reads the same thing back from the
 * document, and that the root layout writes it only when there is something
 * to write.
 */
import { readFileSync } from "node:fs"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const request = vi.hoisted(() => ({ pathname: "/mtm/map" as string | null }))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (name: string) => (name === "x-request-pathname" ? request.pathname : null) })),
}))
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "ru"),
  getMessages: vi.fn(async () => ({})),
}))
vi.mock("@/components/providers", () => ({ Providers: () => null }))
vi.mock("sonner", () => ({ Toaster: () => null }))

import RootLayout from "@/app/layout"
import { GET as askProvider } from "@/app/api/v1/public/basemap-provider/route"
import {
  BASEMAP_FAILOVER_MEMORY_MS,
  BASEMAP_PROVIDER_META,
  BASEMAP_PROVIDER_PATH,
  CARTO_ONLY,
  basemapBackupTiles,
  basemapFailoverRemembered,
  basemapProviderFromAnswer,
  basemapProviderFromDocument,
  basemapProviderFromEnv,
  forgetBasemapFailover,
  parseBasemapProvider,
  rememberBasemapFailover,
  serializeBasemapProvider,
} from "@/lib/mtm/basemap-provider"
import {
  BASEMAP_PROVIDER_ASK_AGAIN_MS,
  BASEMAP_PROVIDER_REFRESH_MS,
  basemapProviderSnapshot,
  refreshBasemapProvider,
  resetBasemapProviderStoreForTests,
  subscribeBasemapProvider,
} from "@/lib/mtm/basemap-provider-store"
import { tileUrlTemplate } from "@/lib/mtm/live-map-base-maps"

const ESRI = "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/navigation/static/tile/{z}/{y}/{x}?token=browser-key"
const CREDIT = "Powered by Esri | © Esri, TomTom, Garmin"
const said = (over: Record<string, string | undefined> = {}) => ({
  MTM_BASEMAP_BACKUP_TILE_URL: ESRI,
  MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION: CREDIT,
  ...over,
})

describe("what a deployment may say about its backup tile provider", () => {
  it("says nothing by default: every map is CARTO's and nothing stands behind it", () => {
    expect(basemapProviderFromEnv({})).toEqual(CARTO_ONLY)
    expect(serializeBasemapProvider(basemapProviderFromEnv({}))).toBeNull()
  })

  it("names a backup with an address and the credit it asks for; CARTO stays the background", () => {
    expect(basemapProviderFromEnv(said())).toEqual({
      primary: "carto",
      backup: { url: ESRI, attribution: CREDIT, tileSize: 256 },
    })
  })

  it("takes 512 px tiles when the provider's are that size, and nothing but the two sizes", () => {
    expect(basemapProviderFromEnv(said({ MTM_BASEMAP_BACKUP_TILE_SIZE: "512" })).backup?.tileSize).toBe(512)
    expect(basemapProviderFromEnv(said({ MTM_BASEMAP_BACKUP_TILE_SIZE: " 256 " })).backup?.tileSize).toBe(256)
    for (const size of ["1024", "big", "0", "512px"]) {
      expect(basemapProviderFromEnv(said({ MTM_BASEMAP_BACKUP_TILE_SIZE: size })), size).toEqual(CARTO_ONLY)
    }
  })

  it("makes the backup the background only when told to — and only when there is a backup", () => {
    expect(basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: "backup" })).primary).toBe("backup")
    expect(basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: " Backup " })).primary).toBe("backup")
    expect(basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: "carto" })).primary).toBe("carto")
    expect(basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: "esri" })).primary).toBe("carto")
    // «backup» with nothing to go to would leave every map without a background.
    expect(basemapProviderFromEnv({ MTM_BASEMAP_PRIMARY: "backup" })).toEqual(CARTO_ONLY)
  })

  it("refuses a half-said provider whole: it is then as if nothing was said", () => {
    const halfSaid: Array<[string, Record<string, string | undefined>]> = [
      ["no credit — whose map it is must be said on the map", { MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION: undefined }],
      ["a credit of spaces", { MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION: "   " }],
      ["a credit nobody would read", { MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION: "x".repeat(301) }],
      ["not https", { MTM_BASEMAP_BACKUP_TILE_URL: ESRI.replace("https://", "http://") }],
      ["no {z}", { MTM_BASEMAP_BACKUP_TILE_URL: ESRI.replace("{z}", "12") }],
      ["no {x}", { MTM_BASEMAP_BACKUP_TILE_URL: ESRI.replace("{x}", "1") }],
      ["no {y}", { MTM_BASEMAP_BACKUP_TILE_URL: ESRI.replace("{y}", "1") }],
      ["no address", { MTM_BASEMAP_BACKUP_TILE_URL: "" }],
      // Pasted with a placeholder left in it: Leaflet throws on it while the map is being drawn.
      ["a place Leaflet cannot fill", { MTM_BASEMAP_BACKUP_TILE_URL: `${ESRI}&style={style}` }],
      ["a key that was never put in", { MTM_BASEMAP_BACKUP_TILE_URL: ESRI.replace("browser-key", "{key}") }],
      ["a brace that closes nothing", { MTM_BASEMAP_BACKUP_TILE_URL: `${ESRI}&x={` }],
    ]
    for (const [why, over] of halfSaid) {
      expect(basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: "backup", ...over })), why).toEqual(CARTO_ONLY)
    }
  })

  it("takes an address with the places Leaflet fills in by itself, and with no other", () => {
    for (const address of [
      "https://tiles.example/{z}/{x}/{y}.png",
      "https://{s}.tiles.example/{z}/{x}/{y}{r}.png?key=k",
      "https://tiles.example/tms/{z}/{x}/{-y}.png?also={y}",
    ]) expect(tileUrlTemplate(address), address).toBe(address)
    for (const address of [
      "https://tiles.example/{z}/{x}/{y}.png?key={key}",
      "https://tiles.example/{z}/{x}/{y}.png?t={apikey}",
      "https://tiles.example/{z}/{x}/{y}/{Z}",
      "https://tiles.example/{z}/{x}/{y}}",
      "https://tiles.example/{z}/{x}/{y}/{}",
    ]) expect(tileUrlTemplate(address), address).toBeNull()
  })

  it("credits the provider in words: what the settings say is never markup on the map", () => {
    const tiles = basemapBackupTiles({ url: ESRI, attribution: `<img src=x onerror="alert(1)"> & 'Esri'`, tileSize: 512 })
    expect(tiles.attribution).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Esri&#39;")
    expect(tiles.url).toBe(ESRI)
    expect(tiles.tileSize).toBe(512)
  })
})

describe("what the browser reads back from the document", () => {
  afterEach(() => {
    document.head.querySelectorAll(`meta[name="${BASEMAP_PROVIDER_META}"]`).forEach((tag) => tag.remove())
  })
  const write = (content: string) => {
    const tag = document.createElement("meta")
    tag.setAttribute("name", BASEMAP_PROVIDER_META)
    tag.setAttribute("content", content)
    document.head.appendChild(tag)
  }

  it("reads exactly what the server said", () => {
    const told = basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: "backup", MTM_BASEMAP_BACKUP_TILE_SIZE: "512" }))
    write(serializeBasemapProvider(told)!)
    expect(basemapProviderFromDocument()).toEqual(told)
    expect(told).toEqual({ primary: "backup", backup: { url: ESRI, attribution: CREDIT, tileSize: 512 } })
  })

  it("a page that says nothing is CARTO only", () => {
    expect(basemapProviderFromDocument()).toEqual(CARTO_ONLY)
    expect(basemapProviderFromDocument(null)).toEqual(CARTO_ONLY)
  })

  it("reads the head, where the server writes: a tag of the same name in the body is not the server's", () => {
    const told = basemapProviderFromEnv(said({ MTM_BASEMAP_PRIMARY: "backup" }))
    const stray = document.createElement("meta")
    stray.setAttribute("name", BASEMAP_PROVIDER_META)
    stray.setAttribute("content", serializeBasemapProvider(told)!)
    document.body.appendChild(stray)
    try {
      expect(basemapProviderFromDocument()).toEqual(CARTO_ONLY)
    } finally {
      stray.remove()
    }
  })

  it("checks the document as if a stranger had written it: unreadable or half-said is CARTO only", () => {
    const strange = [
      "", "not json", "null", "[]", "42", '"backup"',
      JSON.stringify({ primary: "backup" }),
      JSON.stringify({ primary: "backup", url: "http://tiles.example/{z}/{x}/{y}.png", attribution: "x" }),
      JSON.stringify({ primary: "backup", url: "javascript:alert(1)//{z}{x}{y}", attribution: "x" }),
      JSON.stringify({ primary: "backup", url: ESRI }),
      JSON.stringify({ primary: "backup", url: ESRI, attribution: CREDIT, tileSize: 300 }),
      JSON.stringify({ primary: "backup", url: 7, attribution: CREDIT }),
    ]
    for (const content of strange) expect(parseBasemapProvider(content), content).toEqual(CARTO_ONLY)
  })
})

describe("what the root layout writes into the page", () => {
  afterEach(() => vi.unstubAllEnvs())

  /** The <meta> tags of the document's head that carry the provider. */
  async function written(): Promise<string[]> {
    const found: string[] = []
    const look = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(look)
      if (!node || typeof node !== "object") return
      const element = node as ReactElement<{ name?: string; content?: string; children?: unknown }>
      if (!element.props) return
      if (element.type === "meta" && element.props.name === BASEMAP_PROVIDER_META) found.push(String(element.props.content))
      look(element.props.children)
    }
    look(await RootLayout({ children: null }))
    return found
  }

  it("writes nothing while the deployment names no backup — the page is what it always was", async () => {
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_URL", "")
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION", "")
    vi.stubEnv("MTM_BASEMAP_PRIMARY", "backup")
    expect(await written()).toEqual([])
  })

  it("writes what the running deployment says now, and the browser reads the same back", async () => {
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_URL", ESRI)
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION", CREDIT)
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_SIZE", "512")
    vi.stubEnv("MTM_BASEMAP_PRIMARY", "")
    const first = await written()
    expect(first).toHaveLength(1)
    expect(parseBasemapProvider(first[0])).toEqual({ primary: "carto", backup: { url: ESRI, attribution: CREDIT, tileSize: 512 } })

    // The operator job changed the environment; the next page says so — no build between the two.
    vi.stubEnv("MTM_BASEMAP_PRIMARY", "backup")
    expect(parseBasemapProvider((await written())[0]).primary).toBe("backup")
  })

  it("reads the settings where the server keeps them, not where a build would freeze them", () => {
    const provider = readFileSync("src/lib/mtm/basemap-provider.ts", "utf8")
    // A NEXT_PUBLIC_ value is put into the bundle at build time: changing it would need a release.
    expect(provider).not.toContain("NEXT_PUBLIC_")
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("serializeBasemapProvider(basemapProviderFromEnv())")
  })
})

describe("what a browser remembers after CARTO refused it", () => {
  beforeEach(() => window.sessionStorage.clear())

  it("keeps to the backup for half an hour, in this tab, and then asks CARTO again", () => {
    const now = Date.UTC(2026, 9, 12, 9, 0)
    expect(basemapFailoverRemembered(now)).toBe(false)
    rememberBasemapFailover(now)
    expect(basemapFailoverRemembered(now + 1)).toBe(true)
    expect(basemapFailoverRemembered(now + BASEMAP_FAILOVER_MEMORY_MS - 1)).toBe(true)
    expect(basemapFailoverRemembered(now + BASEMAP_FAILOVER_MEMORY_MS)).toBe(false)
    expect(BASEMAP_FAILOVER_MEMORY_MS).toBe(30 * 60_000)
  })

  it("forgets when told to — the backup refused as well, and nothing is gained by keeping to it", () => {
    rememberBasemapFailover()
    expect(basemapFailoverRemembered()).toBe(true)
    forgetBasemapFailover()
    expect(basemapFailoverRemembered()).toBe(false)
    expect(window.sessionStorage.length).toBe(0)
  })

  it("a browser that keeps rubbish asks CARTO first; one that will keep nothing is remembered by the page itself", () => {
    window.sessionStorage.setItem("leaddrive.mtm.basemap.failover.v1", "soon")
    expect(basemapFailoverRemembered()).toBe(false)

    // Storage refused: without the page's own memory a map would swing
    // between the two providers at every move.
    const refuse = () => { throw new DOMException("denied", "SecurityError") }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse)
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(refuse)
    try {
      const now = Date.UTC(2026, 9, 12, 9, 0)
      expect(() => rememberBasemapFailover(now)).not.toThrow()
      expect(basemapFailoverRemembered(now + 1)).toBe(true)
      expect(basemapFailoverRemembered(now + BASEMAP_FAILOVER_MEMORY_MS)).toBe(false)
      expect(() => forgetBasemapFailover()).not.toThrow()
      expect(basemapFailoverRemembered(now + 1)).toBe(false)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe("what a page that is already open asks the server", () => {
  const BACKUP = { url: ESRI, attribution: CREDIT, tileSize: 256 as const }
  let asked: string[]
  let answer: () => Response | Promise<Response>

  beforeEach(() => {
    resetBasemapProviderStoreForTests()
    asked = []
    answer = () => Response.json({ success: true, data: { primary: "backup", backup: BACKUP } })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(String(input))
      // No cookie goes with the question: it is the same answer for everybody.
      expect(init).toMatchObject({ cache: "no-store", credentials: "omit" })
      return answer()
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    resetBasemapProviderStoreForTests()
  })

  it("the server answers what the running deployment says now — never a stored answer", async () => {
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_URL", ESRI)
    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION", CREDIT)
    vi.stubEnv("MTM_BASEMAP_PRIMARY", "")
    const first = await askProvider()
    expect(first.headers.get("Cache-Control")).toContain("no-store")
    expect(basemapProviderFromAnswer(await first.json())).toEqual({ primary: "carto", backup: BACKUP })

    vi.stubEnv("MTM_BASEMAP_PRIMARY", "backup")
    expect(basemapProviderFromAnswer(await (await askProvider()).json()).primary).toBe("backup")

    vi.stubEnv("MTM_BASEMAP_BACKUP_TILE_URL", "")
    expect(await (await askProvider()).json()).toEqual({ success: true, data: CARTO_ONLY })
  })

  it("checks the answer as it checks the document: half-said is CARTO only", () => {
    for (const strange of [null, 7, {}, { data: null }, { data: { primary: "backup" } }, { data: { primary: "backup", backup: { url: "http://x/{z}/{x}/{y}", attribution: "x" } } }]) {
      expect(basemapProviderFromAnswer(strange), JSON.stringify(strange)).toEqual(CARTO_ONLY)
    }
  })

  it("a page loaded a moment ago asks nothing — its own tag is that fresh; later it asks, once a minute at most", async () => {
    const loaded = Date.now()
    await refreshBasemapProvider(loaded + 1_000)
    expect(asked).toEqual([])

    const before = basemapProviderSnapshot()
    expect(before).toEqual(CARTO_ONLY)
    const told = vi.fn()
    const stop = subscribeBasemapProvider(told)
    try {
      await refreshBasemapProvider(loaded + BASEMAP_PROVIDER_ASK_AGAIN_MS + 5_000)
      expect(asked).toEqual([BASEMAP_PROVIDER_PATH])
      expect(basemapProviderSnapshot()).toEqual({ primary: "backup", backup: BACKUP })
      expect(told).toHaveBeenCalledTimes(1)

      // Ten maps on ten screens within the minute are one question.
      await refreshBasemapProvider(loaded + BASEMAP_PROVIDER_ASK_AGAIN_MS + 30_000)
      expect(asked).toHaveLength(1)

      // The same answer again changes nothing and wakes nobody: the object the maps hold is the same one.
      const held = basemapProviderSnapshot()
      await refreshBasemapProvider(loaded + 3 * BASEMAP_PROVIDER_ASK_AGAIN_MS)
      expect(asked).toHaveLength(2)
      expect(basemapProviderSnapshot()).toBe(held)
      expect(told).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })

  it("a question that fails changes nothing: the page keeps what it knew", async () => {
    const loaded = Date.now()
    await refreshBasemapProvider(loaded + 2 * BASEMAP_PROVIDER_ASK_AGAIN_MS)
    const known = basemapProviderSnapshot()
    expect(known.primary).toBe("backup")

    for (const [step, failure] of [
      () => new Response("{}", { status: 503 }),
      () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => { throw new TypeError("Failed to fetch") },
    ].entries()) {
      answer = failure
      await expect(refreshBasemapProvider(loaded + (4 + 2 * step) * BASEMAP_PROVIDER_ASK_AGAIN_MS)).resolves.toBeUndefined()
      expect(basemapProviderSnapshot(), String(step)).toBe(known)
    }
  })

  it("asks again every five minutes while a map is on a screen somebody looks at — and not otherwise", async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const stop = subscribeBasemapProvider(() => {})
    try {
      await vi.advanceTimersByTimeAsync(BASEMAP_PROVIDER_REFRESH_MS + 1_000)
      expect(asked).toHaveLength(1)

      // A tab nobody looks at asks nothing.
      visibility.mockReturnValue("hidden")
      await vi.advanceTimersByTimeAsync(2 * BASEMAP_PROVIDER_REFRESH_MS)
      expect(asked).toHaveLength(1)

      visibility.mockReturnValue("visible")
      await vi.advanceTimersByTimeAsync(BASEMAP_PROVIDER_REFRESH_MS)
      expect(asked).toHaveLength(2)
    } finally {
      stop()
    }
    // The last map left the screen: nothing goes on asking.
    await vi.advanceTimersByTimeAsync(3 * BASEMAP_PROVIDER_REFRESH_MS)
    expect(asked).toHaveLength(2)
  })
})

describe("the operator job that changes the provider on the running deployment", () => {
  // What the job DOES is tested by running it: basemap-provider-operator-job.test.ts.
  const job = readFileSync(".github/workflows/set-map-provider.yml", "utf8")

  it("is started by a person, from one place, and never beside a deploy", () => {
    expect(job).toMatch(/^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}primary:/m)
    expect(job).not.toMatch(/^\s+(push|pull_request|pull_request_target|schedule):/m)
    expect(job).toMatch(/concurrency:\n {2}group: production-deploy\n {2}cancel-in-progress: false/)
    expect(job).toContain("runs-on: ubuntu-24.04")
    expect(job).toMatch(/options:\n\s+- keep\n\s+- carto\n\s+- backup\n\s+default: keep/)
    // The choice is the input's, read through the environment — never pasted into the script.
    expect(job).toContain("PRIMARY_CHOICE: ${{ inputs.primary }}")
    expect(job.match(/\$\{\{ inputs\.primary \}\}/g)).toHaveLength(1)
  })

  it("writes exactly the four settings the app reads, and asks the app at the address the pages ask", () => {
    const provider = readFileSync("src/lib/mtm/basemap-provider.ts", "utf8")
    const read = [...provider.matchAll(/env\.(MTM_BASEMAP_[A-Z_]+)/g)].map((match) => match[1]).sort()
    const written = (job.match(/KEYS="([A-Z_ ]+)"/)?.[1] ?? "").split(" ").sort()
    expect(read).toEqual([
      "MTM_BASEMAP_BACKUP_TILE_ATTRIBUTION", "MTM_BASEMAP_BACKUP_TILE_SIZE", "MTM_BASEMAP_BACKUP_TILE_URL", "MTM_BASEMAP_PRIMARY",
    ])
    expect(written).toEqual(read)
    expect(job).toContain(`http://127.0.0.1:3001${BASEMAP_PROVIDER_PATH}`)
  })
})
