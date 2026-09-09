import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The monthly voice ceiling, set from the settings screen instead of from an
 * environment variable nobody in the organisation can see.
 *
 * The state that matters most here is the empty one. "Not set" means "use the
 * deployment default" and is a different thing from "zero minutes"; storing a
 * 0 would silently take voice away from the whole organisation, and clearing
 * the box has to be a way back rather than a way to do that.
 */

const findUnique = vi.fn(async () => ({ settings: {} as Record<string, unknown> }))
const update = vi.fn(async () => ({}))
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique, update } },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: Function) => handler,
  withRlsAuth: (_m: string, _a: string, handler: Function) =>
    (req: unknown) => handler(req, { orgId: "org_1", userId: "u_1", role: "admin" }, {}),
}))

const body = (minutes: unknown) => ({ json: async () => ({ minutes }) })

describe("monthly voice ceiling", () => {
  beforeEach(() => {
    findUnique.mockClear(); update.mockClear()
    findUnique.mockResolvedValue({ settings: {} })
  })

  it("stores a whole number of minutes", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/voice-budget/route")
    const res = await PATCH(body(600) as never)
    expect(res.status).toBe(200)
    expect(update.mock.calls[0][0].data.settings.voiceMonthlyMinutes).toBe(600)
  })

  it("rejects nonsense instead of coercing it", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/voice-budget/route")
    for (const bad of [0, -5, 1.5, "many", 999_999]) {
      const res = await PATCH(body(bad) as never)
      expect(res.status, `${JSON.stringify(bad)} must be rejected`).toBe(400)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it("clearing the field removes the key rather than storing zero", async () => {
    findUnique.mockResolvedValue({ settings: { voiceMonthlyMinutes: 600, other: "kept" } })
    const { PATCH } = await import("@/app/api/v1/settings/voice-budget/route")
    const res = await PATCH(body(null) as never)
    expect(res.status).toBe(200)
    const settings = update.mock.calls[0][0].data.settings
    expect(settings).not.toHaveProperty("voiceMonthlyMinutes")
    // Everything else in the settings blob survives the write.
    expect(settings.other).toBe("kept")
    expect((await res.json()).data.minutes).toBeNull()
  })

  it("reports not-set as null, not as the default", async () => {
    // The UI shows the default as a placeholder; claiming the organisation
    // chose it would make a later change to the default invisible here.
    const { GET } = await import("@/app/api/v1/settings/voice-budget/route")
    const json = await (await GET({} as never)).json()
    expect(json.data.minutes).toBeNull()
    expect(json.data.default).toBeGreaterThan(0)
  })

  it("is gated on settings:write, not on merely being signed in", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("src/app/api/v1/settings/voice-budget/route.ts", "utf8"))
    expect(source).toContain('withRlsAuth("settings", "write"')
    // The neighbouring ai-budget route uses bare withRls for a spending limit.
    // This one must not copy that.
    expect(source).not.toMatch(/export const PATCH = withRls\(/)
  })
})
