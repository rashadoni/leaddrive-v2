// src/lib/webhook-secret.ts
import { timingSafeEqual } from "node:crypto"

/**
 * Shared secret verification for inbound provider webhooks.
 *
 * Finding F-26 (docs/isms/ISMS-02-gap-analysis.md): two webhooks resolved the
 * tenant from a value the caller supplied and verified nothing, so anyone who
 * knew a public group id or an organizationId could write into another
 * tenant's inbox and impersonate their customers.
 *
 * Deliberately mirrors `safeEqual` in src/lib/cron-auth.ts. The two guards
 * protect the same class of endpoint and must not diverge in strength; the
 * gate in src/__tests__/webhook-secret-gate.test.ts is written against THIS
 * module, so keep secret checks here rather than re-inlining them per route.
 */

/**
 * Constant-time compare. A missing side is never a match: an endpoint without a
 * configured secret is unauthenticated, and treating "not configured" as
 * "matches everything" is precisely the defect this closes.
 */
export function webhookSecretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Reads a secret out of a `ChannelConfig.settings` JSON blob. Returns null for
 * anything that is not a non-empty string, so a settings blob holding `true`,
 * `0` or an empty string cannot masquerade as a configured secret.
 */
export function readSettingsSecret(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== "object") return null
  const value = (settings as Record<string, unknown>)[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Pulls a secret out of the request the way providers usually send one: a
 * dedicated header, or a bearer token. The body-carried variant (VK sends
 * `secret` inside the JSON payload) is read by the route itself, because only
 * the route knows the payload shape.
 */
export function readRequestSecret(headers: Headers): string | null {
  const direct = headers.get("x-webhook-secret")
  if (direct) return direct
  const auth = headers.get("authorization")
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length)
  return null
}
