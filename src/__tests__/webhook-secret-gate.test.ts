import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { readSettingsSecret, webhookSecretMatches } from "@/lib/webhook-secret"

/**
 * Gate for finding F-26 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * Two inbound webhooks resolved the tenant from a caller-supplied value and
 * verified nothing: `vkontakte` trusted a PUBLIC VK group id, `sms-inbound`
 * trusted an `orgId` query parameter. Either let a stranger write into another
 * tenant's inbox and impersonate their customers.
 *
 * Fixing the two files fixes two files. This test fixes the class: a new
 * webhook that forgets verification fails CI instead of shipping.
 *
 * The gate is deliberately shallow — it proves a verification mechanism is
 * REFERENCED, not that it is used correctly. A grep cannot judge correctness.
 * What it does buy is that "we forgot entirely", which is what actually
 * happened twice, can no longer happen silently.
 */

const WEBHOOK_DIRS = [
  "src/app/api/v1/webhooks",
  "src/app/api/v1/payment-webhooks",
]

/** Any one of these counts as verifying the caller. */
const VERIFICATION_MARKERS = [
  "webhookSecretMatches",   // the shared helper — preferred
  "timingSafeEqual",        // hand-rolled constant-time compare
  "x-hub-signature",        // Meta HMAC
  "x-telegram-bot-api-secret-token",
  "webhookSecret",          // per-channel secret read from settings
  "verifySignature",
  "svix",
]

/**
 * Routes here are NOT inbound provider webhooks despite living under the
 * directory: they are the CRM's own CRUD for managing outbound webhooks and
 * carry ordinary session auth. Adding to this list requires stating why the
 * route needs no provider verification.
 */
const EXEMPT = new Map<string, string>([
  ["webhooks/manage/route.ts", "operator CRUD for outbound webhooks — withRlsSessionAuth"],
  ["webhooks/manage/[id]/route.ts", "operator CRUD for outbound webhooks — withRlsSessionAuth"],
])

function collectRoutes(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectRoutes(full, out)
    else if (entry === "route.ts") out.push(full)
  }
  return out
}

describe("inbound webhooks verify their caller", () => {
  const routes = WEBHOOK_DIRS.flatMap(d => collectRoutes(d))

  it("finds the webhook routes at all", () => {
    // Guards against the gate silently passing because a path was renamed.
    expect(routes.length).toBeGreaterThanOrEqual(10)
  })

  it.each(routes)("%s verifies a secret or signature", route => {
    const key = route.replace(/^src\/app\/api\/v1\//, "")
    const exemption = EXEMPT.get(key)
    if (exemption) {
      expect(exemption.length).toBeGreaterThan(0)
      return
    }

    const source = readFileSync(route, "utf8")
    const found = VERIFICATION_MARKERS.filter(m => source.includes(m))

    expect(
      found.length,
      `${key} references no verification mechanism. An inbound webhook that does ` +
      `not verify its caller lets anyone who knows a tenant identifier write into ` +
      `that tenant's data. Use webhookSecretMatches from @/lib/webhook-secret, or ` +
      `add an entry to EXEMPT with a reason if this route is not a provider webhook.`
    ).toBeGreaterThan(0)
  })

  it("rejects secret reuse with the cron secret", () => {
    // F-27: the meeting-recap webhook used to fall back to CRON_SECRET, handing
    // a third-party transcription provider the credential that authenticates
    // every background job.
    //
    // Two precision choices, both learned by watching this assertion misfire:
    //
    // Comments are stripped, because the fix is documented in a comment that
    // quotes the removed expression verbatim, and a gate that cannot tell an
    // explanation from code would forbid explaining itself.
    //
    // The match is `env.CRON_SECRET`, not the bare name, because the route
    // legitimately NAMES the variable in the operator-facing error telling them
    // it is no longer accepted. Forbidding the word would forbid the warning.
    const code = readFileSync("src/app/api/v1/webhooks/meeting-recap/route.ts", "utf8")
      .split("\n")
      .filter(line => {
        const t = line.trim()
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
      })
      .join("\n")
    expect(code).not.toContain("env.CRON_SECRET")
  })
})

describe("webhookSecretMatches", () => {
  it("matches an identical secret", () => {
    expect(webhookSecretMatches("s3cret", "s3cret")).toBe(true)
  })

  it("rejects a different secret of the same length", () => {
    expect(webhookSecretMatches("aaaaaa", "bbbbbb")).toBe(false)
  })

  it("rejects a different length without throwing", () => {
    // timingSafeEqual throws on length mismatch — the length guard must come first.
    expect(webhookSecretMatches("short", "considerably-longer")).toBe(false)
  })

  // The whole point: "no secret configured" must never mean "everything matches".
  it("rejects when either side is missing or empty", () => {
    expect(webhookSecretMatches(null, "expected")).toBe(false)
    expect(webhookSecretMatches("provided", null)).toBe(false)
    expect(webhookSecretMatches("", "")).toBe(false)
    expect(webhookSecretMatches(undefined, undefined)).toBe(false)
  })
})

describe("readSettingsSecret", () => {
  it("reads a non-empty string", () => {
    expect(readSettingsSecret({ secret: "abc" }, "secret")).toBe("abc")
  })

  it("treats non-strings and empty strings as unconfigured", () => {
    expect(readSettingsSecret({ secret: "" }, "secret")).toBeNull()
    expect(readSettingsSecret({ secret: true }, "secret")).toBeNull()
    expect(readSettingsSecret({ secret: 0 }, "secret")).toBeNull()
    expect(readSettingsSecret({}, "secret")).toBeNull()
    expect(readSettingsSecret(null, "secret")).toBeNull()
    expect(readSettingsSecret("not-an-object", "secret")).toBeNull()
  })
})
