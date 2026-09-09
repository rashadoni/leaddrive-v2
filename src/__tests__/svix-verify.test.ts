import { describe, it, expect } from "vitest"
import crypto from "crypto"
import { verifySvixSignature } from "@/lib/svix-verify"

// Build a legit Svix signature the way Resend's dashboard would.
function sign(secret: string, id: string, ts: string, body: string): string {
  const keyB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
  const key = Buffer.from(keyB64, "base64")
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")
  return `v1,${sig}`
}

const SECRET = "whsec_" + Buffer.from("test-signing-secret-that-is-long-enough").toString("base64")
const ID = "msg_2abc123"
const TS = "1745190000"
const BODY = '{"type":"email.delivered","data":{"email_id":"re_xyz"}}'

describe("svix-verify", () => {
  it("accepts a freshly signed request", () => {
    const signature = sign(SECRET, ID, TS, BODY)
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature, rawBody: BODY, secret: SECRET }),
    ).toBe(true)
  })

  it("accepts when secret is passed without the whsec_ prefix (Resend sends both forms)", () => {
    const bare = SECRET.replace(/^whsec_/, "")
    const signature = sign(bare, ID, TS, BODY)
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature, rawBody: BODY, secret: bare }),
    ).toBe(true)
  })

  it("accepts when signature header contains multiple key versions (key rotation)", () => {
    const wrong = sign("whsec_" + Buffer.from("another-key").toString("base64"), ID, TS, BODY)
    const right = sign(SECRET, ID, TS, BODY)
    const combined = `${wrong} ${right}`
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature: combined, rawBody: BODY, secret: SECRET }),
    ).toBe(true)
  })

  it("rejects when body has been tampered with after signing", () => {
    const signature = sign(SECRET, ID, TS, BODY)
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature, rawBody: BODY + "tampered", secret: SECRET }),
    ).toBe(false)
  })

  it("rejects when id is replayed with a new body", () => {
    const signature = sign(SECRET, ID, TS, '{"type":"old"}')
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature, rawBody: BODY, secret: SECRET }),
    ).toBe(false)
  })

  it("rejects when signature is signed with a different secret", () => {
    const signature = sign("whsec_" + Buffer.from("different-secret-entirely").toString("base64"), ID, TS, BODY)
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature, rawBody: BODY, secret: SECRET }),
    ).toBe(false)
  })

  it("rejects when any header is missing", () => {
    const signature = sign(SECRET, ID, TS, BODY)
    expect(verifySvixSignature({ id: null, timestamp: TS, signature, rawBody: BODY, secret: SECRET })).toBe(false)
    expect(verifySvixSignature({ id: ID, timestamp: null, signature, rawBody: BODY, secret: SECRET })).toBe(false)
    expect(verifySvixSignature({ id: ID, timestamp: TS, signature: null, rawBody: BODY, secret: SECRET })).toBe(false)
  })

  it("rejects when secret is empty", () => {
    const signature = sign(SECRET, ID, TS, BODY)
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature, rawBody: BODY, secret: "" }),
    ).toBe(false)
  })

  it("rejects signature with unknown version", () => {
    const keyB64 = SECRET.slice("whsec_".length)
    const key = Buffer.from(keyB64, "base64")
    const sig = crypto.createHmac("sha256", key).update(`${ID}.${TS}.${BODY}`).digest("base64")
    const v2Header = `v2,${sig}` // not supported
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature: v2Header, rawBody: BODY, secret: SECRET }),
    ).toBe(false)
  })

  it("rejects garbage in signature header", () => {
    expect(
      verifySvixSignature({ id: ID, timestamp: TS, signature: "not-a-valid-header", rawBody: BODY, secret: SECRET }),
    ).toBe(false)
  })
})
