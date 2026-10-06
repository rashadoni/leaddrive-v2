/**
 * GET /api/v1/mtm/geocode — the address search of the organization's map
 * picker (owner, 2026-10-06). The route is the real one behind the real
 * Route & Field wrapper; only authentication, the database and the outside
 * service are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/geocode/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resetGeocodeStateForTests } from "@/lib/mtm/geocode"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const USER = "user-manager"
const fetchMock = vi.fn()

const request = (query: string) =>
  new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/geocode${query}`))
const asked = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)))

beforeEach(() => {
  vi.clearAllMocks()
  resetGeocodeStateForTests()
  resetRateLimit(`mtm-geocode:${ORG}:${USER}`)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Manager",
  })
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true },
  } as never)
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [{ lat: "40.3978284", lon: "49.8169901", display_name: "Tbilisi prospekti, Bakı" }],
  })
  vi.stubGlobal("fetch", fetchMock)
})

describe("GET /api/v1/mtm/geocode", () => {
  it("finds an address and answers with points the picker can place", async () => {
    const response = await GET(request("?q=Tbilisi%20prospekti&lang=az&lat=40.4&lng=49.8"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: { results: [{ label: "Tbilisi prospekti, Bakı", latitude: 40.397828, longitude: 49.81699 }] },
    })
    expect(asked().map((url) => [url.hostname, url.searchParams.get("q"), url.searchParams.get("accept-language"), url.searchParams.has("viewbox")]))
      .toEqual([["nominatim.openstreetmap.org", "Tbilisi prospekti", "az", true]])
  })

  it("tidies what was typed and falls back to English for a language it does not offer", async () => {
    await GET(request("?q=%20%20Nizami%20%20%20kucesi%20%205%20&lang=tr"))
    expect(asked().map((url) => [url.searchParams.get("q"), url.searchParams.get("accept-language"), url.searchParams.has("viewbox")]))
      .toEqual([["Nizami kucesi 5", "en", false]])
  })

  it("refuses a search that is no address, without asking anyone", async () => {
    const statuses = []
    for (const query of ["", "?q=", "?q=%20a%20", `?q=${"a".repeat(201)}`]) {
      const response = await GET(request(query))
      statuses.push([response.status, (await response.json()).code])
    }
    expect(statuses).toEqual(Array.from({ length: 4 }, () => [400, "MTM_GEOCODE_QUERY_INVALID"]))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("is for signed-in people of an organization that has the module", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await GET(request("?q=Tbilisi%20prospekti"))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("says the search is unavailable when the outside service is, instead of an empty list", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const response = await GET(request("?q=Tbilisi%20prospekti"))
    expect([response.status, (await response.json()).code]).toEqual([502, "MTM_GEOCODE_UNAVAILABLE"])
  })

  it("answers «nothing found» as an empty list, not as a failure", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    const response = await GET(request("?q=zzzz%20qqqq"))
    expect([response.status, await response.json()]).toEqual([200, { success: true, data: { results: [] } }])
  })

  it("stops one person from searching more than twenty times a minute", async () => {
    // The same address each time: the service is asked once, the limit still counts.
    const statuses = []
    for (let attempt = 0; attempt < 21; attempt += 1) statuses.push((await GET(request("?q=Tbilisi%20prospekti"))).status)
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
