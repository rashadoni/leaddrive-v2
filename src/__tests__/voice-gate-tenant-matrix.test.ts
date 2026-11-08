/**
 * Who gets the voice assistant, over every combination that decides it:
 * tenant module record × role × the «Голос» switch × the host provider.
 *
 * Unlike voice-gate-budget.test.ts, `hasModule` is the real one here: the
 * Biznesdoktor case (2026-11-06) was a module record — Settings saved off —
 * and a gate checked against a mocked `hasModule` cannot see what a record
 * like that does. Only the database read (the switch, the org's modules) is
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findFirst: vi.fn() } },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => ({ getOrgModuleContext: vi.fn() }))

import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { prisma } from "@/lib/prisma"
import { getOrgModuleContext } from "@/lib/api-auth"

const BIZNESDOKTOR = {
  ai: true, crm: true, mtm: false, voip: true, media: false, sales: true,
  energy: false, health: false, social: true, finance: false, loyalty: false,
  support: true, settings: false, analytics: false, contracts: true,
  insurance: false, marketing: true, omnichannel: true, "public-sector": false,
}

const TENANTS: { label: string; plan: string; modules: Record<string, boolean>; ai: boolean }[] = [
  { label: "Biznesdoktor as on prod (Settings off, AI on)", plan: "starter", modules: BIZNESDOKTOR, ai: true },
  { label: "Biznesdoktor with AI switched off", plan: "starter", modules: { ...BIZNESDOKTOR, ai: false }, ai: false },
  { label: "only AI on, everything else saved off", plan: "starter", modules: { crm: false, settings: false, ai: true }, ai: true },
  { label: "every module on", plan: "enterprise", modules: { ...Object.fromEntries(Object.keys(BIZNESDOKTOR).map((k) => [k, true])) }, ai: true },
  { label: "empty record (Clear All)", plan: "starter", modules: {}, ai: false },
]

const ROLES = ["superadmin", "admin", "manager", "sales", "support", "ticketing", "viewer", "reviewer", "member"]
const ELIGIBLE = new Set(["superadmin", "admin", "manager"])

const ENV = ["VOICE_REALTIME_PROVIDER", "GEMINI_API_KEY", "VOICE_PILOT_ORG_ID", "VOICE_PILOT_USER_IDS"] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ENV) saved[k] = process.env[k]
  delete process.env.VOICE_PILOT_ORG_ID
  delete process.env.VOICE_PILOT_USER_IDS
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function expected(role: string, switchOn: boolean, ai: boolean, provider: "ok" | "off" | "nokey") {
  if (!ELIGIBLE.has(role)) return "voice_pilot_role_denied"
  if (!switchOn) return "voice_not_granted"
  if (!ai) return "module_ai_not_enabled"
  if (provider === "off") return "voice_provider_not_gemini_live"
  if (provider === "nokey") return "voice_provider_not_configured"
  return "ok"
}

describe.each(TENANTS)("tenant: $label", (tenant) => {
  it.each(["ok", "off", "nokey"] as const)("provider %s — every role, switch on and off", async (provider) => {
    process.env.VOICE_REALTIME_PROVIDER = provider === "off" ? "none" : "gemini_live"
    if (provider === "nokey") delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = "key_x"
    vi.mocked(getOrgModuleContext).mockResolvedValue({ plan: tenant.plan, addons: [], modules: tenant.modules })

    for (const role of ROLES) for (const switchOn of [true, false]) {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: switchOn } as never)
      const gate = await checkVoicePilotAccess({ orgId: "org-bd", userId: "u-1", role })
      const got = gate.ok ? "ok" : gate.reason
      expect([role, switchOn, got]).toEqual([role, switchOn, expected(role, switchOn, tenant.ai, provider)])
    }
  })
})

describe("the switch is read in the session's own organisation, inside its tenant scope", () => {
  it("asks for this user in this organisation", async () => {
    process.env.VOICE_REALTIME_PROVIDER = "gemini_live"
    process.env.GEMINI_API_KEY = "key_x"
    vi.mocked(getOrgModuleContext).mockResolvedValue({ plan: "starter", addons: [], modules: BIZNESDOKTOR })
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: true } as never)
    await expect(checkVoicePilotAccess({ orgId: "org-bd", userId: "u-1", role: "admin" })).resolves.toEqual({ ok: true })
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u-1", organizationId: "org-bd" },
      select: { voiceEnabled: true },
    })
  })

  it("a failed read denies — never «allowed because we could not check»", async () => {
    process.env.VOICE_REALTIME_PROVIDER = "gemini_live"
    process.env.GEMINI_API_KEY = "key_x"
    vi.mocked(prisma.user.findFirst).mockRejectedValue(new Error("db down"))
    await expect(checkVoicePilotAccess({ orgId: "org-bd", userId: "u-1", role: "admin" }))
      .resolves.toEqual({ ok: false, reason: "voice_grant_check_failed" })
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: true } as never)
    vi.mocked(getOrgModuleContext).mockRejectedValue(new Error("db down"))
    await expect(checkVoicePilotAccess({ orgId: "org-bd", userId: "u-1", role: "admin" }))
      .resolves.toEqual({ ok: false, reason: "module_check_failed" })
  })
})
