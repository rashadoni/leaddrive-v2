import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, PUT } from "@/app/api/v1/users/me/preferences/route"
import { prisma } from "@/lib/prisma"
import { requireSessionAuth, isAuthError } from "@/lib/api-auth"
import { navItems } from "@/lib/nav-items"

const prismaMock = prisma as unknown as {
  userPreference: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }
}

const makeGet = () => new Request("http://localhost/api/v1/users/me/preferences") as any
const makePut = (body: any) =>
  new Request("http://localhost/api/v1/users/me/preferences", {
    method: "PUT",
    body: JSON.stringify(body),
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSessionAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
  vi.mocked(isAuthError).mockReturnValue(false)
})

describe("GET /api/v1/users/me/preferences", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValue(new NextResponse(null, { status: 401 }) as any)
    vi.mocked(isAuthError).mockImplementation((r: any) => r instanceof NextResponse)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it("returns the caller's stored favorites and recents", async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      favorites: ["/deals"],
      recents: [{ href: "/leads", at: 5 }],
    })
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.favorites).toEqual(["/deals"])
    expect(body.data.recents).toEqual([{ href: "/leads", at: 5 }])
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: "u-1" } })
  })

  it("defaults to empty arrays when no row exists", async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.data).toEqual({ favorites: [], recents: [] })
  })
})

describe("PUT /api/v1/users/me/preferences", () => {
  beforeEach(() => {
    prismaMock.userPreference.upsert.mockImplementation(async (args: any) => ({
      favorites: args.create?.favorites ?? args.update?.favorites ?? [],
      recents: args.create?.recents ?? args.update?.recents ?? [],
    }))
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValue(new NextResponse(null, { status: 401 }) as any)
    vi.mocked(isAuthError).mockImplementation((r: any) => r instanceof NextResponse)
    const res = await PUT(makePut({ favorites: ["/deals"] }))
    expect(res.status).toBe(401)
  })

  it("remaps the legacy /social-monitoring href instead of dropping saved pins", async () => {
    const res = await PUT(makePut({ favorites: ["/deals", "/social-monitoring"] }))
    expect(res.status).toBe(200)
    const call = prismaMock.userPreference.upsert.mock.calls[0][0]
    expect(call.update.favorites).toEqual(["/deals", "/social-monitoring?scope=all&view=overview"])
  })

  it("strips hrefs that aren't real nav destinations", async () => {
    const res = await PUT(makePut({ favorites: ["/deals", "/totally-fake", "/leads"] }))
    expect(res.status).toBe(200)
    const call = prismaMock.userPreference.upsert.mock.calls[0][0]
    expect(call.create.favorites).toEqual(["/deals", "/leads"])
    expect(call.update.favorites).toEqual(["/deals", "/leads"])
    expect(call.where).toEqual({ userId: "u-1" })
    expect(call.create.organizationId).toBe("org-1")
  })

  it("dedupes and caps recents at 12", async () => {
    const validHrefs = navItems.slice(0, 15).map((i) => i.href)
    const recents = validHrefs.map((href, at) => ({ href, at }))
    recents.push({ href: validHrefs[0], at: 99 }) // duplicate
    recents.push({ href: "/fake-route", at: 100 }) // invalid

    const res = await PUT(makePut({ recents }))
    expect(res.status).toBe(200)
    const call = prismaMock.userPreference.upsert.mock.calls[0][0]
    expect(call.create.recents.length).toBe(12)
    expect(call.create.recents.every((r: any) => r.href !== "/fake-route")).toBe(true)
    const dupCount = call.create.recents.filter((r: any) => r.href === validHrefs[0]).length
    expect(dupCount).toBe(1)
  })

  it("rejects a malformed body with 400", async () => {
    const res = await PUT(makePut({ favorites: "not-an-array" }))
    expect(res.status).toBe(400)
  })
})
