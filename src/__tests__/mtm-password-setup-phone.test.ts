import { describe, expect, it, vi } from "vitest"
import jwt from "jsonwebtoken"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/mobile-auth", () => ({ JWT_SECRET: "fixture-setup-only" }))
import { readPasswordSetupToken, signPasswordSetupToken } from "@/lib/mtm/mobile-login-session"

const agent = { id: "fixture-phone-card", organizationId: "fixture-company", passwordHash: "!fixture-password-state" }
const phone = "+994507775511", key = "fixture-setup-only", audience = "mtm-password-setup"

describe("phone-bound legacy password setup capability", () => {
  it("round trips the confirmed server number, tenant and actor without becoming a mobile session", () => {
    const token = signPasswordSetupToken(agent, phone)
    const claims = jwt.verify(token, key, { audience, algorithms: ["HS256"] }) as jwt.JwtPayload
    expect(claims).toMatchObject({ v: 2, phone, org: agent.organizationId, sub: agent.id })
    expect(claims.agentId).toBeUndefined()
    expect(claims.passwordHash).toBeUndefined()
    expect(readPasswordSetupToken(token)).toEqual({ agentId: agent.id, organizationId: agent.organizationId,
      fingerprint: claims.fp, phone })
  })

  it("refuses a correctly signed old unbound capability instead of upgrading it", () => {
    const claims = jwt.decode(signPasswordSetupToken(agent, phone)) as jwt.JwtPayload
    const old = jwt.sign({ org: agent.organizationId, fp: claims.fp }, key, { subject: agent.id, audience, expiresIn: "15m" })
    expect(readPasswordSetupToken(old)).toBeNull()
  })

  const rejected: Array<{ audience?: string; key?: string; expiresIn?: number; algorithm?: jwt.Algorithm }> = [
    { audience: "mtm-mobile-session" }, { key: "other-fixture-key" },
    { expiresIn: -1 }, { algorithm: "HS384" },
  ]
  it.each(rejected)("refuses another purpose/key, expired capability or unaccepted algorithm: %j", options => {
    const token = jwt.sign({ v: 2, phone, org: agent.organizationId, fp: "fixture-fingerprint" }, options.key ?? key,
      { subject: agent.id, audience: options.audience ?? audience, expiresIn: options.expiresIn ?? 900,
        algorithm: options.algorithm ?? "HS256" })
    expect(readPasswordSetupToken(token)).toBeNull()
  })

  it.each(["0507775511", "+994 50 777 55 11"])("requires the already confirmed exact international number: %s", value => {
    expect(() => signPasswordSetupToken(agent, value)).toThrow("MTM_SETUP_PHONE_INVALID")
    const token = jwt.sign({ v: 2, phone: value, org: agent.organizationId, fp: "fixture-fingerprint" }, key,
      { subject: agent.id, audience, expiresIn: "15m" })
    expect(readPasswordSetupToken(token)).toBeNull()
  })
})
