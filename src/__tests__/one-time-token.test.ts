import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import { generateOneTimeToken, hashOneTimeToken } from "@/lib/one-time-token"

/**
 * Finding F-28 (docs/isms/ISMS-02-gap-analysis.md): the password-reset token was
 * stored in `users.resetToken` in plaintext and matched by equality. For the
 * hour it lives that column is a password equivalent sitting unprotected beside
 * bcrypt-hashed passwords.
 */
describe("password reset token", () => {
  it("issues a token with 256 bits of entropy", () => {
    const { token } = generateOneTimeToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it("returns a digest that is not the token", () => {
    const { token, tokenHash } = generateOneTimeToken()
    expect(tokenHash).not.toBe(token)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("hashes deterministically so issuing and redeeming agree", () => {
    const { token, tokenHash } = generateOneTimeToken()
    expect(hashOneTimeToken(token)).toBe(tokenHash)
  })

  it("issues a different token every call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateOneTimeToken().token))
    expect(seen.size).toBe(50)
  })
})

/**
 * Comments are stripped before any assertion about code. Both routes document
 * the defect they fixed by naming the old expression, and a check that cannot
 * tell an explanation from an instruction would forbid explaining the fix.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => {
      const t = line.trim()
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
    })
    .join("\n")
}

describe("reset routes never persist or match the plaintext token", () => {
  const forgot = code("src/app/api/v1/auth/forgot-password/route.ts")
  const reset = code("src/app/api/v1/auth/reset-password/route.ts")

  it("stores the digest when issuing", () => {
    expect(forgot).toContain("resetToken: tokenHash")
    // The bare assignment is what the finding was about.
    expect(forgot).not.toMatch(/resetToken:\s*token\b/)
  })

  it("looks the digest up when redeeming", () => {
    expect(reset).toContain("hashOneTimeToken(token)")
    expect(reset).not.toMatch(/resetToken:\s*token\b/)
  })

  it("rate-limits issuing by both address and source", () => {
    // An unauthenticated endpoint that sends mail is an abuse primitive: it
    // floods a victim's inbox and burns the sending reputation of the domain the
    // whole product delivers on.
    expect(forgot).toContain("forgot-password:ip:")
    expect(forgot).toContain("forgot-password:email:")
  })

  it("issues a link for every account on the address, not an arbitrary one", () => {
    // findFirst was a multi-tenancy defect: one person often holds accounts in
    // several tenants and the arbitrary pick is stable, so the user could be
    // permanently unable to reset the account they were actually locked out of.
    expect(forgot).toContain("findMany")
    expect(forgot).not.toContain("findFirst")
  })
})

describe("portal verification tokens are stored as a digest (F-30)", () => {
  // The same defect as the password reset token, one column over — and worse in
  // two ways: the lifetime is 24 hours rather than one, so more tokens are live
  // at any moment, and the account it unlocks belongs to a tenant's own
  // customer, whose tickets and invoices sit behind it.
  it("register stores the digest and mails the token", () => {
    const src = code("src/app/api/v1/public/portal-auth/register/route.ts")
    expect(src).toContain("generateOneTimeToken")
    expect(src).toContain("portalVerificationToken: tokenHash")
    expect(src).not.toMatch(/portalVerificationToken:\s*token\b/)
  })

  it("set-password matches the digest in all three predicates", () => {
    const src = code("src/app/api/v1/public/portal-auth/set-password/route.ts")
    expect(src).toContain("hashOneTimeToken(token)")
    // GET validation, POST lookup and the compare-and-set must all agree; a
    // single stale predicate would silently reject every valid link.
    expect(src.match(/portalVerificationToken: tokenHash/g)).toHaveLength(3)
    expect(src).not.toMatch(/portalVerificationToken:\s*token\b/)
  })
})
