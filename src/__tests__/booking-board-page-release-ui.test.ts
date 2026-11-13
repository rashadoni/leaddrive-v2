// @vitest-environment jsdom
/**
 * The wall screen keeps itself current.
 *
 * A monitor in a salon is opened once and left for months. Until now that tab
 * ran the page it was opened with for ever: the 2026-11-13 redesign reached the
 * server and not the wall until somebody walked to the monitor and reloaded it.
 * So the screen asks which release the server runs and loads itself again when
 * that is not its own — once per release, because a wall that blinks every five
 * minutes is worse than a wall one release behind.
 *
 * Proven on the real page with real timers of its own: what is stood in for is
 * the network and the reload itself.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const MINE = "a".repeat(40)
const NEWER = "b".repeat(40)
const reload = vi.hoisted(() => ({ calls: 0 }))
const build = vi.hoisted(() => ({ sha: "a".repeat(40) }))

vi.mock("next/navigation", () => ({ useParams: () => ({ token: "t".repeat(32) }) }))
vi.mock("@/lib/fonts/dashboard-font", () => ({ dashboardFont: { variable: "font-var" } }))
vi.mock("@/lib/booking/board-reload", () => ({ reloadBoardPage: () => { reload.calls += 1 } }))
vi.mock("@/generated/build-sha", () => ({ get DEPLOY_SHA() { return build.sha }, BUILT_AT: "" }))

const BOARD = { title: "ZAL1", day: "2026-11-13", timezone: "Asia/Baku", columns: 2, from: 480, to: 1260, hosts: [] }
let served: unknown
let asked: string[]
let root: Root
let container: HTMLElement

async function mount() {
  const { default: BoardPage } = await import("@/app/board/[token]/page")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(BoardPage)) })
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
}
const minutes = async (count: number) => { for (let step = 0; step < count; step++) await act(async () => { await vi.advanceTimersByTimeAsync(60_000) }) }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  reload.calls = 0
  build.sha = MINE
  served = { artifactSha: MINE }
  asked = []
  window.sessionStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(url)
    if (url.startsWith("/api/v1/public/build-info")) return { ok: true, status: 200, json: async () => served }
    return { ok: true, status: 200, json: async () => ({ success: true, data: BOARD }) }
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("a wall screen left open across a release", () => {
  it("stays as it is while the server runs its own release", async () => {
    await mount()
    await minutes(16)

    expect(asked.filter((url) => url.includes("build-info")).length).toBeGreaterThanOrEqual(3)
    expect(reload.calls).toBe(0)
    expect(container.textContent).toContain("ZAL1")
  })

  it("loads itself again once the server runs a newer release — and only once for it", async () => {
    await mount()
    await minutes(6)
    expect(reload.calls).toBe(0)

    served = { artifactSha: NEWER }
    await minutes(6)
    expect(reload.calls).toBe(1)

    // The reload did not help (a cached page, say): the wall does not blink again for the same release.
    await minutes(16)
    expect(reload.calls).toBe(1)
  })

  it("does not reload on an answer that is not a release, or while the server is down", async () => {
    await mount()
    served = { error: "Bad gateway" }
    await minutes(6)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    await minutes(6)

    expect(reload.calls).toBe(0)
  })

  it("a local build, with no release compiled in, never asks", async () => {
    build.sha = ""
    await mount()
    await minutes(11)

    expect(asked.some((url) => url.includes("build-info"))).toBe(false)
    expect(reload.calls).toBe(0)
  })
})
