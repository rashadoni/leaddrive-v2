import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Multi-tenant SMS provider resolution guard (lib/sms.ts resolveProvider).
 *
 * Each tenant must send customer-facing SMS through its OWN provider config
 * (ChannelConfig(sms)). The shared env account (Tier 4) is reserved for the
 * LeadDrive instance org (SMS_ENV_FALLBACK_ORG_ID) and OTP/system flows
 * (allowEnvFallback) — a tenant without its own config FAILS CLOSED rather than
 * silently sending from the shared ATL account.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: { findFirst: vi.fn().mockResolvedValue(null) } },
}))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

import { prisma } from "@/lib/prisma"
import { sendSms } from "@/lib/sms"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>
const ATL_OK = {
  ok: true,
  status: 200,
  text: async () => `<?xml version="1.0" encoding="UTF-8"?><response><head><responsecode>000</responsecode></head><body><taskid>1</taskid></body></response>`,
  json: async () => ({}),
}

beforeEach(() => {
  vi.clearAllMocks()
  fn(prisma.channelConfig.findFirst).mockResolvedValue(null)
  fetchMock.mockResolvedValue(ATL_OK)
  // env = the shared LeadDrive-instance ATL account
  process.env.SMS_PROVIDER = "atl"
  process.env.ATL_LOGIN = "shared-login"
  process.env.ATL_PASSWORD = "shared-pw"
  process.env.ATL_TITLE = "LeadDrive"
  process.env.SMS_ENV_FALLBACK_ORG_ID = "leaddrive-main"
})
afterEach(() => {
  delete process.env.SMS_ENV_FALLBACK_ORG_ID
})

describe("sendSms — multi-tenant provider guard", () => {
  it("tenant with NO per-org config + customer-facing → FAILS CLOSED, never touches the shared account", async () => {
    const r = await sendSms({ to: "+994501112233", message: "hi", organizationId: "tenant-x" })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not configured for this organization/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("OTP/system flow (allowEnvFallback) → may use the shared env account so SMS-login never breaks", async () => {
    const r = await sendSms({ to: "+994501112233", message: "code 123", organizationId: "tenant-x", allowEnvFallback: true })
    expect(r.success).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it("the env-designated org (SMS_ENV_FALLBACK_ORG_ID) → may use the shared env account", async () => {
    const r = await sendSms({ to: "+994501112233", message: "hi", organizationId: "leaddrive-main" })
    expect(r.success).toBe(true)
  })

  it("no orgId (system) → uses the shared env account", async () => {
    const r = await sendSms({ to: "+994501112233", message: "hi" })
    expect(r.success).toBe(true)
  })

  it("tenant WITH its own ATL config → sends via its OWN account (Tier 1), not the shared", async () => {
    fn(prisma.channelConfig.findFirst).mockImplementation((args: { where?: { channelType?: string } }) =>
      Promise.resolve(
        args?.where?.channelType === "sms"
          ? { settings: { smsProvider: "atl", atlLogin: "tenant-login", atlTitle: "TenantBrand" }, apiKey: "tenant-pw", phoneNumber: null }
          : null,
      ),
    )
    const r = await sendSms({ to: "+994501112233", message: "hi", organizationId: "tenant-x" })
    expect(r.success).toBe(true)
    const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? "")
    expect(body).toContain("tenant-login")
    expect(body).not.toContain("shared-login")
  })

  it("guard INACTIVE until SMS_ENV_FALLBACK_ORG_ID is set → preserves shared fallback (safe rollout, no deploy breakage)", async () => {
    delete process.env.SMS_ENV_FALLBACK_ORG_ID
    const r = await sendSms({ to: "+994501112233", message: "hi", organizationId: "tenant-x" })
    expect(r.success).toBe(true) // backward-compat shared env until the env-org is designated
    expect(fetchMock).toHaveBeenCalled()
  })

  // The Tier-1/3 bypass the adversarial review found: a tenant ROW that NAMES an env-backed
  // provider but supplies NO secret would previously let the provider read process.env.ATL_*
  // (the shared account), because Tier 1 returns before the null-guard. allowEnv=false closes it.
  it("LEAK GUARD: tenant row names a provider but has NO secret → still fails closed (no env bypass via Tier 1)", async () => {
    fn(prisma.channelConfig.findFirst).mockImplementation((args: { where?: { channelType?: string } }) =>
      Promise.resolve(
        args?.where?.channelType === "sms"
          ? { settings: { smsProvider: "atl" }, apiKey: null, phoneNumber: null }
          : null,
      ),
    )
    const r = await sendSms({ to: "+994501112233", message: "hi", organizationId: "tenant-x" })
    expect(r.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled() // must NOT send via the shared env account
  })

  it("env-org with a secretless named-provider row → may still use env (the LeadDrive instance is allowed)", async () => {
    fn(prisma.channelConfig.findFirst).mockImplementation((args: { where?: { channelType?: string } }) =>
      Promise.resolve(
        args?.where?.channelType === "sms"
          ? { settings: { smsProvider: "atl" }, apiKey: null, phoneNumber: null }
          : null,
      ),
    )
    const r = await sendSms({ to: "+994501112233", message: "hi", organizationId: "leaddrive-main" })
    expect(r.success).toBe(true)
  })
})
