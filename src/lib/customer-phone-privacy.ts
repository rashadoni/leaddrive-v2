import { createHmac } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "./api-auth"
import { isAdmin, type Role } from "./permissions"

export const HIDDEN_CUSTOMER_PHONE = "••••••••"
export const CUSTOMER_PHONE_PRIVACY_SETTING = "hideCustomerPhoneForOperators"

export function customerPhonePrivacyEnabled(settings: unknown): boolean {
  return !!settings && typeof settings === "object"
    && (settings as Record<string, unknown>)[CUSTOMER_PHONE_PRIVACY_SETTING] === true
}

// Reuse the existing role model; API integrations retain their own explicit scopes.
// Undefined principalType in legacy session fixtures is treated as a human, never an exemption.
export function isPhoneRestrictedPrincipal(auth: AuthResult | null): boolean {
  return !!auth && auth.principalType !== "api_key" && !isAdmin(auth.role as Role)
}

const PHONE_KEY = /(?:phone|mobile|telephone)|^(?:wa_?id|fromNumber|toNumber)$/i
const PHONE_VALUE = /^\+?[\d\s().-]{7,30}$/
const PHONE_IN_TEXT = /(?<![\w])\+?\d[\d ().-]{7,25}\d(?![\w])/g
const normalized = (value: string) => value.replace(/\D/g, "")
const isPhone = (value: string) => PHONE_VALUE.test(value) && normalized(value).length >= 7 && normalized(value).length <= 15

function decodedForInspection(value: string): string {
  let result = value
  for (let depth = 0; depth < 2 && /%[0-9a-f]{2}/i.test(result); depth++) {
    try { result = decodeURIComponent(result) } catch { break }
  }
  return result
}

/** Sanitize serialized structured phone fields and recognizable phone aliases in
 * metadata/previews/write responses. Canonical CRM IDs stay usable. Uploaded assets
 * and arbitrary encodings are outside this structured-data policy. */
export function maskCustomerPhones(payload: unknown, orgId: string, secret: string): unknown {
  const candidates = new Set<string>()
  const opaque = (value: string) => `private_${createHmac("sha256", secret).update(`${orgId}:${value}`).digest("hex").slice(0, 24)}`
  function collect(value: unknown, key = "", context = false): void {
    const phoneContext = context || PHONE_KEY.test(key)
    if (typeof value === "string") value = decodedForInspection(value)
    if (typeof value === "string" && isPhone(value) && (phoneContext || /^(from|to|externalId|senderId|recipientId)$/i.test(key))) {
      candidates.add(normalized(value))
    } else if (Array.isArray(value)) {
      value.forEach(item => collect(item, key, phoneContext))
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, item]) => {
        const decodedKey = decodedForInspection(childKey)
        if (isPhone(decodedKey)) candidates.add(normalized(decodedKey))
        collect(item, childKey, phoneContext)
      })
    }
  }
  collect(payload)
  const replaceKnown = [...candidates].sort((a, b) => b.length - a.length)
    .map(phone => new RegExp(`(?<!\\d)\\+?${phone.split("").join("[\\s().-]*")}(?!\\d)`, "g"))
  function visit(value: unknown, key = "", context = false): unknown {
    const phoneContext = context || PHONE_KEY.test(key)
    if (typeof value === "string") {
      const decoded = decodedForInspection(value)
      // UUIDs are record identities, including numeric-only groups that resemble phones.
      if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(decoded)) return value
      if (/^(?:wa_|phone_|whatsapp_)[+\d]/i.test(decoded)) return opaque(value)
      if (phoneContext && isPhone(decoded)) return HIDDEN_CUSTOMER_PHONE
      let result = decoded
      for (const pattern of replaceKnown) result = result.replace(pattern, HIDDEN_CUSTOMER_PHONE)
      result = result.replace(PHONE_IN_TEXT, match => {
        const count = normalized(match).length
        return count >= 10 && count <= 15 ? HIDDEN_CUSTOMER_PHONE : match
      })
      return result === decoded ? value : result
    }
    if (typeof value === "number" && phoneContext) return HIDDEN_CUSTOMER_PHONE
    if (Array.isArray(value)) return value.map(item => visit(item, key, phoneContext))
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [
        visit(childKey) === childKey ? childKey : opaque(childKey),
        visit(item, childKey, phoneContext),
      ]))
    }
    return value
  }
  return visit(payload)
}

/** Must run inside the existing tenant scope, after authorization and before handler execution.
 * All three RLS wrappers share this boundary, including alternate read and JSON write routes.
 * Files/exports cannot be reliably scrubbed; do not generate or expose them to restricted users. */
export async function withCustomerPhonePrivacy(
  req: NextRequest, orgId: string, auth: AuthResult | null, handler: () => Promise<Response> | Response,
): Promise<Response> {
  if (!isPhoneRestrictedPrincipal(auth)) return handler()
  // Authentication resolved this from the fresh organization read, not from a
  // browser/JWT claim. Failed reads deny authentication before this boundary.
  if (auth?.hideCustomerPhoneForOperators !== true) return handler()
  const path = req.nextUrl.pathname
  // URL exports can return a JSON download link, so deny before running them as well.
  if (/(?:exports?|downloads?|prints?)(?:[-_/]|$)|\.(?:csv|xlsx|pdf)\b/i.test(path)) {
    return NextResponse.json({ error: "Exports are unavailable while customer phone privacy is enabled" }, { status: 403 })
  }
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.headers.get("content-type")?.includes("application/json")) {
    const hasMaskedPhoneWrite = (value: unknown, phoneField = false): boolean => {
      if (typeof value === "string") return phoneField && value.includes(HIDDEN_CUSTOMER_PHONE)
      if (Array.isArray(value)) return value.some(item => hasMaskedPhoneWrite(item, phoneField))
      if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => hasMaskedPhoneWrite(item, phoneField || PHONE_KEY.test(key)))
      return false
    }
    const body = await req.clone().json().catch(() => null)
    if (hasMaskedPhoneWrite(body)) return NextResponse.json({ error: "Hidden phone numbers cannot be edited by this user" }, { status: 400 })
  }
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return NextResponse.json({ error: "Privacy settings unavailable" }, { status: 503 })
  const response = await handler()
  if (response.status === 204) return response
  if (response.status === 304) return NextResponse.json({ error: "Reload customer data after a privacy policy change" }, { status: 409, headers: { "cache-control": "private, no-store" } })
  // The inbox stream only sends refresh/count signals; the JSON refresh remains guarded.
  if (path === "/api/v1/inbox/stream" && response.headers.get("content-type")?.includes("text/event-stream")) return response
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel().catch(() => {})
    return NextResponse.json({ error: "This response is unavailable while customer phone privacy is enabled" }, { status: 403 })
  }
  try {
    const headers = new Headers(response.headers)
    headers.delete("content-length")
    headers.delete("etag")
    headers.set("cache-control", "private, no-store")
    headers.set("vary", "Cookie, Authorization")
    // Redirect/download headers can leak recipient query strings independently of JSON.
    headers.delete("location")
    headers.delete("content-disposition")
    return NextResponse.json(maskCustomerPhones(await response.json(), orgId, secret), { status: response.status, headers })
  } catch {
    return NextResponse.json({ error: "Unable to protect customer phone data" }, { status: 503 })
  }
}
