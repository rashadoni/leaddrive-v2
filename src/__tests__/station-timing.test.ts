/**
 * One stdout line per question the phone station asks the CRM (owner,
 * 2026-10-28: a call dropped after the first ring because "ringing" took 1–4 s,
 * and only the station's journal said so).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { queuedSince, withStationTiming } from "@/lib/station-timing"

let written: string[] = []
beforeEach(() => {
  written = []
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { written.push(String(chunk)); return true }) as typeof process.stdout.write)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.LEADDRIVE_PROCESS_ROLE
})

const logged = () => written.map((line) => JSON.parse(line))

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://crm.example/api/internal/x", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  })
}

describe("withStationTiming", () => {
  it("logs the route, the step, the status and which process answered", async () => {
    process.env.LEADDRIVE_PROCESS_ROLE = "line"
    const handler = withStationTiming("pharmacy-inbound", async (request: Request) => {
      // The handler still reads the whole body itself.
      expect(await request.json()).toEqual({ action: "lookup", callId: "c1", query: "Adefa" })
      return new Response("{}", { status: 200 })
    })
    const response = await handler(post({ action: "lookup", callId: "c1", query: "Adefa" }))
    expect(response.status).toBe(200)
    const [line] = logged()
    expect(line).toMatchObject({ evt: "station_timing", route: "pharmacy-inbound", step: "lookup", status: 200, proc: "line" })
    expect(typeof line.ms).toBe("number")
    expect(line).not.toHaveProperty("queuedMs")
  })

  it("takes a call lifecycle's state as its step and nothing else from the body", async () => {
    const handler = withStationTiming("call-lifecycle", async () => new Response(null, { status: 202 }))
    await handler(post({ state: "ringing", callId: "c1", fromNumber: "+994501234567", toNumber: "+994995111103" }))
    const text = written.join("")
    expect(logged()[0]).toMatchObject({ route: "call-lifecycle", step: "ringing", status: 202, proc: "web" })
    expect(text).not.toContain("994501234567")
    expect(text).not.toContain("c1")
  })

  it("reports how long nginx held the request before the handler ran", async () => {
    const handler = withStationTiming("call-lifecycle", async () => new Response(null, { status: 200 }))
    const sent = (Date.now() - 1500) / 1000
    await handler(post({ state: "answered" }, { "x-request-start": `t=${sent.toFixed(3)}` }))
    expect(logged()[0].queuedMs).toBeGreaterThanOrEqual(1400)
    expect(logged()[0].queuedMs).toBeLessThan(5000)
  })

  it("logs a thrown handler as 500 and rethrows", async () => {
    const handler = withStationTiming("call-result", async () => { throw new Error("boom") })
    await expect(handler(post({}))).rejects.toThrow("boom")
    expect(logged()[0]).toMatchObject({ route: "call-result", status: 500 })
  })

  it("ignores a step that is not a short word", async () => {
    const handler = withStationTiming("inbound-handoff", async () => new Response(null))
    await handler(post({ action: "+994501234567" }))
    expect(logged()[0]).not.toHaveProperty("step")
  })
})

describe("queuedSince", () => {
  it("reads nginx's ${msec} and refuses nonsense", () => {
    expect(queuedSince("t=1000.250", 1_000_500)).toBe(250)
    expect(queuedSince(null)).toBeUndefined()
    expect(queuedSince("t=abc")).toBeUndefined()
    expect(queuedSince("t=2000.000", 1_000_000)).toBeUndefined()
  })
})

describe("every route the station calls is timed", () => {
  it.each([
    "asterisk/call-lifecycle", "asterisk/inbound-browser-ready", "asterisk/inbound-handoff",
    "voice-agent/pharmacy-inbound", "voice-agent/runtime-config", "voice-agent/call-result",
    "voice-agent/call-source", "voice-agent/call-continuation",
  ])("%s", (route) => {
    const source = readFileSync(join(process.cwd(), "src/app/api/internal", route, "route.ts"), "utf8")
    expect(source).toMatch(new RegExp(`export const (GET|POST) = withStationTiming\\("${route.split("/")[1]}", `))
  })
})
