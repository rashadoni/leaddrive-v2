import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Finding F-34 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * The 2026-08 pentest closed rate limiting on the endpoints it happened to
 * probe — public/leads, portal login, registration. It did not close the class,
 * and the class is "anyone on the internet can make this write a row, send an
 * email, or run bcrypt, as fast as they like".
 *
 * This gate lists the unauthenticated WRITE endpoints. Read-only public
 * endpoints are deliberately absent: throttling a storefront or a branding
 * lookup buys little and breaks pages, so the line is drawn at side effects.
 */

const MUST_LIMIT: Array<[string, string]> = [
  ["src/app/api/v1/public/leads/route.ts", "writes a lead and runs assignment rules"],
  ["src/app/api/v1/public/form-submit/route.ts", "writes a lead and runs assignment rules"],
  ["src/app/api/v1/public/forms/[slug]/submit/route.ts", "writes a submission and records touchpoints"],
  ["src/app/api/v1/public/portal-auth/route.ts", "runs bcrypt on every attempt"],
  ["src/app/api/v1/public/portal-auth/register/route.ts", "sends mail to an address the caller names"],
  ["src/app/api/v1/public/portal-auth/set-password/route.ts", "runs bcrypt and sets a portal credential"],
  ["src/app/api/v1/public/events/[id]/register/route.ts", "takes an event seat and can send mail to an address the caller names"],
  ["src/app/api/v1/public/surveys/[slug]/route.ts", "writes a survey response"],
  ["src/app/api/v1/public/web-chat/session/route.ts", "opens a chat session and can create a contact"],
]

/**
 * The second half of the class, found by the 2026-08 re-test: a limiter whose
 * key the caller controls is not a limiter. nginx APPENDS to x-forwarded-for
 * (`proxy_add_x_forwarded_for`), so element [0] is whatever the client sent —
 * key a bucket on it and every request gets its own allowance. Same for a bare
 * cf-connecting-ip read: the origin is reachable directly on its public
 * address, so a caller who skips Cloudflare sets that header themselves.
 *
 * clientIp() (src/lib/request-ip.ts) reads x-real-ip, which nginx sets from
 * $remote_addr, and promotes cf-connecting-ip only when the peer is inside a
 * published Cloudflare range. Recording a raw header as evidence is fine;
 * DECIDING on one is not, which is why this looks at limiter lines only.
 */
const RAW_HEADER_KEY = /(?:checkRateLimit|consumePublicRateLimit|reservePublicAction)\s*\(([^)]*)\)/g

/** Either limiter counts: the in-memory one, or the Redis-backed public guard. */
const LIMITERS = ["checkRateLimit", "consumePublicRateLimit"]

describe("unauthenticated write endpoints have a ceiling", () => {
  it.each(MUST_LIMIT)("%s is rate limited (%s)", (path, why) => {
    const source = readFileSync(path, "utf8")
    const found = LIMITERS.filter(l => source.includes(l))
    expect(
      found.length,
      `${path} takes an unauthenticated request that ${why}, with no limiter. ` +
      `Use consumePublicRateLimit from @/lib/public-abuse-guard, as public/leads does.`,
    ).toBeGreaterThan(0)
  })

  it.each(MUST_LIMIT.map(([path]) => path))("%s does not key its limiter on a caller-controlled header", path => {
    const source = readFileSync(path, "utf8")

    // Collect the identifiers each limiter call decides on, then prove none of
    // them was assigned straight out of a request header.
    const keyed = [...source.matchAll(RAW_HEADER_KEY)].map(m => m[1])
    const suspect = new Set<string>()
    for (const args of keyed) {
      for (const name of args.matchAll(/\b([a-zA-Z_$][\w$]*)\b/g)) {
        const decl = new RegExp(`(?:const|let)\\s+${name[1]}\\s*(?::[^=]+)?=\\s*[^\\n]*headers\\.get\\(`)
        if (decl.test(source)) suspect.add(name[1])
      }
    }

    expect(
      [...suspect],
      `${path} keys a rate limiter on a value read straight from a request header. ` +
      `Use clientIp(req) from @/lib/request-ip instead — x-forwarded-for[0] and ` +
      `cf-connecting-ip are both caller-controlled.`,
    ).toEqual([])
  })

  it.each([
    "src/app/api/v1/public/form-submit/route.ts",
    "src/app/api/v1/public/forms/[slug]/submit/route.ts",
  ])("%s refuses rather than opens when the limiter cannot answer", path => {
    // An abuse guard that fails open is the first thing an attacker knocks over.
    // public/leads made this choice under the pentest; these follow it.
    const source = readFileSync(path, "utf8")
    expect(source).toContain("ipLimit.unavailable")
    expect(source).toContain("503")
  })
})
