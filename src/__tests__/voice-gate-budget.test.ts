/**
 * Voice pilot gate + minute budget.
 *
 * The gate is the only thing standing between "a signed-in admin" and a paid
 * third-party voice session that reads CRM data, so its failure modes are
 * pinned individually rather than through one happy-path test. The budget is
 * pinned on the property that actually matters: the claim is atomic, so two
 * concurrent starts cannot both pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceMonthlyUsage: { upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(),
}))

vi.mock("@/lib/modules", () => ({
  hasModule: vi.fn(),
}))

import { checkVoicePilotAccess } from "@/lib/ai/voice/gate"
import { voiceScopedWhere } from "@/lib/ai/voice/scoped-where"
import { reserveVoiceSeconds, settleVoiceSeconds } from "@/lib/ai/voice/budget"
import { prisma } from "@/lib/prisma"
import { getOrgModuleContext } from "@/lib/api-auth"
import { hasModule } from "@/lib/modules"

const ADMIN = { orgId: "org-pilot", userId: "user-1", role: "admin" }
const ENV_KEYS = [
  "VOICE_PILOT_ORG_ID",
  "VOICE_PILOT_USER_IDS",
  "VOICE_REALTIME_PROVIDER",
  "GEMINI_API_KEY",
  "VOICE_MONTHLY_MINUTES",
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  // Set to a DIFFERENT organisation on purpose: the old env allowlist must
  // no longer decide anything (see "ignores the retired env allowlist").
  process.env.VOICE_PILOT_ORG_ID = "org-somewhere-else"
  process.env.VOICE_PILOT_USER_IDS = "user-9"
  process.env.VOICE_REALTIME_PROVIDER = "gemini_live"
  process.env.GEMINI_API_KEY = "key_x"
  vi.mocked(getOrgModuleContext).mockResolvedValue({ plan: "creator", addons: [], modules: {} } as any)
  vi.mocked(hasModule).mockReturnValue(true)
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: true } as any)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("checkVoicePilotAccess", () => {
  // Owner, 2026-10-26: the «Голос» switch in Settings → Users is the grant.
  // Zeytun Pharma's admin had it ticked and no microphone, because an env list
  // named another organisation.
  it("allows an admin whose switch is on, in any organisation", async () => {
    await expect(checkVoicePilotAccess(ADMIN)).resolves.toEqual({ ok: true })
    await expect(checkVoicePilotAccess({ ...ADMIN, orgId: "org-zeytun" })).resolves.toEqual({ ok: true })
  })

  it("ignores the retired env allowlist, set or unset", async () => {
    delete process.env.VOICE_PILOT_ORG_ID
    delete process.env.VOICE_PILOT_USER_IDS
    await expect(checkVoicePilotAccess(ADMIN)).resolves.toEqual({ ok: true })
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: false } as any)
    process.env.VOICE_PILOT_ORG_ID = ADMIN.orgId
    process.env.VOICE_PILOT_USER_IDS = ADMIN.userId
    await expect(checkVoicePilotAccess(ADMIN)).resolves.toEqual({ ok: false, reason: "voice_not_granted" })
  })

  // The switch is read in the organisation the session acts in, scoped to it.
  it("looks the switch up for this user inside this organisation", async () => {
    await checkVoicePilotAccess(ADMIN)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: ADMIN.userId, organizationId: ADMIN.orgId },
      select: { voiceEnabled: true },
    })
  })

  it("denies a non-eligible role even when ticked", async () => {
    const r = await checkVoicePilotAccess({ ...ADMIN, userId: "viewer-1", role: "viewer" })
    expect(r).toEqual({ ok: false, reason: "voice_pilot_role_denied" })
  })

  // The per-user grant is the thing an admin ticks. Eligible role + enrolled
  // org is NOT enough on its own.
  it("denies an eligible user whose box is not ticked", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: false } as any)
    const r = await checkVoicePilotAccess(ADMIN)
    expect(r).toEqual({ ok: false, reason: "voice_not_granted" })
  })

  it("allows a manager whose box is ticked", async () => {
    const r = await checkVoicePilotAccess({ ...ADMIN, userId: "mgr-1", role: "manager" })
    expect(r).toEqual({ ok: true })
  })

  // A failed read must deny: this gate guards a paid third-party session over
  // the organisation's data.
  it("denies when the grant lookup throws", async () => {
    vi.mocked(prisma.user.findFirst).mockRejectedValue(new Error("db down"))
    const r = await checkVoicePilotAccess(ADMIN)
    expect(r).toEqual({ ok: false, reason: "voice_grant_check_failed" })
  })

  // Superadmin follows the same switch. Inside another tenant they have no
  // row, so their session — which can name any organisation — gets no voice
  // there; this used to be the env org gate's job.
  it("requires the switch for superadmin too", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: false } as any)
    await expect(checkVoicePilotAccess({ ...ADMIN, role: "superadmin" })).resolves.toEqual({ ok: false, reason: "voice_not_granted" })
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    await expect(checkVoicePilotAccess({ ...ADMIN, orgId: "org-other", role: "superadmin" })).resolves.toEqual({ ok: false, reason: "voice_not_granted" })
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ voiceEnabled: true } as any)
    await expect(checkVoicePilotAccess({ ...ADMIN, role: "superadmin" })).resolves.toEqual({ ok: true })
  })

  it("denies when the ai module is off", async () => {
    vi.mocked(hasModule).mockReturnValue(false)
    const r = await checkVoicePilotAccess(ADMIN)
    expect(r).toEqual({ ok: false, reason: "module_ai_not_enabled" })
  })

  // The module lookup is fail-open elsewhere in this codebase; here a thrown
  // read must deny, not grant.
  it("denies when the module lookup throws", async () => {
    vi.mocked(getOrgModuleContext).mockRejectedValue(new Error("db down"))
    const r = await checkVoicePilotAccess(ADMIN)
    expect(r).toEqual({ ok: false, reason: "module_check_failed" })
  })

  it("denies when the provider is not configured", async () => {
    delete process.env.GEMINI_API_KEY
    const r = await checkVoicePilotAccess(ADMIN)
    expect(r).toEqual({ ok: false, reason: "voice_provider_not_configured" })
  })

  it.each([undefined, "openai_realtime", "gemini"])(
    "denies unless the realtime provider is exactly gemini_live (%s)",
    async (provider) => {
      if (provider === undefined) delete process.env.VOICE_REALTIME_PROVIDER
      else process.env.VOICE_REALTIME_PROVIDER = provider
      const r = await checkVoicePilotAccess(ADMIN)
      expect(r).toEqual({ ok: false, reason: "voice_provider_not_gemini_live" })
    },
  )
})

describe("voiceScopedWhere", () => {
  it("adds the tenant key", () => {
    expect(voiceScopedWhere("org-1", { status: "active" })).toEqual({
      status: "active",
      organizationId: "org-1",
    })
  })

  // The whole point: a caller-supplied filter must not be able to choose the
  // tenant, even by naming the key directly.
  it("cannot be overridden by the caller's filter", () => {
    const w = voiceScopedWhere("org-1", { organizationId: "org-evil" } as Record<string, unknown>)
    expect(w.organizationId).toBe("org-1")
  })

  it("refuses an empty organizationId instead of matching nothing", () => {
    expect(() => voiceScopedWhere("")).toThrow()
  })
})

describe("voice minute budget", () => {
  beforeEach(() => {
    process.env.VOICE_MONTHLY_MINUTES = "10" // 600 seconds
    vi.mocked(prisma.voiceMonthlyUsage.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.voiceMonthlyUsage.findFirst).mockResolvedValue({ reservedSeconds: 300 } as any)
  })

  it("claims the reservation with the ceiling in the UPDATE, not a prior read", async () => {
    vi.mocked(prisma.voiceMonthlyUsage.updateMany).mockResolvedValue({ count: 1 } as any)

    const r = await reserveVoiceSeconds("org-1", "user-1", 300, new Date("2026-08-07T10:00:00Z"))
    expect(r.ok).toBe(true)

    // Guard in the WHERE is what makes two concurrent starts safe; a
    // read-then-write would let both through.
    const call = vi.mocked(prisma.voiceMonthlyUsage.updateMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.userId).toBe("user-1")
    expect(call.where.reservedSeconds).toBeDefined()
    expect(call.data.reservedSeconds.increment).toBe(300)
  })

  it("refuses when the month's budget cannot cover another session", async () => {
    vi.mocked(prisma.voiceMonthlyUsage.updateMany).mockResolvedValue({ count: 0 } as any)

    const r = await reserveVoiceSeconds("org-1", "user-1", 300, new Date("2026-08-07T10:00:00Z"))
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ reason: "budget_exhausted" })
  })

  it("refunds only the unused remainder on settle", async () => {
    vi.mocked(prisma.voiceMonthlyUsage.updateMany).mockResolvedValue({ count: 1 } as any)

    await settleVoiceSeconds("org-1", "user-1", 300, 120, new Date("2026-08-07T10:00:00Z"))

    const call = vi.mocked(prisma.voiceMonthlyUsage.updateMany).mock.calls.at(-1)![0] as any
    expect(call.data.reservedSeconds.decrement).toBe(180)
    expect(call.data.settledSeconds.increment).toBe(120)
  })

  // An abandoned session is settled at its full reservation; refunding it
  // would make the budget evadable by simply closing the tab.
  it("refunds nothing when the whole reservation was consumed", async () => {
    vi.mocked(prisma.voiceMonthlyUsage.updateMany).mockResolvedValue({ count: 1 } as any)

    await settleVoiceSeconds("org-1", "user-1", 300, 300, new Date("2026-08-07T10:00:00Z"))

    const call = vi.mocked(prisma.voiceMonthlyUsage.updateMany).mock.calls.at(-1)![0] as any
    expect(call.data.reservedSeconds.decrement).toBe(0)
  })
})

/**
 * Empty-string env regression.
 *
 * Found in production: the secret-delivery workflow exports every variable into
 * the remote shell — including ones whose GitHub secret was never set — and
 * `pm2 restart --update-env` injects them as EMPTY STRINGS. `??` does not catch
 * "", and `Number("")` is 0 rather than NaN, so the monthly budget silently
 * became zero and every session was refused as "minutes exhausted" on a
 * completely unused budget. The zero propagated without a single error log.
 */
