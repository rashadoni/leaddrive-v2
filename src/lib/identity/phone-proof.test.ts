import { describe, expect, it } from "vitest"
import { sealPhoneProof, openPhoneProofDelivery, verifyPhoneProofCode, phoneProofAttemptHash, type PhoneProofContext, type PhoneProofKey } from "./phone-proof"

const context = (): PhoneProofContext => ({ organizationId: "example-company", userId: "example-person", reservationId: "reservation-1", challengeId: "challenge-1",
  normalizedPhone: "+994550001122", accountVersion: 3, credentialEpoch: 2, createdAt: "2026-10-24T20:00:00.000Z", expiresAt: "2026-10-24T20:10:00.000Z" })
const key = (): PhoneProofKey => ({ id: "fixture-key-1", material: new Uint8Array(32).fill(7) })
const at = () => new Date("2026-10-24T20:01:00.000Z")

describe("bound phone-possession proof primitive (no login or provider)", () => {
  it("binds v2 delivery and attempts to canonical issuer authority and durable contact revision", () => {
    const frozen: PhoneProofContext = { ...context(), version: 2, authorityHash: "a".repeat(64), contactRevision: 7 }
    const sealed = sealPhoneProof(frozen, key()), code = openPhoneProofDelivery(frozen, sealed, key(), at())
    expect(sealed.deliveryCiphertext).toMatch(/^v2\./)
    expect(verifyPhoneProofCode(frozen, sealed, key(), code, at())).toBe(true)
    for (const swapped of [{ ...frozen, authorityHash: "b".repeat(64) }, { ...frozen, contactRevision: 8 }, context()]) {
      expect(verifyPhoneProofCode(swapped, sealed, key(), code, at())).toBe(false)
      expect(() => openPhoneProofDelivery(swapped, sealed, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
      expect(phoneProofAttemptHash(swapped, key(), "attempt-v2", code)).not.toBe(phoneProofAttemptHash(frozen, key(), "attempt-v2", code))
    }
    const old = sealPhoneProof(context(), key()), oldCode = openPhoneProofDelivery(context(), old, key(), at())
    expect(verifyPhoneProofCode(frozen, old, key(), oldCode, at())).toBe(false)
    expect(() => openPhoneProofDelivery(frozen, old, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
  })
  it("refuses incomplete or forged v2 contexts", () => {
    for (const fields of [{ version: 2 }, { version: 2, authorityHash: "a".repeat(64), contactRevision: 0 }, { version: 4, authorityHash: "a".repeat(64), contactRevision: 1 }]) {
      expect(() => sealPhoneProof({ ...context(), ...fields } as PhoneProofContext, key())).toThrow("IDENTITY_PROOF_CONTEXT_INVALID")
    }
  })
  it("seals the six-digit secret and returns only keyed hash/ciphertext metadata", () => {
    const input = context(), secret = key(), proof = sealPhoneProof(input, secret)
    expect(Object.keys(proof).sort()).toEqual(["codeHash", "deliveryCiphertext", "keyId"])
    expect(proof.codeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(proof.deliveryCiphertext).toMatch(/^v1\.fixture-key-1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{22}$/)
    const code = openPhoneProofDelivery(input, proof, secret, at())
    expect(code).toMatch(/^\d{6}$/)
    expect(verifyPhoneProofCode(input, proof, secret, code, at())).toBe(true)
    expect(secret.material).toEqual(new Uint8Array(32).fill(7))
    expect(JSON.stringify(proof)).not.toContain(input.normalizedPhone)
  })
  it("does not reuse a deterministic IV when preparing another delivery", () => {
    const first = sealPhoneProof(context(), key()), second = sealPhoneProof(context(), key())
    expect(first.deliveryCiphertext.split(".")[2]).not.toBe(second.deliveryCiphertext.split(".")[2])
  })
  it("rejects incorrect, malformed and non-ASCII codes", () => {
    const proof = sealPhoneProof(context(), key()), code = openPhoneProofDelivery(context(), proof, key(), at())
    const wrong = ((Number(code) + 1) % 1_000_000).toString().padStart(6, "0")
    for (const entered of [wrong, "12345", "1234567", "１２３４５６", "12345\n", code + "\n", code + "\r", "", " 123456"]) expect(verifyPhoneProofCode(context(), proof, key(), entered, at())).toBe(false)
  })
  it.each([
    ["organizationId", "other-company"], ["userId", "other-person"], ["reservationId", "reservation-2"], ["challengeId", "challenge-2"],
    ["normalizedPhone", "+994550009999"], ["accountVersion", 4], ["credentialEpoch", 3],
    ["createdAt", "2026-10-24T20:00:01.000Z"], ["expiresAt", "2026-10-24T20:09:59.000Z"],
  ] as const)("cannot move a proof across %s", (field, value) => {
    const original = context(), proof = sealPhoneProof(original, key()), code = openPhoneProofDelivery(original, proof, key(), at())
    const changed = { ...original, [field]: value }
    expect(verifyPhoneProofCode(changed, proof, key(), code, at())).toBe(false)
    expect(() => openPhoneProofDelivery(changed, proof, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
  })
  it("accepts only its issuance interval and rejects expiry at the exact deadline", () => {
    const input = context(), proof = sealPhoneProof(input, key()), code = openPhoneProofDelivery(input, proof, key(), at())
    expect(verifyPhoneProofCode(input, proof, key(), code, new Date(input.createdAt))).toBe(true)
    expect(verifyPhoneProofCode(input, proof, key(), code, new Date(new Date(input.expiresAt).valueOf() - 1))).toBe(true)
    for (const date of ["2026-10-24T19:59:59.999Z", input.expiresAt, "2026-10-24T20:10:00.001Z"]) {
      expect(verifyPhoneProofCode(input, proof, key(), code, new Date(date))).toBe(false)
      expect(() => openPhoneProofDelivery(input, proof, key(), new Date(date))).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
    }
    expect(() => verifyPhoneProofCode(input, proof, key(), code, new Date("invalid"))).toThrow("IDENTITY_PROOF_CLOCK_INVALID")
  })
  it("does not accept another root or key ID", () => {
    const proof = sealPhoneProof(context(), key()), code = openPhoneProofDelivery(context(), proof, key(), at())
    for (const changed of [{ ...key(), id: "fixture-key-2" }, { ...key(), material: new Uint8Array(32).fill(8) }]) {
      expect(verifyPhoneProofCode(context(), proof, changed, code, at())).toBe(false)
      expect(() => openPhoneProofDelivery(context(), proof, changed, at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
    }
  })
  it("authenticates the key ID even if two configured keys accidentally share root bytes", () => {
    const proof = sealPhoneProof(context(), key()), code = openPhoneProofDelivery(context(), proof, key(), at())
    const renamed = { ...key(), id: "fixture-key-2" }, parts = proof.deliveryCiphertext.split(".")
    parts[1] = renamed.id
    const changed = { ...proof, keyId: renamed.id, deliveryCiphertext: parts.join(".") }
    expect(verifyPhoneProofCode(context(), changed, renamed, code, at())).toBe(false)
    expect(() => openPhoneProofDelivery(context(), changed, renamed, at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
  })
  it("refuses corrupted hash, ciphertext, authentication tag and noncanonical encoding", () => {
    const input = context(), proof = sealPhoneProof(input, key()), code = openPhoneProofDelivery(input, proof, key(), at())
    const fields = proof.deliveryCiphertext.split(".")
    for (const index of [2, 3, 4]) {
      const damaged = [...fields]; damaged[index] = (damaged[index][0] === "A" ? "B" : "A") + damaged[index].slice(1)
      expect(() => openPhoneProofDelivery(input, { ...proof, deliveryCiphertext: damaged.join(".") }, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
    }
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", alias = [...fields]
    alias[4] = alias[4].slice(0, -1) + alphabet[alphabet.indexOf(alias[4].at(-1)!) + 1]
    expect(Buffer.from(alias[4], "base64url")).toEqual(Buffer.from(fields[4], "base64url"))
    expect(() => openPhoneProofDelivery(input, { ...proof, deliveryCiphertext: alias.join(".") }, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
    for (const deliveryCiphertext of [proof.deliveryCiphertext + "=", proof.deliveryCiphertext + ".extra", "x".repeat(129)]) expect(() => openPhoneProofDelivery(input, { ...proof, deliveryCiphertext }, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
    for (const codeHash of ["", "0".repeat(64), "a".repeat(63), "g".repeat(64), proof.codeHash + "\n"]) {
      const damaged = { ...proof, codeHash }
      expect(verifyPhoneProofCode(input, damaged, key(), code, at())).toBe(false)
      expect(() => openPhoneProofDelivery(input, damaged, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
    }
  })
  it("rejects invalid scope, deadline, extra fields and keys without leaking their values", () => {
    for (const changed of [
      { ...context(), normalizedPhone: "0550001122" }, { ...context(), normalizedPhone: "+994 55 0001122" },
      { ...context(), normalizedPhone: null as unknown as string },
      { ...context(), accountVersion: 0 }, { ...context(), credentialEpoch: 2_147_483_648 },
      { ...context(), createdAt: "2026-02-30T20:00:00.000Z" }, { ...context(), expiresAt: "2026-10-24T20:10:00+00:00" },
      { ...context(), expiresAt: context().createdAt }, { ...context(), expiresAt: "2026-10-24T20:10:00.001Z" },
      { ...context(), unintendedSecret: "fixture-extra-secret" },
    ]) expect(() => sealPhoneProof(changed, key())).toThrow("IDENTITY_PROOF_CONTEXT_INVALID")
    for (const changed of [{ ...key(), id: "bad.key" }, { ...key(), id: "fixture-key-1\n" }, { ...key(), material: new Uint8Array(31) }, { ...key(), material: new Uint8Array(33) }]) expect(() => sealPhoneProof(context(), changed)).toThrow("IDENTITY_PROOF_KEY_INVALID")
  })
})

describe("secret-safe proof-attempt idempotency", () => {
  it("binds the exact submitted code and nonce without reusing the code-verification MAC", () => {
    const proof = sealPhoneProof(context(), key()), code = openPhoneProofDelivery(context(), proof, key(), at())
    const hash = phoneProofAttemptHash(context(), key(), "attempt-1", code)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toBe(proof.codeHash)
    expect(phoneProofAttemptHash(context(), key(), "attempt-1", code)).toBe(hash)
    expect(phoneProofAttemptHash(context(), key(), "attempt-2", code)).not.toBe(hash)
    expect(phoneProofAttemptHash(context(), key(), "attempt-1", code + "\n")).not.toBe(hash)
    expect(phoneProofAttemptHash(context(), key(), "attempt-1", "")).not.toBe(hash)
  })
  it("cannot move an attempt receipt to another context or root key", () => {
    const hash = phoneProofAttemptHash(context(), key(), "attempt-1", "123456")
    expect(phoneProofAttemptHash({ ...context(), organizationId: "other-company" }, key(), "attempt-1", "123456")).not.toBe(hash)
    expect(phoneProofAttemptHash({ ...context(), challengeId: "other-challenge" }, key(), "attempt-1", "123456")).not.toBe(hash)
    expect(phoneProofAttemptHash(context(), { ...key(), material: new Uint8Array(32).fill(8) }, "attempt-1", "123456")).not.toBe(hash)
  })
  it("bounds untrusted attempt text and rejects malformed request IDs", () => {
    expect(() => phoneProofAttemptHash(context(), key(), "attempt-1", "x".repeat(65))).toThrow("IDENTITY_PROOF_INPUT_INVALID")
    expect(() => phoneProofAttemptHash(context(), key(), "attempt-1\n", "123456")).toThrow("IDENTITY_REQUEST_INVALID")
  })
})


describe("recovery proof purpose separation", () => {
  it("never reinterprets an invitation as self-recovery or vice versa", () => {
    const recovery: PhoneProofContext = { ...context(), version: 3, authorityHash: "c".repeat(64), contactRevision: 2 }
    const invitation: PhoneProofContext = { ...recovery, version: 2 }
    for (const frozen of [recovery, invitation, context()]) {
      const proof = sealPhoneProof(frozen, key()), code = openPhoneProofDelivery(frozen, proof, key(), at())
      for (const other of [recovery, invitation, context()]) {
        const same = frozen.version === other.version
        expect(verifyPhoneProofCode(other, proof, key(), code, at())).toBe(same)
        if (!same) expect(() => openPhoneProofDelivery(other, proof, key(), at())).toThrow("IDENTITY_PROOF_DELIVERY_REFUSED")
      }
    }
  })
})
