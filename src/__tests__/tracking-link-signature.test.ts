import { beforeAll, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

beforeAll(() => {
  // The signing key is derived from NEXTAUTH_SECRET; secure-token refuses to
  // fall back in production and these run as test.
  process.env.NEXTAUTH_SECRET ||= "test-secret-for-tracking-links"
})

const load = async () => await import("@/lib/tracking-link")

/**
 * Finding F-29 (docs/isms/ISMS-02-gap-analysis.md): the tracking redirects
 * validated `isPrivateUrl` — which stops SSRF into the internal network — and
 * nothing else. Anyone could mint a link on this product's domain that lands on
 * an arbitrary external page, which is the classic open redirect: the recipient
 * trusts the host, and so do the reputation filters deciding whether mail from
 * that host gets delivered at all.
 */
describe("tracking redirect signatures", () => {
  it("accepts a target it signed", async () => {
    const { signRedirectTarget, redirectTargetSignatureValid } = await load()
    const url = "https://customer.example/landing"
    expect(redirectTargetSignatureValid(url, signRedirectTarget(url))).toBe(true)
  })

  it("rejects a signature issued for a different target", async () => {
    const { signRedirectTarget, redirectTargetSignatureValid } = await load()
    // The attack this exists to stop: keep a valid-looking link and swap where
    // it lands.
    const legit = signRedirectTarget("https://customer.example/landing")
    expect(redirectTargetSignatureValid("https://phishing.example/login", legit)).toBe(false)
  })

  it("rejects a missing or empty signature", async () => {
    const { redirectTargetSignatureValid } = await load()
    expect(redirectTargetSignatureValid("https://customer.example/", null)).toBe(false)
    expect(redirectTargetSignatureValid("https://customer.example/", "")).toBe(false)
    expect(redirectTargetSignatureValid("https://customer.example/", undefined)).toBe(false)
  })

  it("rejects a truncated signature without throwing", async () => {
    // timingSafeEqual throws on length mismatch; the length guard comes first.
    const { signRedirectTarget, redirectTargetSignatureValid } = await load()
    const url = "https://customer.example/landing"
    expect(redirectTargetSignatureValid(url, signRedirectTarget(url).slice(0, 8))).toBe(false)
  })

  it("stays short enough for an SMS body", async () => {
    const { signRedirectTarget } = await load()
    // 64 bits: unforgeable for a redirect authorisation, and 16 characters
    // rather than 64 in every message.
    expect(signRedirectTarget("https://customer.example/")).toMatch(/^[0-9a-f]{16}$/)
  })

  it("appends the signature to a URL that already has a query", async () => {
    const { withSignedRedirect, signRedirectTarget, TRACKING_SIGNATURE_PARAM } = await load()
    const target = "https://customer.example/landing"
    const signed = withSignedRedirect(`https://app.example/api/v1/tracking/click?logId=1&url=x`, target)
    expect(signed).toContain(`&${TRACKING_SIGNATURE_PARAM}=${signRedirectTarget(target)}`)
  })

  it("defaults to permitting unsigned links so delivered campaigns keep working", async () => {
    const { trackingSignatureRequired } = await load()
    delete process.env.TRACKING_REQUIRE_SIGNATURE
    expect(trackingSignatureRequired()).toBe(false)
    process.env.TRACKING_REQUIRE_SIGNATURE = "1"
    expect(trackingSignatureRequired()).toBe(true)
    delete process.env.TRACKING_REQUIRE_SIGNATURE
  })
})

describe("every tracking redirect route verifies the signature", () => {
  // Three routes shared one defect; a fourth would inherit it silently.
  const ROUTES = [
    "src/app/api/v1/tracking/click/route.ts",
    "src/app/api/v1/tracking/sms-click/route.ts",
    "src/app/api/v1/tracking/ad-click/route.ts",
  ]

  it.each(ROUTES)("%s checks the signature before redirecting", route => {
    const source = readFileSync(route, "utf8")
    expect(source).toContain("redirectTargetSignatureValid")
    expect(source).toContain("trackingSignatureRequired")
    // SSRF protection stays — the signature replaces neither half.
    expect(source).toContain("isPrivateUrl")
  })
})

describe("generated links carry a signature", () => {
  it.each([
    ["src/lib/email.ts", "email click wrapper"],
    ["src/app/api/v1/campaigns/[id]/send/route.ts", "campaign SMS link"],
  ])("%s signs its redirect target", path => {
    expect(readFileSync(path, "utf8")).toContain("withSignedRedirect")
  })
})
