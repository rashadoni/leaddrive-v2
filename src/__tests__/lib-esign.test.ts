/**
 * Tests for M6 E-Signature slice 1 — 5 pure helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import {
  canEnvelopeTransition,
  canSignerTransition,
  deriveEnvelopeStatus,
  envelopeAllowedNext,
  isEnvelopeStatus,
  isEnvelopeTerminal,
  isSignerStatus,
  isSignerTerminal,
  signerAllowedNext,
  type SignerSnapshot,
} from "@/lib/esign/state-machine"
import { issueToken, verifyToken } from "@/lib/esign/token-issuer"
import { validateSignaturePayload } from "@/lib/esign/signature-validator"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_EVENT_TYPES,
  DEFAULT_SIGNATURE_LIMITS,
  ENVELOPE_STATUSES,
  ENVELOPE_TRANSITIONS,
  SIGNATURE_METHODS,
  SIGNER_ROLES,
  SIGNER_STATUSES,
  SIGNER_TRANSITIONS,
} from "@/lib/esign/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("M6 — envelope state-machine", () => {
  it("accepts every canonical envelope status", () => {
    for (const s of ENVELOPE_STATUSES) expect(isEnvelopeStatus(s)).toBe(true)
  })

  it("rejects unknown / mis-cased envelope statuses", () => {
    for (const s of ["", "Created", "SENT", "active", null, 42]) {
      expect(isEnvelopeStatus(s)).toBe(false)
    }
  })

  it("allows created → sent", () => {
    expect(canEnvelopeTransition("created", "sent")).toEqual({ ok: true })
  })

  it("allows sent → in_progress / declined / voided / expired", () => {
    for (const to of ["in_progress", "declined", "voided", "expired"] as const) {
      expect(canEnvelopeTransition("sent", to)).toEqual({ ok: true })
    }
  })

  it("rejects sent → completed (must pass through in_progress)", () => {
    const r = canEnvelopeTransition("sent", "completed")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not allowed/)
  })

  it("rejects backward (completed → in_progress)", () => {
    const r = canEnvelopeTransition("completed", "in_progress")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/)
  })

  it("rejects self-transitions", () => {
    expect(canEnvelopeTransition("sent", "sent").ok).toBe(false)
  })

  it("envelopeAllowedNext matches ENVELOPE_TRANSITIONS", () => {
    for (const s of ENVELOPE_STATUSES) {
      expect(envelopeAllowedNext(s)).toEqual(ENVELOPE_TRANSITIONS[s])
    }
  })

  it("4 terminal statuses (completed/declined/voided/expired)", () => {
    const terminals = ENVELOPE_STATUSES.filter((s) => isEnvelopeTerminal(s))
    expect(terminals.sort()).toEqual(["completed", "declined", "expired", "voided"])
  })
})

describe("M6 — signer state-machine", () => {
  it("accepts every canonical signer status", () => {
    for (const s of SIGNER_STATUSES) expect(isSignerStatus(s)).toBe(true)
  })

  it("allows pending → sent only", () => {
    expect(canSignerTransition("pending", "sent")).toEqual({ ok: true })
    expect(canSignerTransition("pending", "viewed").ok).toBe(false)
    expect(canSignerTransition("pending", "signed").ok).toBe(false)
  })

  it("allows sent → viewed / signed / declined / expired", () => {
    for (const to of ["viewed", "signed", "declined", "expired"] as const) {
      expect(canSignerTransition("sent", to)).toEqual({ ok: true })
    }
  })

  it("rejects viewed → pending (no backward)", () => {
    expect(canSignerTransition("viewed", "pending").ok).toBe(false)
  })

  it("3 terminal signer statuses (signed/declined/expired)", () => {
    const terminals = SIGNER_STATUSES.filter((s) => isSignerTerminal(s))
    expect(terminals.sort()).toEqual(["declined", "expired", "signed"])
  })

  it("signerAllowedNext matches table", () => {
    for (const s of SIGNER_STATUSES) {
      expect(signerAllowedNext(s)).toEqual(SIGNER_TRANSITIONS[s])
    }
  })
})

describe("M6 — deriveEnvelopeStatus", () => {
  function mk(rows: SignerSnapshot[]) {
    return rows
  }

  it("returns 'completed' when all signers signed", () => {
    expect(
      deriveEnvelopeStatus(
        "in_progress",
        mk([
          { role: "signer", status: "signed" },
          { role: "signer", status: "signed" },
        ])
      )
    ).toBe("completed")
  })

  it("returns 'declined' if any signer declined", () => {
    expect(
      deriveEnvelopeStatus(
        "in_progress",
        mk([
          { role: "signer", status: "signed" },
          { role: "signer", status: "declined" },
        ])
      )
    ).toBe("declined")
  })

  it("returns 'in_progress' when first signer views (envelope still 'sent')", () => {
    expect(
      deriveEnvelopeStatus(
        "sent",
        mk([
          { role: "signer", status: "viewed" },
          { role: "signer", status: "sent" },
        ])
      )
    ).toBe("in_progress")
  })

  it("returns null when envelope already in_progress and no further progress", () => {
    expect(
      deriveEnvelopeStatus(
        "in_progress",
        mk([
          { role: "signer", status: "viewed" },
          { role: "signer", status: "pending" },
        ])
      )
    ).toBeNull()
  })

  it("returns null when envelope is terminal", () => {
    expect(
      deriveEnvelopeStatus(
        "completed",
        mk([{ role: "signer", status: "signed" }])
      )
    ).toBeNull()
  })

  it("ignores cc / copy signers in completion math", () => {
    expect(
      deriveEnvelopeStatus(
        "in_progress",
        mk([
          { role: "signer", status: "signed" },
          { role: "cc", status: "pending" },
          { role: "copy", status: "sent" },
        ])
      )
    ).toBe("completed")
  })

  it("returns null if there are no role=signer rows at all", () => {
    expect(
      deriveEnvelopeStatus(
        "in_progress",
        mk([{ role: "cc", status: "pending" }])
      )
    ).toBeNull()
  })

  it("respects transition guard (won't suggest in_progress from in_progress)", () => {
    expect(
      deriveEnvelopeStatus(
        "in_progress",
        mk([{ role: "signer", status: "viewed" }])
      )
    ).toBeNull()
  })

  it("respects transition guard for created → completed (must pass through in_progress)", () => {
    // Architect-flagged edge: if envelope is still `created` but
    // all signers magically `signed` (impossible in real flow but
    // possible via direct DB write), the helper must NOT suggest
    // `completed` — `created → completed` is not an allowed transition.
    // The helper relies on canEnvelopeTransition to reject this.
    expect(
      deriveEnvelopeStatus(
        "created",
        mk([
          { role: "signer", status: "signed" },
          { role: "signer", status: "signed" },
        ])
      )
    ).toBeNull()
  })
})

/* ─── Token issuer + verifier ─────────────────────────────────────────── */

