import { createHmac, timingSafeEqual } from "crypto"

/**
 * Meta's `signed_request` — the body field of the Deauthorize and Data Deletion callbacks.
 *
 * Format: `<base64url HMAC-SHA256 signature>.<base64url JSON payload>`, signed with the app secret
 * over the ENCODED payload part. Nothing in the payload may be trusted before the signature checks
 * out: these endpoints are public and switch a customer's channel off, so an unsigned or mis-signed
 * request must change nothing at all.
 */
export type MetaSignedRequestPayload = {
  algorithm?: string
  issued_at?: number
  user_id?: string | number
  [key: string]: unknown
}

export function parseMetaSignedRequest(
  signedRequest: string | null | undefined,
  appSecret: string | null | undefined,
): MetaSignedRequestPayload | null {
  if (!signedRequest || !appSecret) return null
  const dot = signedRequest.indexOf(".")
  if (dot <= 0 || dot === signedRequest.length - 1) return null
  const signaturePart = signedRequest.slice(0, dot)
  const payloadPart = signedRequest.slice(dot + 1)

  const expected = createHmac("sha256", appSecret).update(payloadPart).digest()
  const given = Buffer.from(signaturePart, "base64url")
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const record = payload as MetaSignedRequestPayload
  if (String(record.algorithm || "").toUpperCase() !== "HMAC-SHA256") return null
  return record
}

/** The `user_id` of a verified payload as a string, or null when absent. */
export function signedRequestUserId(payload: MetaSignedRequestPayload | null): string | null {
  const raw = payload?.user_id
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw)
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return raw.trim()
  return null
}
