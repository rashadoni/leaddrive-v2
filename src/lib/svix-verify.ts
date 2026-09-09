import crypto from "crypto"

// Verifies Svix-format webhook signatures used by Resend (and many other SaaS
// providers). Broken out from the webhook route handler so it can be unit-
// tested without bringing Prisma / Next.js into the test environment.
//
// Signature format (from `svix-signature` header):
//   "v1,<base64-sig>"            (single version)
//   "v1,<sigA> v1,<sigB>"         (multiple keys rotated; space-separated)
//
// signed_payload = `${svix-id}.${svix-timestamp}.${rawBody}`
// key = base64-decode(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret)
// expected = HMAC-SHA256(key, signed_payload) → base64
export function verifySvixSignature(params: {
  id: string | null
  timestamp: string | null
  signature: string | null
  rawBody: string
  secret: string
}): boolean {
  const { id, timestamp, signature, rawBody, secret } = params
  if (!id || !timestamp || !signature || !secret) return false
  try {
    const keyB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
    const key = Buffer.from(keyB64, "base64")
    const toSign = `${id}.${timestamp}.${rawBody}`
    const expected = crypto.createHmac("sha256", key).update(toSign).digest("base64")
    for (const part of signature.split(" ")) {
      const [ver, val] = part.split(",")
      if (ver === "v1" && val && timingSafeEquals(val, expected)) return true
    }
    return false
  } catch {
    return false
  }
}

// Constant-time string comparison so we don't leak validation time by character.
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return crypto.timingSafeEqual(ab, bb)
}
