/**
 * «Настройки → ИИ и расходы»: which key is for what (owner, 2026-11-10: «как
 * клиент поймёт, какой ключ для чего… да делай, если уверен, что какой за что
 * отвечает»). Each provider names the parts of the CRM that call it, in the
 * menu's own words, only those the organization has, with its 30-day spend.
 */
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  modules: {} as Record<string, boolean>,
  features: [] as string[],
  spend: [] as Array<{ provider: string; _sum: { costUsd: number }; _count: { _all: number } }>,
  since: null as Date | null,
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: async () => ({ plan: "enterprise", addons: [], modules: db.modules }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: async () => ({ features: db.features }) },
    aiUsage: { groupBy: async (args: { where: { createdAt: { gte: Date } } }) => { db.since = args.where.createdAt.gte; return db.spend } },
  },
}))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn() }))

import { AI_USES, PROVIDER_KEY_SOURCE, PROVIDER_USES, SELF_KEY_PROVIDERS } from "@/lib/ai/gateway/features"
import { providerUses } from "@/lib/ai/gateway/provider-uses"

beforeEach(() => {
  db.modules = {}
  db.features = []
  db.spend = []
})

describe("which AI key is for what", () => {
  it("names every use by a label the menu has, in all three languages", () => {
    for (const lang of ["ru", "az", "en"]) {
      const nav = JSON.parse(readFileSync(`messages/${lang}.json`, "utf8")).nav
      for (const [id, use] of Object.entries(AI_USES)) {
        const label = "nav" in use.label ? nav[use.label.nav] : nav.groups[use.label.group]
        expect(typeof label, `${lang}: ${id}`).toBe("string")
      }
    }
  })

  it("gives every provider a client can key its uses and where to get the key", () => {
    for (const provider of SELF_KEY_PROVIDERS) {
      expect(PROVIDER_USES[provider].length).toBeGreaterThan(0)
      expect(PROVIDER_KEY_SOURCE[provider].url).toMatch(/^https:\/\//)
      expect(PROVIDER_KEY_SOURCE[provider].prefix).not.toBe("")
    }
  })

  it("shows an organization only the uses it has, the phone line only with its feature, and 30 days of spend", async () => {
    db.modules = { ai: true, omnichannel: true, sales: true, support: false, social: false, contracts: false, voip: false, analytics: false, finance: false }
    db.spend = [{ provider: "gemini", _sum: { costUsd: 0.1157 }, _count: { _all: 9 } }]
    const now = new Date("2026-11-10T12:00:00Z")
    const byProvider = Object.fromEntries((await providerUses("org-1", now)).map((p) => [p.provider, p]))

    expect(byProvider.anthropic.uses).toEqual(["davinci", "inbox", "sales"])
    // No phone-order feature: only the voice assistant calls Gemini here.
    expect(byProvider.gemini).toEqual({ provider: "gemini", uses: ["voice"], costUsd: 0.1157, calls: 9 })
    expect(byProvider.openai.uses).toEqual(["inbox"])
    expect(byProvider.voyage.uses).toEqual(["inbox"])
    // Nothing of social monitoring: Google Vision is not used by this organization.
    expect(byProvider.google_vision).toEqual({ provider: "google_vision", uses: [], costUsd: 0, calls: 0 })
    expect(db.since).toEqual(new Date("2026-10-11T12:00:00Z"))

    db.features = ["pharmacy_phone_orders"]
    const withLine = Object.fromEntries((await providerUses("org-1", now)).map((p) => [p.provider, p]))
    expect(withLine.gemini.uses).toEqual(["voice", "phoneOrders"])
  })
})
