import { createHash, randomInt, timingSafeEqual } from "node:crypto"
import { generateOneTimeToken, hashOneTimeToken } from "@/lib/one-time-token"

const DEMO_SESSION_COOKIE_PREFIX = "ld_demo_session_"
const DEMO_VERIFICATION_COOKIE_PREFIX = "ld_demo_verified_"
export const DEMO_OTP_TTL_MS = 10 * 60 * 1000
export const DEMO_VERIFICATION_TTL_MS = 15 * 60 * 1000
export const DEMO_OTP_RESEND_COOLDOWN_MS = 60 * 1000
export const DEMO_MAX_OTP_ATTEMPTS = 5
export const DEMO_MAX_OTP_SENDS = 5

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function emailDomain(value: string): string {
  return normalizeEmail(value).split("@").at(-1) || ""
}

export function maskEmail(value: string): string {
  const normalized = normalizeEmail(value)
  const [local = "", domain = ""] = normalized.split("@")
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`
}

/**
 * Masks a phone for display inside the demo. The prospect must recognise
 * their own number without the full one being rendered into a page that can
 * be screenshotted or shared: the country prefix and the last two digits
 * stay, everything between them is replaced.
 */
export function maskPhone(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 6) return null
  const prefix = trimmed.startsWith("+") ? `+${digits.slice(0, 3)}` : digits.slice(0, 3)
  const tail = digits.slice(-2)
  return `${prefix} ${"•".repeat(Math.max(3, digits.length - prefix.replace("+", "").length - 2))} ${tail}`
}

export function issueCapabilityToken(): { token: string; tokenHash: string; tokenHint: string } {
  const pair = generateOneTimeToken()
  return { ...pair, tokenHint: pair.token.slice(-6) }
}

export function issueBrowserCredential(): { credential: string; credentialHash: string } {
  const { token, tokenHash } = generateOneTimeToken()
  return { credential: token, credentialHash: tokenHash }
}

export function hashCredential(value: string): string {
  return hashOneTimeToken(value)
}

function demoCookieScope(token: string): string {
  return hashCredential(token).slice(0, 16)
}

export function demoSessionCookieName(token: string): string {
  return `${DEMO_SESSION_COOKIE_PREFIX}${demoCookieScope(token)}`
}

export function demoVerificationCookieName(token: string): string {
  return `${DEMO_VERIFICATION_COOKIE_PREFIX}${demoCookieScope(token)}`
}

export function secureHashMatches(rawValue: string | undefined, storedHash: string | null | undefined): boolean {
  if (!rawValue || !storedHash) return false
  const actual = Buffer.from(hashCredential(rawValue), "hex")
  const expected = Buffer.from(storedHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function generateDemoOtp(): string {
  let code = ""
  for (let index = 0; index < 6; index += 1) code += randomInt(0, 10).toString()
  return code
}

export function anonymizedClientMetadata(request: Request): Record<string, string> {
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) || "unknown"
  return {
    userAgentHash: createHash("sha256").update(userAgent).digest("hex").slice(0, 24),
  }
}

export function cookieSecurityOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  }
}
