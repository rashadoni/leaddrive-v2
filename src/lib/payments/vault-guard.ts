/**
 * D5 Payments — live-credential vault guard.
 *
 * Enforces D5 slice-2 P0 #2: live payment credentials MUST NOT be stored
 * in plaintext in Postgres until the NamedCredentials vault (Phase 5 N17)
 * is wired. This module is the single source of truth for the detection
 * logic — imported by both the collection and per-id route handlers.
 *
 * ## Provider coverage
 *
 * Stripe — fully covered:
 *   sk_live_*  (secret key)
 *   pk_live_*  (publishable key)
 *   rk_live_*  (restricted key)
 *
 * PayPal, YooKassa, Robokassa — NOT covered by pattern scan.
 *   PayPal live ClientIDs have no guaranteed "test"/"sandbox" substring;
 *   YooKassa and Robokassa similarly lack universal live-key prefixes.
 *   For these providers the `isTestMode: false` guard is the primary line
 *   of defence. Operators MUST NOT set `isTestMode: true` while supplying
 *   production credentials for non-Stripe providers.
 *
 *   When extending to cover these providers in slice-2, add their
 *   production-environment indicators here and update the type list.
 *
 * ## Removal note
 * When the vault is wired: delete this file, remove imports in route handlers,
 * and update the route docblocks. The credential write path should then
 * encrypt via NamedCredentials before writing to `PaymentProvider.credentials`.
 */
import { NextResponse } from "next/server"

/**
 * Regex patterns that indicate a live (production) key is present.
 * Matched against every string value in the credentials JSON tree.
 *
 * Note: `webhookSecret` is intentionally NOT included here — Stripe webhook
 * secrets (`whsec_...`) have no reliable live/test prefix distinction and
 * the column itself is always treated as a secret (excluded from list
 * responses, redacted in single-GET response).
 */
export const LIVE_KEY_PATTERNS: RegExp[] = [
  /sk_live_/i,  // Stripe secret key (live)
  /pk_live_/i,  // Stripe publishable key (live)
  /rk_live_/i,  // Stripe restricted key (live)
]

/**
 * Deep-scan a credentials JSON object for live-key patterns.
 * Returns a truncated sample of the first matching string if found, null otherwise.
 *
 * Safety: depth is capped at 6 to avoid stack issues on adversarial input;
 * deeply-nested live keys would only slip through if an operator is actively
 * trying to circumvent the guard, which the `isTestMode` check still catches.
 */
export function findLiveKeyPattern(obj: unknown, depth = 0): string | null {
  if (depth > 6) return null
  if (typeof obj === "string") {
    for (const pat of LIVE_KEY_PATTERNS) {
      if (pat.test(obj)) return obj.slice(0, 12) + "..."
    }
    return null
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findLiveKeyPattern(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      const hit = findLiveKeyPattern(val, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Enforce the vault guard. Returns a 403 Response if:
 *   1. `isTestMode` is false (live mode — vault not wired yet), OR
 *   2. Live-key patterns are detected in `credentials`.
 *
 * Returns null when the credentials are safe to persist (test-mode + no
 * live-key patterns detected in scan).
 *
 * Called with the EFFECTIVE values (existing row merged with PATCH delta)
 * so switching an existing test provider to live is also caught.
 */
export function rejectLiveCredentials(
  isTestMode: boolean,
  credentials: unknown,
): NextResponse | null {
  if (!isTestMode) {
    return NextResponse.json(
      {
        error:
          "Live-mode payment providers (isTestMode: false) cannot be configured " +
          "until the NamedCredentials vault is wired (D5 slice-2 P0). " +
          "Use isTestMode: true with test/sandbox credentials.",
        code: "VAULT_NOT_WIRED",
      },
      { status: 403 },
    )
  }
  const liveKey = findLiveKeyPattern(credentials)
  if (liveKey) {
    return NextResponse.json(
      {
        error:
          `Live key detected in credentials (${liveKey}). ` +
          "Live credentials cannot be stored until the NamedCredentials vault is wired. " +
          "Use test/sandbox keys (sk_test_*, sandbox client IDs, etc.).",
        code: "LIVE_KEY_DETECTED",
      },
      { status: 403 },
    )
  }
  return null
}
