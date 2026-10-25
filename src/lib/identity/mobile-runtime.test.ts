import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { IdentityMobileApplication, IdentityMobileState } from "./mobile-session-contract"
import { issueIdentityMobileSession } from "./mobile-session"
import type { RegistryClient } from "./registry"
const mocks = vi.hoisted(() => ({ state: vi.fn(), snapshot: vi.fn(), card: vi.fn(), company: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("./mobile-session-resolver", () => ({ readIdentityMobileState: mocks.state, withIdentityMobileReadSnapshot: mocks.snapshot }))
import { resolveIdentityMobileRuntime, readIdentityMobileRuntimeClaims } from "./mobile-runtime"
const now = new Date("2026-10-25T01:00:00Z")
const key = { purpose: "IDENTITY_MOBILE_SESSION" as const, id: "fixture", material: Buffer.from("2a".repeat(32), "hex") }
const client = {} as RegistryClient
function state(app: IdentityMobileApplication = "TIME"): IdentityMobileState {
  const scope = { organizationId: "tenant-a", userId: "person-a" }, actorId = `card-${app}`
  return { company: { id: scope.organizationId, isActive: true, identityMobileEnabled: true }, person: { ...scope, isActive: true, anonymizedAt: null },
    account: { ...scope, version: 7, credentialEpoch: 4, cutoverAt: new Date("2026-10-24T19:00:00Z") }, claim: { ...scope, id: "claim-a" },
    grant: { ...scope, application: app, status: "ACTIVE", role: app === "TIME" ? "EMPLOYEE" : "AGENT", version: 2 },
    membership: { ...scope, application: app, actorId, active: true, version: 1 }, binding: { ...scope, actorId, status: "REVIEWED" },
    actor: { ...scope, id: actorId, status: "ACTIVE" }, license: { application: app, enabled: true } }
}
const request = (path = "/api/v1/mtm/mobile/profile") => new NextRequest(`https://fixture.invalid${path}`)
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now)
  vi.stubEnv("IDENTITY_MOBILE_SESSION_KEYS", JSON.stringify({ active: key.id, keys: { [key.id]: Buffer.from(key.material).toString("hex") } }))
  vi.stubEnv("IDENTITY_PHONE_PROOF_KEYS", "")
  mocks.state.mockResolvedValue(state())
  mocks.card.mockResolvedValue({ name: "Fictional person", email: null, role: "EMPLOYEE", attendanceParticipant: true, attendanceExcluded: false })
  mocks.company.mockResolvedValue({ modules: { personnel: true, "route-field": true }, plan: "starter", features: [], addons: [] })
  mocks.snapshot.mockImplementation(async (_client, _org, work) => ({ now, value: await work({ mtmAgent: { findFirst: mocks.card }, organization: { findFirst: mocks.company } }) }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
describe("canonical mobile runtime application boundary", () => {
  it("admits Time self service with fresh role and its separate actor, without Field capability", async () => {
    const token = issueIdentityMobileSession(state(), "TIME", key, now)
    expect(await resolveIdentityMobileRuntime(request(), token, client)).toMatchObject({ agentId: "card-TIME", userId: "person-a", identityApplication: "TIME", role: "EMPLOYEE", tenantCapabilities: { routeField: false, personnel: true } })
    expect(mocks.snapshot).toHaveBeenCalledWith({}, "tenant-a", expect.any(Function))
  })
  it("rejects Time on Field routes before any business query", async () => {
    const token = issueIdentityMobileSession(state(), "TIME", key, now)
    expect(await resolveIdentityMobileRuntime(request("/api/v1/mtm/agents"), token, client)).toBeNull()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
  it.each([{ attendanceParticipant: false }, { attendanceExcluded: true }, { role: "ADMIN" }])("refuses changed participation or source-role drift", async changes => {
    const token = issueIdentityMobileSession(state(), "TIME", key, now)
    mocks.card.mockResolvedValue({ name: "Fictional", email: null, role: "EMPLOYEE", attendanceParticipant: true, attendanceExcluded: false, ...changes })
    expect(await resolveIdentityMobileRuntime(request(), token, client)).toBeNull()
  })
  it("rejects revoked or stale grants even with a valid unexpired signature", async () => {
    const fresh = state(), token = issueIdentityMobileSession(fresh, "TIME", key, now)
    mocks.state.mockResolvedValue({ ...fresh, grant: { ...fresh.grant!, status: "REVOKED", version: 3 } })
    expect(await resolveIdentityMobileRuntime(request(), token, client)).toBeNull()
  })
  it("uses the Field actor and never adds a Personnel grant", async () => {
    const fresh = state("ROUTE_FIELD"), token = issueIdentityMobileSession(fresh, "ROUTE_FIELD", key, now)
    mocks.state.mockResolvedValue(fresh)
    mocks.card.mockResolvedValue({ name: "Fictional", email: null, role: "AGENT", attendanceParticipant: false, attendanceExcluded: false })
    expect(await resolveIdentityMobileRuntime(request("/api/v1/mtm/agents"), token, client)).toMatchObject({ agentId: "card-ROUTE_FIELD", identityApplication: "ROUTE_FIELD", tenantCapabilities: { routeField: true, personnel: false } })
  })
  it("does not query or fall back when the dedicated key is missing", async () => {
    const token = issueIdentityMobileSession(state(), "TIME", key, now)
    vi.stubEnv("IDENTITY_MOBILE_SESSION_KEYS", "")
    expect(readIdentityMobileRuntimeClaims(token)).toBeNull()
    expect(await resolveIdentityMobileRuntime(request(), token, client)).toBeNull()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
})
