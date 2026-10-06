/**
 * GET /api/v1/mtm/geocode/reverse — the address under the pin of the
 * organization's map picker (owner, 2026-10-07: the pin moved, the card kept
 * showing the old address). The real route behind the real Route & Field
 * wrapper; authentication, the database and the outside service are stubbed.
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

import { GET } from "@/app/api/v1/mtm/geocode/reverse/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resetGeocodeStateForTests } from "@/lib/mtm/geocode"
import { resetRateLimit } from "@/lib/rate-limit"

const ORG = "org-1"
const USER = "user-manager"
const fetchMock = vi.fn()
const request = (query: string) => new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/geocode/reverse${query}`))

beforeEach(() => {
  vi.clearAllMocks()
  resetGeocodeStateForTests()
  resetRateLimit(`mtm-geocode-reverse:${ORG}:${USER}`)
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
    json: async () => ({ address: { road: "Tbilisi prospekti", house_number: "10", city_district: "Yasamal rayonu", city: "Bakı" } }),
  })
  vi.stubGlobal("fetch", fetchMock)
})

describe("GET /api/v1/mtm/geocode/reverse", () => {
  it("names the address under the pin, split the way the card holds it", async () => {
    const response = await GET(request("?lat=40.397828&lng=49.81699&lang=az"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: { place: { address: "Tbilisi prospekti 10", district: "Yasamal rayonu", city: "Bakı", label: "Tbilisi prospekti 10, Yasamal rayonu, Bakı" } },
    })
    const asked = new URL(String(fetchMock.mock.calls[0][0]))
    expect([asked.hostname, asked.pathname, asked.searchParams.get("lat"), asked.searchParams.get("lon"), asked.searchParams.get("accept-language")])
      .toEqual(["nominatim.openstreetmap.org", "/reverse", "40.397828", "49.816990", "az"])
  })

  it("refuses what is not a point, without asking anyone", async () => {
    const answers = []
    for (const query of ["", "?lat=40.4", "?lat=abc&lng=49.8", "?lat=95&lng=49.8", "?lat=0&lng=0"]) {
      const response = await GET(request(query))
      answers.push([response.status, (await response.json()).code])
    }
    expect(answers).toEqual(Array.from({ length: 5 }, () => [400, "MTM_GEOCODE_POINT_INVALID"]))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("answers «no street here» as an empty place, and a service that is down as unavailable", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ address: { city: "Bakı" } }) })
    const empty = await GET(request("?lat=40.1&lng=49.1"))
    expect([empty.status, await empty.json()]).toEqual([200, { success: true, data: { place: null } }])

    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const down = await GET(request("?lat=40.2&lng=49.2"))
    expect([down.status, (await down.json()).code]).toEqual([502, "MTM_GEOCODE_UNAVAILABLE"])
  })

  it("is for signed-in people of an organization that has the module", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await GET(request("?lat=40.397828&lng=49.81699"))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