describe("voice config: empty env values", () => {
  const KEYS = ["VOICE_MONTHLY_MINUTES", "VOICE_MAX_SESSION_SECONDS", "VOICE_MAX_TOOL_CALLS"] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k]
    vi.resetModules()
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.resetModules()
  })

  it("falls back to defaults when the value is an empty string", async () => {
    process.env.VOICE_MONTHLY_MINUTES = ""
    process.env.VOICE_MAX_SESSION_SECONDS = ""
    process.env.VOICE_MAX_TOOL_CALLS = ""

    const cfg = await import("@/lib/ai/voice/config")
    expect(cfg.MONTHLY_BUDGET_SECONDS).toBe(120 * 60)
    expect(cfg.MAX_SESSION_SECONDS).toBe(300)
    expect(cfg.MAX_TOOL_CALLS).toBe(40)
  })

  it("falls back on whitespace, non-numeric and non-positive values", async () => {
    process.env.VOICE_MONTHLY_MINUTES = "   "
    process.env.VOICE_MAX_SESSION_SECONDS = "abc"
    process.env.VOICE_MAX_TOOL_CALLS = "0"

    const cfg = await import("@/lib/ai/voice/config")
    expect(cfg.MONTHLY_BUDGET_SECONDS).toBe(120 * 60)
    expect(cfg.MAX_SESSION_SECONDS).toBe(300)
    expect(cfg.MAX_TOOL_CALLS).toBe(40)
  })

  it("still honours a real value", async () => {
    process.env.VOICE_MONTHLY_MINUTES = "275"
    const cfg = await import("@/lib/ai/voice/config")
    expect(cfg.MONTHLY_BUDGET_SECONDS).toBe(275 * 60)
  })
})