describe("M6 — token-issuer", () => {
  const SECRET = "test-secret-32-chars-or-longer-recommended"
  const NOW_UNIX = 1747500000 // 2025-05-17ish

  it("issueToken returns a token + matching tokenHash", () => {
    const r = issueToken({
      claims: { eid: "env_1", sid: "sig_1", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    expect(r.token.split(".")).toHaveLength(2)
    expect(r.tokenHash).toBe(r.token.split(".")[1])
  })

  it("verifyToken accepts a freshly-issued token", () => {
    const issued = issueToken({
      claims: { eid: "env_1", sid: "sig_1", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    const v = verifyToken({ token: issued.token, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(v.ok).toBe(true)
    if (v.ok) {
      // FIX 1: claims now include the jti nonce — use objectContaining for forward-compat
      expect(v.claims).toMatchObject({ eid: "env_1", sid: "sig_1", exp: NOW_UNIX + 3600 })
      // jti must be a non-empty hex string (16 bytes = 32 hex chars)
      expect(typeof v.claims.jti).toBe("string")
      expect((v.claims.jti as string).length).toBe(32)
      expect(v.tokenHash).toBe(issued.tokenHash)
    }
  })

  it("verifyToken rejects token signed with a different secret", () => {
    const issued = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    const v = verifyToken({ token: issued.token, secret: "wrong-secret", asOfUnix: NOW_UNIX })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("bad_signature")
  })

  it("verifyToken rejects expired token", () => {
    const issued = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX - 1 },
      secret: SECRET,
    })
    const v = verifyToken({ token: issued.token, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("expired")
  })

  it("verifyToken rejects token at exact expiry (boundary)", () => {
    const issued = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX },
      secret: SECRET,
    })
    const v = verifyToken({ token: issued.token, secret: SECRET, asOfUnix: NOW_UNIX })
    // exp == asOfUnix → exp <= now → expired.
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("expired")
  })

  it("verifyToken rejects malformed input", () => {
    for (const t of ["", "no-dot", "too.many.dots", ".missing-payload", "missing-sig."]) {
      const v = verifyToken({ token: t, secret: SECRET, asOfUnix: NOW_UNIX })
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.reason).toBe("malformed")
    }
  })

  it("verifyToken rejects token with tampered payload", () => {
    const issued = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    // Replace payload-portion with a different base64.
    const [, sig] = issued.token.split(".")
    const tampered = Buffer.from(JSON.stringify({ eid: "e", sid: "OTHER", exp: NOW_UNIX + 3600 }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "") +
      "." +
      sig
    const v = verifyToken({ token: tampered, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("bad_signature")
  })

  it("verifyToken rejects token with non-JSON payload", () => {
    // Construct a token where payload is valid base64 but invalid JSON.
    const garbage = Buffer.from("not json at all")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    // We need to compute the proper HMAC over the garbage so signature
    // is accepted but payload is rejected as not-JSON.
    const { createHmac } = require("crypto") as typeof import("crypto")
    const sig = createHmac("sha256", SECRET).update(garbage).digest()
    const sigB64 = sig
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const v = verifyToken({
      token: `${garbage}.${sigB64}`,
      secret: SECRET,
      asOfUnix: NOW_UNIX,
    })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("invalid_payload")
  })

  it("verifyToken rejects JSON payload missing claims", () => {
    const incomplete = Buffer.from(JSON.stringify({ eid: "e", sid: "s" })) // missing exp
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const { createHmac } = require("crypto") as typeof import("crypto")
    const sig = createHmac("sha256", SECRET).update(incomplete).digest()
    const sigB64 = sig
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    const v = verifyToken({
      token: `${incomplete}.${sigB64}`,
      secret: SECRET,
      asOfUnix: NOW_UNIX,
    })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("invalid_payload")
  })

  it("issueToken throws on empty secret", () => {
    expect(() =>
      issueToken({
        claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 },
        secret: "",
      })
    ).toThrow(/secret must be/)
  })

  it("issueToken throws on missing claim fields", () => {
    expect(() =>
      issueToken({
        claims: { eid: "", sid: "s", exp: NOW_UNIX + 3600 },
        secret: SECRET,
      })
    ).toThrow(/claims must be/)
  })

  it("FIX 1: tokens with same claims + same secret are NOW non-deterministic (per-issuance nonce)", () => {
    // Slice 2 security hardening: each issueToken call embeds a random jti nonce
    // so re-issuing with the same {eid, sid, exp} produces a DIFFERENT token + hash.
    // This means rotating (reminder re-issue, explicit re-send) always invalidates
    // the previously stored tokenHash → old links die.
    const a = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    const b = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })

  it("FIX 1: each token still verifies against its own hash (verifyToken backward-compat)", () => {
    const issued = issueToken({
      claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    const v = verifyToken({ token: issued.token, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.tokenHash).toBe(issued.tokenHash)
  })

  it("FIX 1: old tokenHash rejects a new token (rotation makes old link dead)", () => {
    // Simulate: issue token A (stored hash), then re-issue token B (new hash stored).
    // The old token A's sig (= stored hash A) no longer matches stored hash B → 401.
    const a = issueToken({ claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 }, secret: SECRET })
    const b = issueToken({ claims: { eid: "e", sid: "s", exp: NOW_UNIX + 3600 }, secret: SECRET })
    // Verify token A against hash A → ok
    const va = verifyToken({ token: a.token, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(va.ok).toBe(true)
    // Verify token B against hash B → ok
    const vb = verifyToken({ token: b.token, secret: SECRET, asOfUnix: NOW_UNIX })
    expect(vb.ok).toBe(true)
    // Token A's sig does NOT equal hash B (different jti in payload)
    if (va.ok && vb.ok) expect(va.tokenHash).not.toBe(vb.tokenHash)
  })

  it("tokens with different claims produce different signatures", () => {
    const a = issueToken({
      claims: { eid: "e", sid: "s1", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    const b = issueToken({
      claims: { eid: "e", sid: "s2", exp: NOW_UNIX + 3600 },
      secret: SECRET,
    })
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })

  it("uses current time when asOfUnix not provided", () => {
    const issued = issueToken({
      claims: { eid: "e", sid: "s", exp: Math.floor(Date.now() / 1000) + 3600 },
      secret: SECRET,
    })
    const v = verifyToken({ token: issued.token, secret: SECRET })
    expect(v.ok).toBe(true)
  })
})

/* ─── Signature validator ─────────────────────────────────────────────── */

describe("M6 — signature-validator", () => {
  it("accepts a well-formed drawn payload", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { svgPath: "M 0 0 L 10 10", widthPx: 300, heightPx: 150 },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts a well-formed typed payload", () => {
    const r = validateSignaturePayload({
      method: "typed",
      payload: { typedName: "John Doe", font: "dancing-script" },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts a well-formed uploaded payload", () => {
    const r = validateSignaturePayload({
      method: "uploaded",
      payload: { fileRefId: "blob_abc123" },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects unknown method", () => {
    const r = validateSignaturePayload({
      method: "biometric" as never,
      payload: {},
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-object payload", () => {
    const r = validateSignaturePayload({ method: "drawn", payload: "string-not-object" as never })
    expect(r.ok).toBe(false)
  })

  it("drawn: rejects missing svgPath", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { widthPx: 100, heightPx: 100 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/svgPath/)
  })

  it("drawn: rejects empty svgPath", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { svgPath: "", widthPx: 100, heightPx: 100 },
    })
    expect(r.ok).toBe(false)
  })

  it("drawn: rejects oversized svgPath", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: {
        svgPath: "x".repeat(DEFAULT_SIGNATURE_LIMITS.maxSvgPathChars + 1),
        widthPx: 100,
        heightPx: 100,
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/exceeds limit/)
  })

  it("drawn: rejects zero/negative dimensions", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { svgPath: "M 0 0", widthPx: 0, heightPx: 100 },
    })
    expect(r.ok).toBe(false)
  })

  it("drawn: rejects overlarge dimensions", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { svgPath: "M 0 0", widthPx: 99999, heightPx: 100 },
    })
    expect(r.ok).toBe(false)
  })

  it("typed: rejects empty / whitespace-only name", () => {
    const r = validateSignaturePayload({
      method: "typed",
      payload: { typedName: "   ", font: "great-vibes" },
    })
    expect(r.ok).toBe(false)
  })

  it("typed: rejects bad font slug (special chars)", () => {
    const r = validateSignaturePayload({
      method: "typed",
      payload: { typedName: "John", font: "great vibes!" },
    })
    expect(r.ok).toBe(false)
  })

  it("uploaded: rejects empty fileRefId", () => {
    const r = validateSignaturePayload({
      method: "uploaded",
      payload: { fileRefId: "" },
    })
    expect(r.ok).toBe(false)
  })

  it("respects custom limits override", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { svgPath: "xxxx", widthPx: 100, heightPx: 100 },
      limits: { maxSvgPathChars: 2 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/exceeds limit 2/)
  })

  it("rejects payload with prototype-chain keys (defense-in-depth)", () => {
    // Object.prototype.hasOwnProperty.call ignores prototype keys, so
    // a `__proto__`-injected payload behaves as if those fields were absent.
    const raw = JSON.parse('{"__proto__": {"svgPath": "M 0 0", "widthPx": 100, "heightPx": 100}}')
    const r = validateSignaturePayload({ method: "drawn", payload: raw })
    expect(r.ok).toBe(false)
  })

  it("returns rejected when limits are non-positive", () => {
    const r = validateSignaturePayload({
      method: "drawn",
      payload: { svgPath: "M 0 0", widthPx: 100, heightPx: 100 },
      limits: { maxSvgPathChars: 0 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/positive/)
  })
})

/* ─── Audit event builder ─────────────────────────────────────────────── */

describe("M6 — audit-event-builder", () => {
  const NOW = new Date("2026-05-17T12:00:00Z")
  const baseInput = {
    organizationId: "org_1",
    envelopeId: "env_1",
    at: NOW,
  } as const

  it("builds an envelope_created event", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_created",
      actorType: "user",
      actorId: "user_123",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.record.eventType).toBe("envelope_created")
      expect(r.record.actorId).toBe("user_123")
      expect(r.record.signerId).toBeNull()
      expect(r.record.createdAt).toEqual(NOW)
    }
  })

  it("builds a signer_signed event with signerId", () => {
    const r = buildAuditEvent({
      ...baseInput,
      signerId: "sig_42",
      eventType: "signer_signed",
      actorType: "signer",
      actorId: "sig_42",
      ipAddress: "203.0.113.5",
      userAgent: "Mozilla/5.0 ...",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.record.signerId).toBe("sig_42")
      expect(r.record.ipAddress).toBe("203.0.113.5")
    }
  })

  it("rejects signer_* event without signerId", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "signer_signed",
      actorType: "signer",
      actorId: "sig_42",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/signerId/)
  })

  it("rejects actorType='user' without actorId", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_created",
      actorType: "user",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/actorId/)
  })

  it("rejects actorType='system' WITH actorId", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_expired",
      actorType: "system",
      actorId: "should-not-be-set",
    })
    expect(r.ok).toBe(false)
  })

  it("builds a system event with null actorId", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_expired",
      actorType: "system",
      actorId: null,
    })
    expect(r.ok).toBe(true)
  })

  it("strips forbidden metadata keys (defense-in-depth)", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_created",
      actorType: "user",
      actorId: "user_1",
      metadata: {
        legitimate: "value",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        __proto__: { polluted: true } as never,
        constructor: "evil",
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.record.metadata.legitimate).toBe("value")
      // Defense-in-depth: FORBIDDEN_METADATA_KEYS skip means `constructor`
      // is NOT assigned as an own property on the result. Reading
      // `.constructor` would still return the inherited Object via
      // prototype chain — that's expected JS semantics. The guard's
      // real job is to prevent JSONB persistence of attacker-controlled
      // `constructor` / `__proto__` blob, so check own-key absence.
      expect(Object.prototype.hasOwnProperty.call(r.record.metadata, "constructor")).toBe(false)
      // __proto__ is a setter on object literals — it would have been
      // skipped by Object.keys iteration regardless of our guard, but
      // we still defend in case the caller did defineProperty.
      expect(Object.prototype.hasOwnProperty.call(r.record.metadata, "__proto__")).toBe(false)
    }
  })

  it("rejects unknown eventType", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_exploded" as never,
      actorType: "user",
      actorId: "u",
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown actorType", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_created",
      actorType: "admin" as never,
      actorId: "u",
    })
    expect(r.ok).toBe(false)
  })

  it("rejects missing organizationId / envelopeId", () => {
    expect(
      buildAuditEvent({
        ...baseInput,
        organizationId: "",
        eventType: "envelope_created",
        actorType: "user",
        actorId: "u",
      }).ok
    ).toBe(false)
    expect(
      buildAuditEvent({
        ...baseInput,
        envelopeId: "",
        eventType: "envelope_created",
        actorType: "user",
        actorId: "u",
      }).ok
    ).toBe(false)
  })

  it("rejects invalid Date", () => {
    const r = buildAuditEvent({
      organizationId: "org",
      envelopeId: "env",
      at: new Date(NaN),
      eventType: "envelope_created",
      actorType: "user",
      actorId: "u",
    })
    expect(r.ok).toBe(false)
  })

  it("token_* events can have null signerId", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "token_verified_failed",
      actorType: "system",
      actorId: null,
    })
    expect(r.ok).toBe(true)
  })

  it("token_verified_ok CAN have a signerId (verification identified the signer)", () => {
    const r = buildAuditEvent({
      ...baseInput,
      signerId: "sig_1",
      eventType: "token_verified_ok",
      actorType: "signer",
      actorId: "sig_1",
    })
    expect(r.ok).toBe(true)
  })

  it("rejects envelope_* event with a stray signerId (architect-pass fix)", () => {
    // Architect-pass-1 closed the dead-code drift by making
    // ENVELOPE_EVENT_TYPES actually enforce: envelope-scoped events
    // must NOT carry a signerId. Slice-2 timeline reads filter by
    // signerId; a stray reference would corrupt those.
    const r = buildAuditEvent({
      ...baseInput,
      signerId: "should_not_be_here",
      eventType: "envelope_created",
      actorType: "user",
      actorId: "u",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/envelope-scoped/)
  })

  it("accepts envelope_* event with signerId omitted (null default)", () => {
    const r = buildAuditEvent({
      ...baseInput,
      eventType: "envelope_completed",
      actorType: "system",
      actorId: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.record.signerId).toBeNull()
  })
})

