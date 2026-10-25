import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({ session: vi.fn(), token: vi.fn(), enroll: vi.fn() }))
vi.mock("@/lib/api-auth", () => ({ requireSessionAuth: mocks.session }))
vi.mock("next-auth/jwt", () => ({ getToken: mocks.token }))
vi.mock("@/lib/auth-secret", () => ({ requireAuthSecret: () => "fictional-cookie-contract-key-only" }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, work: () => unknown) => work() }))
vi.mock("@/lib/identity/application-enrollment", () => ({ enrollIdentityApplication: mocks.enroll }))
import { PUT } from "@/app/api/v1/identity/people/[id]/applications/route"
import { POST as prepareActor } from "@/app/api/v1/identity/people/[id]/actors/route"
vi.mock("@/lib/identity/application-actor", () => ({ prepareIdentityApplicationActor: mocks.enroll }))

const claims = { mode: "IDENTITY_CRM_V1", organizationId: "fixture-company", userId: "fixture-admin", claimId: "fixture-claim", credentialEpoch: 3, grantVersion: 4 }
const body = { actorId: "fixture-time", application: "TIME", role: "EMPLOYEE", status: "ACTIVE", expectedAccountVersion: 2,
  expectedGrantVersion: 0, expectedMembershipVersion: 0, requestId: "fixture-enroll" }
