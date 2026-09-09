/**
 * esign-token-issuer — dedicated regression tests for Slice 2 FIX 1.
 *
 * These tests specifically validate the per-issuance nonce (jti) behaviour
 * introduced in the security hardening pass. They complement the broader
 * helper tests in lib-esign.test.ts.
 *
 * FIX 1 invariants:
 *   • Two issueToken calls with the same {eid, sid, exp} produce DIFFERENT
 *     tokens + hashes (jti nonce makes them unique per issuance).
 *   • verifyToken still validates each token against its own hash (the sig
 *     portion recomputed over the full nonce-bearing payload).
 *   • An old stored hash (tokenHash_A) does not match a newly issued token_B
 *     (different jti → different payload → different HMAC) → old link dead.
 *   • verifyToken is backward-compatible: tokens without jti (issued before
 *     this change) still verify correctly (looksLikeClaims does not require jti).
 */
import { describe, it, expect } from "vitest"
import { issueToken, verifyToken } from "@/lib/esign/token-issuer"

const SECRET = "test-secret-that-is-at-least-32-chars!!"
const NOW_UNIX = Math.floor(Date.now() / 1000)
const EXP_FUTURE = NOW_UNIX + 3600

const BASE_CLAIMS = { eid: "env-nonce-test", sid: "signer-nonce-test", exp: EXP_FUTURE }

describe("FIX 1 — per-issuance token nonce (jti)", () => {
  it("two issueToken calls with the same claims produce DIFFERENT tokens", () => {
    const a = issueToken({ claims: BASE_CLAIMS, secret: SECRET })
    const b = issueToken({ claims: BASE_CLAIMS, secret: SECRET })

    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })

  it("each issued token verifies successfully against its own hash", () => {
    const a = issueToken({ claims: BASE_CLAIMS, secret: SECRET })
    const b = issueToken({ claims: BASE_CLAIMS, secret: SECRET })

    const va = verifyToken({ token: a.token, secret: SECRET, asOfUnix: NOW_UNIX })
    const vb = verifyToken({ token: b.token, secret: SECRET, asOfUnix: NOW_UNIX })

    expect(va.ok).toBe(true)
    expect(vb.ok).toBe(true)

    if (va.ok) expect(va.tokenHash).toBe(a.tokenHash)
    if (vb.ok) expect(vb.tokenHash).toBe(b.tokenHash)
  })

  it("old tokenHash (A) does not match a new token (B) — old link dies on rotation", () => {
    // Scenario: signer row has tokenHash_A stored. On reminder re-issue,
    // a new token B is issued. B's sig (tokenHash_B) replaces A in the DB.
    // A presentation of old token A: its sig portion = tokenHash_A, but
    // the DB now has tokenHash_B. The stored-hash compare → mismatch → 401.
    const tokenA = issueToken({ claims: BASE_CLAIMS, secret: SECRET })
    const tokenB = issueToken({ claims: BASE_CLAIMS, secret: SECRET })

    // The sig portion of token A
    const sigA = tokenA.token.split(".")[1]
    // The sig portion of token B (what is now stored in DB)
    const sigB = tokenB.token.split(".")[1]

    // After rotation, the DB has tokenHash_B. Token A's sig ≠ tokenHash_B.
    expect(sigA).not.toBe(sigB)
    // Both are non-empty HMAC signatures
    expect(sigA.length).toBeGreaterThan(16)
    expect(sigB.length).toBeGreaterThan(16)
  })

  it("verifyToken still validates a nonce-bearing token (eid/sid/exp readable from claims)", () => {
    const issued = issueToken({ claims: BASE_CLAIMS, secret: SECRET })
    const result = verifyToken({ token: issued.token, secret: SECRET, asOfUnix: NOW_UNIX })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Core claims must be readable — jti is internal to the payload
      expect(result.claims.eid).toBe(BASE_CLAIMS.eid)
      expect(result.claims.sid).toBe(BASE_CLAIMS.sid)
      expect(result.claims.exp).toBe(BASE_CLAIMS.exp)
    }
  })

  it("backward-compat: verifyToken accepts a token without jti (pre-nonce token)", () => {
    // Construct a token in the old format (no jti) by directly encoding the payload.
    // This simulates a token that was issued before the nonce was added and is still in flight.
    const { createHmac } = require("crypto") as typeof import("crypto")
    const payload = JSON.stringify({ eid: "env-old", sid: "signer-old", exp: EXP_FUTURE })
    const payloadB64 = Buffer.from(payload, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const sigBuf = createHmac("sha256", SECRET).update(payloadB64).digest()
    const sigB64 = sigBuf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const oldFormatToken = `${payloadB64}.${sigB64}`

    const result = verifyToken({ token: oldFormatToken, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.claims.eid).toBe("env-old")
      expect(result.claims.sid).toBe("signer-old")
      expect(result.claims.exp).toBe(EXP_FUTURE)
    }
  })

  it("nonce makes every issuance unique even under high frequency (20 calls, all distinct)", () => {
    const hashes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const { tokenHash } = issueToken({ claims: BASE_CLAIMS, secret: SECRET })
      hashes.add(tokenHash)
    }
    // All 20 must be unique
    expect(hashes.size).toBe(20)
  })

  it("token format remains <payloadB64>.<sigB64> (two-part, no extra dots)", () => {
    const issued = issueToken({ claims: BASE_CLAIMS, secret: SECRET })
    const parts = issued.token.split(".")
    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBeGreaterThan(0)
    expect(parts[1].length).toBeGreaterThan(0)
    // tokenHash === sig portion
    expect(issued.tokenHash).toBe(parts[1])
  })
})
