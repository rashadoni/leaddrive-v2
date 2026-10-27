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

import { managerCanAnswer } from "@/lib/voice-agent/pharmacy/zeytun-line-host"

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
