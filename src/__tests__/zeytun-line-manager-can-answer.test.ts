/**
 * The AI line offers a transfer to a manager only when one could answer
 * (owner, 2026-10-27: «перевод на менеджера только в рабочее время или когда
 * менеджер в сети»). With nobody there the agent hears "unavailable" and takes
 * the order itself, instead of the pharmacy hearing 30 s of ringing at night.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const org = vi.hoisted(() => ({ modules: {} as Record<string, boolean>, reads: 0 }))

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(async () => { org.reads += 1; return { plan: "enterprise", addons: [], modules: org.modules } }),
}))

import { askWebProcess, managerCanAnswer } from "@/lib/voice-agent/pharmacy/zeytun-line-host"

const ENV = {
  BROWSER_SOFTPHONE_ENABLED: "1",
  BROWSER_SOFTPHONE_TICKET_SECRET: "s".repeat(40),
  SOFTPHONE_RELAY_URL: "wss://relay.example.invalid/park",
  BROWSER_SOFTPHONE_USER_IDS: "",
}
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) { saved[key] = process.env[key]; process.env[key] = value }
  org.modules = { browserSoftphone: true }
  org.reads = 0
})
afterEach(() => {
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe("managerCanAnswer", () => {
  it("is false with nobody in the CRM, without even reading the organisation", async () => {
    expect(await managerCanAnswer("org-zeytun", () => [])).toBe(false)
    expect(org.reads).toBe(0)
  })

  it("is true while someone who may answer in the browser has the CRM open", async () => {
    expect(await managerCanAnswer("org-zeytun", () => ["user-manager"])).toBe(true)
  })

  it("follows the browser softphone switches: the tenant's flag, the pilot list, the kill switch", async () => {
    org.modules = { browserSoftphone: false }
    expect(await managerCanAnswer("org-zeytun", () => ["user-manager"])).toBe(false)

    org.modules = { browserSoftphone: true }
    process.env.BROWSER_SOFTPHONE_USER_IDS = "user-other"
    expect(await managerCanAnswer("org-zeytun", () => ["user-manager"])).toBe(false)
    expect(await managerCanAnswer("org-zeytun", () => ["user-manager", "user-other"])).toBe(true)

    process.env.BROWSER_SOFTPHONE_ENABLED = "0"
    expect(await managerCanAnswer("org-zeytun", () => ["user-other"])).toBe(false)
  })
})

describe("managerCanAnswer in the line's own process", () => {
  // The open tabs live in the web process (their shell-events streams); the
  // line's process asks it on loopback, and any doubt is "nobody".
  const saved = { role: process.env.LEADDRIVE_PROCESS_ROLE, secret: process.env.CRON_SECRET }
  afterEach(() => {
    if (saved.role === undefined) delete process.env.LEADDRIVE_PROCESS_ROLE
    else process.env.LEADDRIVE_PROCESS_ROLE = saved.role
    if (saved.secret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved.secret
    vi.unstubAllGlobals()
  })

  it("asks the web process instead of reading its own empty memory", async () => {
    process.env.LEADDRIVE_PROCESS_ROLE = "line"
    process.env.CRON_SECRET = "cron-secret"
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ canAnswer: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await managerCanAnswer("org-zeytun", () => [])).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:3001/api/cron/zeytun-manager-presence")
    expect((init.headers as Record<string, string>)["x-cron-secret"]).toBe("cron-secret")
    expect(JSON.parse(String(init.body))).toEqual({ organizationId: "org-zeytun" })
    expect(org.reads).toBe(0)
  })

  it("is false when the web process fails, refuses or does not answer in time", async () => {
    process.env.CRON_SECRET = "cron-secret"
    expect(await askWebProcess("org-zeytun", vi.fn(async () => { throw new TypeError("fetch failed") }) as unknown as typeof fetch)).toBe(false)
    expect(await askWebProcess("org-zeytun", vi.fn(async () => new Response("{}", { status: 503 })) as unknown as typeof fetch)).toBe(false)
    const hanging = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason))
    }))
    expect(await askWebProcess("org-zeytun", hanging as unknown as typeof fetch, 20)).toBe(false)
  })

  it("answers from its own memory on the web process, which the presence route asks", async () => {
    process.env.LEADDRIVE_PROCESS_ROLE = "line"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await managerCanAnswer("org-zeytun", () => ["user-manager"], "local")).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