const request = (value: unknown = body) => PUT(new NextRequest("https://fixture.example/api/v1/identity/people/fixture-person/applications", {
  method: "PUT", body: JSON.stringify(value),
}), { params: Promise.resolve({ id: "fixture-person" }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("AUTH_URL", "https://fixture.example")
  mocks.session.mockResolvedValue({ orgId: "fixture-company", userId: "fixture-admin", role: "admin", principalType: "session" })
  mocks.token.mockResolvedValue({ sub: "fixture-admin", organizationId: "fixture-company", identityCrm: claims })
  mocks.enroll.mockResolvedValue({ accountVersion: 3, grantVersion: 1, membershipVersion: 1, replayed: false })
})
afterEach(() => vi.unstubAllEnvs())

describe("identity application enrollment HTTP authority", () => {
  it("uses the private verified cookie context and path subject, without exposing claims", async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(mocks.enroll).toHaveBeenCalledWith({}, { organizationId: "fixture-company", userId: "fixture-admin", mode: "CANONICAL", claims }, { ...body, userId: "fixture-person" })
    expect(mocks.token.mock.calls[0][0].secureCookie).toBe(true)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.text()).not.toMatch(/claimId|credentialEpoch|fixture-admin/)
  })
  it("uses the trusted Auth.js URL for an isolated HTTP acceptance server", async () => {
    vi.stubEnv("AUTH_URL", "http://127.0.0.1:3000")
    expect((await request()).status).toBe(200)
    expect(mocks.token.mock.calls[0][0].secureCookie).toBe(false)
  })
  it.each([401, 403])("retains cookie/MFA denial %s before reading private authority", async status => {
    mocks.session.mockResolvedValue(NextResponse.json({ error: "denied" }, { status }))
    expect((await request()).status).toBe(status)
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it.each(["api_key", "mobile"])("never adopts %s as a human administrator", async principalType => {
    mocks.session.mockResolvedValue({ orgId: "fixture-company", userId: "fixture-admin", role: "admin", principalType })
    expect((await request()).status).toBe(403)
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it.each([
    null,
    { sub: "foreign-admin", organizationId: "fixture-company", identityCrm: claims },
    { sub: "fixture-admin", organizationId: "foreign-company", identityCrm: claims },
    { sub: "fixture-admin", organizationId: "fixture-company", needs2fa: true, identityCrm: claims },
    { sub: "fixture-admin", organizationId: "fixture-company", needsSetup2fa: true, identityCrm: claims },
    { sub: "fixture-admin", organizationId: "fixture-company", identityCrm: { ...claims, role: "admin" } },
    { sub: "fixture-admin", organizationId: "fixture-company", identityCrm: { ...claims, userId: "foreign-admin" } },
  ])("refuses missing, mismatched or incomplete private cookie authority", async token => {
    mocks.token.mockResolvedValue(token)
    expect((await request()).status).toBe(403)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it("never upgrades a legacy cookie to canonical authority from public session fields", async () => {
    mocks.session.mockResolvedValue({ orgId: "fixture-company", userId: "fixture-admin", role: "admin", principalType: "session", identityCrm: claims })
    mocks.token.mockResolvedValue({ sub: "fixture-admin", organizationId: "fixture-company" })
    expect((await request()).status).toBe(200)
    expect(mocks.enroll.mock.calls[0][1]).toEqual({ organizationId: "fixture-company", userId: "fixture-admin", mode: "LEGACY" })
  })
  it.each([{ ...body, organizationId: "foreign-company" }, { ...body, userId: "foreign-person" }, { ...body, administrator: claims }])("rejects authority and subject supplied in the body", async value => {
    expect((await request(value)).status).toBe(400)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it("does not expose private failure details", async () => {
    mocks.enroll.mockRejectedValue(new Error("private phone and database details"))
    const response = await request()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "IDENTITY_ENROLLMENT_FAILED" })
  })
  it("creates a card only for the authenticated tenant and explicitly selected person", async () => {
    const data = { actorId: null, application: "TIME", role: "EMPLOYEE", expectedAccountVersion: 2, reviewReference: "review-person", requestId: "prepare-card" }
    const response = await prepareActor(new NextRequest("https://fixture.example/api/v1/identity/people/fixture-person/actors", { method: "POST", body: JSON.stringify(data) }), { params: Promise.resolve({ id: "fixture-person" }) })
    expect(response.status).toBe(200)
    expect(mocks.enroll).toHaveBeenCalledWith({}, { organizationId: "fixture-company", userId: "fixture-admin", mode: "CANONICAL", claims }, { ...data, userId: "fixture-person" })
  })
  it("rejects a phone-based card adoption request", async () => {
    const data = { actorId: null, application: "TIME", role: "EMPLOYEE", expectedAccountVersion: 2, reviewReference: "review-person", requestId: "prepare-card", phone: "+994507770099" }
    const response = await prepareActor(new NextRequest("https://fixture.example/api/v1/identity/people/fixture-person/actors", { method: "POST", body: JSON.stringify(data) }), { params: Promise.resolve({ id: "fixture-person" }) })
    expect(response.status).toBe(400)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
})


vi.mock("@/lib/identity/time-enrollment", () => ({ lookupIdentityTimePerson: mocks.enroll, enrollExistingIdentityInTime: mocks.enroll }))
import { POST as lookupTime } from "@/app/api/v1/identity/time/lookup/route"
import { POST as enrollTime } from "@/app/api/v1/identity/time/enroll/route"
const timeInput = { userId: "fixture-person", expectedClaimId: "fixture-phone", expectedAccountVersion: 3,
  requestId: "b9ab19e0-e59d-49ac-8f47-70ec6c5f3479", position: "Accountant", teamId: null, departmentId: null, hireDate: "2026-10-25" }
const timeCall = (route: typeof lookupTime, value: unknown) => route(new NextRequest("https://fixture.example/api/v1/identity/time/enroll", { method: "POST", body: JSON.stringify(value) }))
describe("explicit existing-person Time registration", () => {
  it("uses verified private administrator authority for lookup and enrollment", async () => {
    expect((await timeCall(lookupTime, { phone: "+994507770014" })).status).toBe(200)
    expect(mocks.enroll).toHaveBeenLastCalledWith({}, { organizationId: "fixture-company", userId: "fixture-admin", mode: "CANONICAL", claims }, "+994507770014")
    expect((await timeCall(enrollTime, timeInput)).status).toBe(201)
    expect(mocks.enroll).toHaveBeenLastCalledWith({}, { organizationId: "fixture-company", userId: "fixture-admin", mode: "CANONICAL", claims }, timeInput)
  })
  it.each([lookupTime, enrollTime])("refuses non-admin sessions before any profile access", async route => {
    mocks.session.mockResolvedValue({ orgId: "fixture-company", userId: "viewer", role: "viewer", principalType: "session" })
    expect((await timeCall(route, timeInput)).status).toBe(403)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it.each([{ ...timeInput, organizationId: "foreign" }, { ...timeInput, password: "must-not-be-set-here" }, { ...timeInput, name: "replacement identity" }, { ...timeInput, expectedClaimId: "" }])("refuses scope, credential and profile substitutions", async input => {
    expect((await timeCall(enrollTime, input)).status).toBe(400)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
})


vi.mock("@/lib/identity/onboarding", () => ({ createIdentityOnboardingIntent: mocks.enroll, cancelIdentityOnboardingIntent: mocks.enroll }))
import { POST as invite } from "@/app/api/v1/identity/people/[id]/onboarding/route"
import { POST as cancelInvite } from "@/app/api/v1/identity/onboarding/[id]/cancel/route"
const invitation = { phone: "+994507770014", application: "TIME", expectedAccountVersion: 4, expectedCredentialEpoch: 1,
  expectedContactRevision: 1, requestId: "first-login-review", reviewReference: "explicit-first-login", applications: [
    { application: "TIME", role: "EMPLOYEE", status: "ACTIVE", actorId: "reviewed-time-card", grantVersion: 1, membershipVersion: 1, membershipStatus: "ACTIVE" },
  ] }
const inviteCall = (route: typeof invite, value: unknown) => route(new NextRequest("https://fixture.example/api/v1/identity/people/fixture-person/onboarding", {
  method: "POST", body: JSON.stringify(value),
}), { params: Promise.resolve({ id: "fixture-person" }) })
describe("first-login invitation HTTP review", () => {
  it("binds the reviewed plan to the private canonical administrator and path person", async () => {
    expect((await inviteCall(invite, invitation)).status).toBe(201)
    expect(mocks.enroll).toHaveBeenCalledWith({}, { organizationId: "fixture-company", userId: "fixture-admin", mode: "CANONICAL", claims }, { ...invitation, userId: "fixture-person" })
  })
  it.each(["userId", "organizationId", "password", "issuerAuthority", "expiresAt"])("refuses caller-supplied %s", async field => {
    expect((await inviteCall(invite, { ...invitation, [field]: "forged" })).status).toBe(400)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it("does not turn a legacy session into durable canonical authority", async () => {
    mocks.token.mockResolvedValue({ sub: "fixture-admin", organizationId: "fixture-company" })
    expect((await inviteCall(invite, invitation)).status).toBe(409)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it.each([invite, cancelInvite])("requires completed MFA before invitation or cancellation", async route => {
    mocks.token.mockResolvedValue({ sub: "fixture-admin", organizationId: "fixture-company", identityCrm: claims, needs2fa: true })
    expect((await inviteCall(route, invitation)).status).toBe(403)
    expect(mocks.enroll).not.toHaveBeenCalled()
  })
  it("cancels only the path invitation under fresh server authority", async () => {
    expect((await inviteCall(cancelInvite, { requestId: "cancel-reviewed" })).status).toBe(200)
    expect(mocks.enroll).toHaveBeenCalledWith({}, { organizationId: "fixture-company", userId: "fixture-admin", mode: "CANONICAL", claims }, "fixture-person", "cancel-reviewed")
  })
})
