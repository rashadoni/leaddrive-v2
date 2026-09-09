/**
 * C9 #16 — sms-click + ad-click tracking redirects.
 *
 * Both record a touchpoint when the click is tied to a known contact (c=campaign,
 * k=contact, contact in the campaign's org), SSRF-guard the url, and 302 to the
 * original. Anonymous clicks (no k) just redirect.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn() },
    webTrackingConfig: { findUnique: vi.fn() },
  },
}))
vi.mock("@/lib/url-validation", () => ({ isPrivateUrl: vi.fn(() => false) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn(() => Promise.resolve()) }))
vi.mock("@/lib/marketing-attribution/touchpoint-recorder", () => ({
  recordTouchpointsSafe: vi.fn(),
  touchpointSourceKey: {
    smsClicked: (c: string, k: string) => `sms:${c}:${k}:clicked`,
    adClick: (c: string, k: string) => `ad:${c}:${k}:click`,
  },
}))

import { GET as smsClick } from "@/app/api/v1/tracking/sms-click/route"
import { GET as adClick } from "@/app/api/v1/tracking/ad-click/route"
import { prisma } from "@/lib/prisma"
import { isPrivateUrl } from "@/lib/url-validation"
import { recordTouchpointsSafe } from "@/lib/marketing-attribution/touchpoint-recorder"
import { IDENTITY_TOKEN_PARAM, verifyIdentityToken } from "@/lib/web-tracking"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any
const LANDING = "https://shop.example.com/promo"
const reqFor = (path: string, qs: string) => new NextRequest(`http://localhost/api/v1/tracking/${path}?${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isPrivateUrl).mockReturnValue(false)
  pr.campaign.findUnique.mockResolvedValue({ id: "cam1", organizationId: "org-1" })
  pr.contact.findFirst.mockResolvedValue({ id: "c1" })
  // Default: org has no web tracking → no identity token on the redirect.
  pr.webTrackingConfig.findUnique.mockResolvedValue(null)
})

describe.each([
  { name: "sms-click", GET: smsClick, channel: "sms", type: "sms_clicked", key: "sms:cam1:c1:clicked" },
  { name: "ad-click", GET: adClick, channel: "ad", type: "ad_click", key: "ad:cam1:c1:click" },
])("C9 #16 — $name redirect", ({ GET, channel, type, key }) => {
  const ok = `c=cam1&k=c1&url=${encodeURIComponent(LANDING)}`

  it("records the touchpoint for a known contact + 302s to the url", async () => {
    const res = await GET(reqFor("x", ok))
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(LANDING)
    expect(recordTouchpointsSafe).toHaveBeenCalledTimes(1)
    const [org, rows] = vi.mocked(recordTouchpointsSafe).mock.calls[0]
    expect(org).toBe("org-1")
    expect(rows[0]).toMatchObject({ contactId: "c1", campaignId: "cam1", channel, touchpointType: type, sourceKey: key })
  })

  it("anonymous click (no k) just redirects, no touchpoint", async () => {
    const res = await GET(reqFor("x", `c=cam1&url=${encodeURIComponent(LANDING)}`))
    expect(res.status).toBe(302)
    expect(recordTouchpointsSafe).not.toHaveBeenCalled()
  })

  it("records nothing when the contact isn't in the campaign's org (forged k)", async () => {
    pr.contact.findFirst.mockResolvedValue(null)
    const res = await GET(reqFor("x", ok))
    expect(res.status).toBe(302)
    expect(recordTouchpointsSafe).not.toHaveBeenCalled()
  })

  it("400 on a private/SSRF url, no redirect", async () => {
    vi.mocked(isPrivateUrl).mockReturnValue(true)
    const res = await GET(reqFor("x", "c=cam1&k=c1&url=http://169.254.169.254/"))
    expect(res.status).toBe(400)
    expect(recordTouchpointsSafe).not.toHaveBeenCalled()
  })

  it("400 when url is missing", async () => {
    const res = await GET(reqFor("x", "c=cam1&k=c1"))
    expect(res.status).toBe(400)
  })

  // C2 identity stitching — the redirect hands the landing page a signed
  // `_ldi` token when (and only when) the org has web tracking enabled.
  it("appends a verifiable _ldi token when web tracking is enabled", async () => {
    pr.webTrackingConfig.findUnique.mockResolvedValue({ enabled: true })
    const res = await GET(reqFor("x", ok))
    expect(res.status).toBe(302)
    const target = new URL(res.headers.get("location")!)
    const token = target.searchParams.get(IDENTITY_TOKEN_PARAM)
    expect(verifyIdentityToken(token)).toEqual({ organizationId: "org-1", contactId: "c1" })
    // the original destination is preserved
    expect(target.origin + target.pathname).toBe(LANDING)
  })

  it("no _ldi token when web tracking is disabled or unconfigured", async () => {
    pr.webTrackingConfig.findUnique.mockResolvedValue({ enabled: false })
    const res = await GET(reqFor("x", ok))
    expect(res.headers.get("location")).toBe(LANDING)
  })

  it("no _ldi token for an anonymous click even with tracking enabled", async () => {
    pr.webTrackingConfig.findUnique.mockResolvedValue({ enabled: true })
    const res = await GET(reqFor("x", `c=cam1&url=${encodeURIComponent(LANDING)}`))
    expect(res.headers.get("location")).toBe(LANDING)
  })
})
