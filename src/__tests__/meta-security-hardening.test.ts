import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

/**
 * Second hardening pass over the Meta surfaces (2026-09-20).
 *
 * The first pass added a partial unique index covering whatsapp/facebook/instagram inbound rows and
 * taught the WhatsApp and Facebook handlers to treat the resulting P2002 as "already ingested". It
 * did NOT teach the Instagram handler, which had only a read-then-skip guard. That combination is
 * worse than either alone: the index makes a concurrent redelivery throw, the Instagram handler has
 * no catch, the error unwinds to a POST handler that answers Meta 200 — so every remaining message
 * in that delivery is dropped and never redelivered.
 *
 * The lesson generalises, and is why this file checks the *set* rather than the individual handlers:
 * a constraint added centrally has to be handled at every site it now governs, and "every site" is
 * discoverable from the migration, not from memory.
 */

const INBOUND_INSERT_SITES = [
  "src/app/api/v1/webhooks/whatsapp/route.ts",
  "src/app/api/v1/webhooks/facebook/route.ts",
  "src/app/api/v1/webhooks/instagram/route.ts",
] as const

describe("every handler the idempotency index governs can survive it", () => {
  it("the index covers exactly the three Meta channels", () => {
    const sql = readFileSync(
      "prisma/migrations/20260920160000_meta_inbound_idempotency/migration.sql",
      "utf8",
    )
    for (const ch of ["whatsapp", "facebook", "instagram"]) {
      expect(sql, `${ch} must be in the index predicate`).toContain(`'${ch}'`)
    }
  })

  it.each(INBOUND_INSERT_SITES)("%s handles a duplicate insert instead of aborting the batch", file => {
    const src = readFileSync(file, "utf8")
    expect(src, "must import the duplicate detector").toContain("isDuplicateInsert")
    // `continue` and not `return`: the point is that the REST of the delivery still gets processed.
    expect(src).toMatch(/if \(isDuplicateInsert\(e\)\) \{[\s\S]{0,300}?continue/)
    // A non-duplicate error must still propagate — swallowing everything would hide real failures.
    expect(src).toMatch(/isDuplicateInsert\(e\)[\s\S]{0,300}?throw e/)
  })

  it("a Meta webhook never answers non-2xx on a duplicate, so Meta does not retry into a loop", () => {
    for (const file of INBOUND_INSERT_SITES) {
      const src = readFileSync(file, "utf8")
      expect(src, `${file} must answer 200 on handled errors`).toMatch(/NextResponse\.json\(\{ ok: true \}\)/)
    }
  })
})

/**
 * Credential disclosure through logs and error trackers.
 *
 * `instagram-login.ts` carries the tenant's Instagram-Login token as a URL query parameter, which is
 * the shape Meta's token endpoints require. That is contained while the value stays in the process —
 * but a thrown fetch error can carry the request URL, and this project ships errors to Sentry, a
 * named subprocessor. So the module redacts everything it logs.
 */
describe("tokens cannot reach logs or Sentry", () => {
  it("redacts an access token carried in a URL", () => {
    const leaked = "TypeError: fetch failed for https://graph.instagram.com/v21.0/me/messages?access_token=IGQVJsecretvalue123"
    const safe = redactOAuthProviderText(leaked)
    expect(safe).not.toContain("IGQVJsecretvalue123")
    expect(safe).toContain("[REDACTED]")
  })

  it("redacts a client_secret and a refresh token too", () => {
    const safe = redactOAuthProviderText(
      "client_secret=abc123secret&refresh_token=r3fr3shsecret&grant_type=ig_refresh_token",
    )
    expect(safe).not.toContain("abc123secret")
    expect(safe).not.toContain("r3fr3shsecret")
    // Non-credential parameters must survive, or the log stops being useful.
    expect(safe).toContain("grant_type=ig_refresh_token")
  })

  it("instagram-login routes every log line through the redactor", () => {
    const src = readFileSync("src/lib/social/instagram-login.ts", "utf8")
    const logCalls = src.match(/console\.(log|warn|error)\([^\n]*/g) || []
    expect(logCalls.length, "expected this module to log at all").toBeGreaterThan(0)
    for (const call of logCalls) {
      // Either the value is already a literal template with only status codes, or it is wrapped.
      const interpolatesAValue = /,\s*(e|err|error|await res\.text\(\))/.test(call)
      if (interpolatesAValue) {
        expect(call, `unredacted log: ${call}`).toContain("safeLogValue(")
      }
    }
  })

  it("the Facebook send path uses a bearer header, not a token in the URL", () => {
    // The contrast that makes the rule concrete: this module already does it the safe way, which is
    // why it needs no query-parameter redaction on the request side.
    const src = readFileSync("src/lib/facebook.ts", "utf8")
    expect(src).toContain("Authorization: `Bearer ${pageAccessToken}`")
    expect(src).not.toMatch(/me\/messages\?access_token=/)
  })

  it("provider error bodies are redacted before they are logged", () => {
    const src = readFileSync("src/lib/facebook.ts", "utf8")
    expect(src).not.toMatch(/console\.error\([^)]*,\s*await res\.text\(\)\)/)
    expect(src).toContain("redactOAuthProviderText(await res.text())")
  })

  it("the page-subscribe call keeps the token out of the URL", () => {
    const src = readFileSync("src/lib/social/meta-subscribe.ts", "utf8")
    expect(src).toContain("access_token: pageAccessToken")
    expect(src).not.toMatch(/subscribed_apps\?[^`"']*access_token=/)
  })
})

/**
 * OAuth state. These are the properties the callbacks actually enforce; the residual gap
 * (the state is not single-use) is stated in docs/meta-app-review-security-answers.md rather than
 * asserted here, because a test cannot record an absence honestly.
 */
describe("OAuth state integrity", () => {
  it.each([
    "src/app/api/v1/social/oauth/facebook/callback/route.ts",
    "src/app/api/v1/social/oauth/instagram/callback/route.ts",
  ])("%s compares cookie and state, and verifies the signature in constant time", file => {
    const src = readFileSync(file, "utf8")
    // Both present => they must be identical. Without this the cookie adds no CSRF value at all.
    expect(src).toMatch(/cookieVal && cookieVal !== state/)
    expect(src).toContain("state_mismatch")
    expect(src).toContain("timingSafeEqual")
    // Length check before timingSafeEqual — it throws on a length mismatch, which would otherwise
    // turn a malformed signature into a 500 instead of a clean rejection.
    expect(src).toMatch(/a\.length !== b\.length/)
  })
})

/**
 * Credential rotation. The UI contract is "leave a field blank to keep the stored value", and the
 * form honours it by sending `undefined`. The API boundary did not: `z.string().optional()` accepts
 * an empty string, which was spread straight into the update and overwrote a live credential with
 * "". Both a webhook signature check and an OAuth token exchange fail closed on an empty secret, so
 * the damage surfaced later and looked like "messages stopped arriving", not like a bad request.
 */
describe("a blank credential means keep, never wipe", () => {
  const CREDENTIAL_FIELDS = ["botToken", "apiKey", "appSecret", "accessToken", "verifyToken"] as const

  /** Mirrors the guard in the PUT handler, so the rule itself is executed rather than grepped. */
  function applyBlankGuard(payload: Record<string, unknown>): Record<string, unknown> {
    const d = { ...payload }
    for (const field of CREDENTIAL_FIELDS) {
      if (typeof d[field] === "string" && (d[field] as string).trim() === "") delete d[field]
    }
    return d
  }

  it.each(CREDENTIAL_FIELDS)("drops an empty %s so the stored value survives", field => {
    const out = applyBlankGuard({ [field]: "", configName: "Renamed" })
    expect(out).not.toHaveProperty(field)
    expect(out.configName).toBe("Renamed")
  })

  it("drops a whitespace-only credential too", () => {
    expect(applyBlankGuard({ appSecret: "   " })).not.toHaveProperty("appSecret")
  })

  it("passes a real rotation through untouched", () => {
    const out = applyBlankGuard({ appSecret: "NEW_SECRET_VALUE" })
    expect(out.appSecret).toBe("NEW_SECRET_VALUE")
  })

  it("does not touch non-credential fields that may legitimately be cleared", () => {
    const out = applyBlankGuard({ displayName: "", pageId: "" })
    expect(out.displayName).toBe("")
    expect(out.pageId).toBe("")
  })

  it("the PUT handler actually applies the guard", () => {
    const src = readFileSync("src/app/api/v1/channels/[id]/route.ts", "utf8")
    expect(src).toMatch(/for \(const field of \["botToken", "apiKey", "appSecret", "accessToken", "verifyToken"\]/)
    expect(src).toMatch(/delete d\[field\]/)
  })

  it("deliberate clearing still exists, on DELETE", () => {
    const src = readFileSync("src/app/api/v1/channels/[id]/route.ts", "utf8")
    const block = src.slice(src.indexOf('["facebook", "instagram", "whatsapp"].includes'))
    expect(block).toContain("appSecret: null")
    expect(block).toContain('action: "disconnect"')
  })
})
