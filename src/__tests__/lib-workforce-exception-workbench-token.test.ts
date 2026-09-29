import { describe, expect, it } from "vitest"
import {
  issueWorkforceExceptionActionToken,
  readWorkforceExceptionActionToken,
} from "@/lib/workforce/exception-workbench-token"

const NOW = new Date("2026-09-26T12:00:00.000Z")
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

function alternateTrailingPadBits(token: string): string {
  const [prefix, encoded] = token.split(":")
  const remainder = encoded.length % 4
  if (remainder !== 2 && remainder !== 3) throw new Error("test token has no unused base64url bits")
  const finalIndex = BASE64URL.indexOf(encoded.at(-1)!)
  if (finalIndex < 0) throw new Error("test token is not base64url")
  return `${prefix}:${encoded.slice(0, -1)}${BASE64URL[finalIndex ^ 1]}`
}

describe("Workforce exception workbench action token", () => {
  it("round-trips an exact principal, action and decision revision", () => {
    const token = issueWorkforceExceptionActionToken({
      organizationId: "org_1",
      principalUserId: "user_1",
      caseId: "case_1",
      decisionCode: "REQUEST_TIME_CORRECTION",
      decisionCount: 4,
      now: NOW,
    })

    expect(readWorkforceExceptionActionToken({
      token,
      organizationId: "org_1",
      principalUserId: "user_1",
      now: new Date(NOW.getTime() + 299_000),
    })).toEqual({
      organizationId: "org_1",
      principalUserId: "user_1",
      caseId: "case_1",
      decisionCode: "REQUEST_TIME_CORRECTION",
      decisionCount: 4,
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 300_000),
    })
  })

  it("rejects plaintext, tampering, another principal and expiry", () => {
    const token = issueWorkforceExceptionActionToken({
      organizationId: "org_1",
      principalUserId: "user_1",
      caseId: "case_1",
      decisionCode: "ACKNOWLEDGE",
      decisionCount: 0,
      now: NOW,
    })
    const input = { organizationId: "org_1", principalUserId: "user_1", now: NOW }

    expect(readWorkforceExceptionActionToken({ ...input, token: JSON.stringify({ caseId: "case_1" }) })).toBeNull()
    expect(readWorkforceExceptionActionToken({ ...input, token: `${token}x` })).toBeNull()
    expect(readWorkforceExceptionActionToken({ ...input, token, principalUserId: "user_2" })).toBeNull()
    expect(readWorkforceExceptionActionToken({ ...input, token, now: new Date(NOW.getTime() + 300_000) })).toBeNull()
  })

  it("rejects a second textual form created from unused trailing base64url bits", () => {
    let token = ""
    for (let suffixLength = 1; suffixLength <= 3; suffixLength += 1) {
      const candidate = issueWorkforceExceptionActionToken({
        organizationId: "org_1",
        principalUserId: "user_1",
        caseId: `case_${"x".repeat(suffixLength)}`,
        decisionCode: "ACKNOWLEDGE",
        decisionCount: 0,
        now: NOW,
      })
      if ([2, 3].includes(candidate.slice("v1:".length).length % 4)) {
        token = candidate
        break
      }
    }
    expect(token).not.toBe("")
    const nonCanonical = alternateTrailingPadBits(token)
    expect(nonCanonical).not.toBe(token)
    expect(Buffer.from(nonCanonical.slice(3), "base64url"))
      .toEqual(Buffer.from(token.slice(3), "base64url"))
    expect(readWorkforceExceptionActionToken({
      token: nonCanonical,
      organizationId: "org_1",
      principalUserId: "user_1",
      now: NOW,
    })).toBeNull()
  })

  it("refuses an oversized lifetime or lifecycle revision", () => {
    expect(() => issueWorkforceExceptionActionToken({
      organizationId: "org_1",
      principalUserId: "user_1",
      caseId: "case_1",
      decisionCode: "ACKNOWLEDGE",
      decisionCount: 65,
      now: NOW,
    })).toThrow("WORKFORCE_EXCEPTION_ACTION_TOKEN_INPUT_INVALID")
    expect(() => issueWorkforceExceptionActionToken({
      organizationId: "org_1",
      principalUserId: "user_1",
      caseId: "case_1",
      decisionCode: "ACKNOWLEDGE",
      decisionCount: 0,
      now: NOW,
      ttlSeconds: 601,
    })).toThrow("WORKFORCE_EXCEPTION_ACTION_TOKEN_INPUT_INVALID")
  })
})