/* ─── Post-architect fixes (pass-1 closes) ────────────────────────────── */

describe("M6 — signature-validator (post-architect)", () => {
  it("falls back to default when an individual limit is undefined", () => {
    // Suggestion-coverage: if caller passes `limits: { maxSvgPathChars: undefined }`,
    // the spread keeps the default. Validate with a 49,999-char path
    // (under default 50,000) — should pass.
    const r = validateSignaturePayload({
      method: "drawn",
      payload: {
        svgPath: "x".repeat(DEFAULT_SIGNATURE_LIMITS.maxSvgPathChars - 1),
        widthPx: 100,
        heightPx: 100,
      },
      limits: { maxSvgPathChars: undefined as unknown as number },
    })
    expect(r.ok).toBe(true)
  })
})

/* ─── Registry drift guards ───────────────────────────────────────────── */

describe("M6 — registry drift guards", () => {
  it("ENVELOPE_STATUSES exactly 7", () => {
    expect(ENVELOPE_STATUSES).toHaveLength(7)
  })

  it("SIGNER_STATUSES exactly 6", () => {
    expect(SIGNER_STATUSES).toHaveLength(6)
  })

  it("SIGNER_ROLES exactly 3", () => {
    expect(SIGNER_ROLES).toEqual(["signer", "cc", "copy"])
  })

  it("SIGNATURE_METHODS exactly 3", () => {
    expect(SIGNATURE_METHODS).toEqual(["drawn", "typed", "uploaded"])
  })

  it("AUDIT_EVENT_TYPES exactly 14 (added envelope_declined in Slice 2 hardening)", () => {
    // FIX 6: envelope_declined added alongside envelope_voided so that
    // signer-triggered declines are audited with the correct semantic event.
    expect(AUDIT_EVENT_TYPES).toHaveLength(14)
    expect(AUDIT_EVENT_TYPES).toContain("envelope_declined")
    expect(AUDIT_EVENT_TYPES).toContain("envelope_voided")
  })

  it("AUDIT_ACTOR_TYPES exactly 3 (user/signer/system)", () => {
    expect(AUDIT_ACTOR_TYPES).toEqual(["user", "signer", "system"])
  })

  it("ENVELOPE_TRANSITIONS covers every status", () => {
    for (const s of ENVELOPE_STATUSES) {
      expect(ENVELOPE_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("SIGNER_TRANSITIONS covers every status", () => {
    for (const s of SIGNER_STATUSES) {
      expect(SIGNER_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("DEFAULT_SIGNATURE_LIMITS are all positive", () => {
    expect(DEFAULT_SIGNATURE_LIMITS.maxSvgPathChars).toBeGreaterThan(0)
    expect(DEFAULT_SIGNATURE_LIMITS.maxTypedNameChars).toBeGreaterThan(0)
    expect(DEFAULT_SIGNATURE_LIMITS.maxWidthPx).toBeGreaterThan(0)
    expect(DEFAULT_SIGNATURE_LIMITS.maxHeightPx).toBeGreaterThan(0)
    expect(DEFAULT_SIGNATURE_LIMITS.maxFontSlugChars).toBeGreaterThan(0)
  })
})
