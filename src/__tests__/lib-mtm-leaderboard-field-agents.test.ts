/**
 * The MTM board ranks field employees only (owner, 2026-10-16, from a
 * picture). On prod Zeytun's board put two managers second and third with 0
 * points, above the one field agent who had not visited yet. The employees
 * are held in memory and filtered by the very `where` the reader builds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { computeMtmRankings, readMtmLeaderboardNotRanked } from "@/lib/leaderboard/mtm"
import { prisma } from "@/lib/prisma"
import { matchesPrismaWhere } from "./mocks/prisma-where"

const ORG = "org-1"
const PEOPLE = [
  { id: "seymur", organizationId: ORG, name: "Seymur Məmmədov", avatar: null, role: "AGENT", status: "ACTIVE" },
  { id: "rashad", organizationId: ORG, name: "Rashad Rahimov", avatar: null, role: "AGENT", status: "ACTIVE" },
  { id: "togrul", organizationId: ORG, name: "Togrul", avatar: null, role: "MANAGER", status: "ACTIVE" },
  { id: "saida", organizationId: ORG, name: "Saida Qojayeva", avatar: null, role: "MANAGER", status: "ACTIVE" },
  { id: "boss", organizationId: ORG, name: "Admin", avatar: null, role: "ADMIN", status: "ACTIVE" },
  { id: "gone", organizationId: ORG, name: "Former Agent", avatar: null, role: "AGENT", status: "INACTIVE" },
  // Office staff (Personnel) are not MTM's people: neither ranked nor named.
  { id: "hr", organizationId: ORG, name: "Office Clerk", avatar: null, role: "EMPLOYEE", status: "ACTIVE" },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findMany).mockImplementation((async (args: { where: Record<string, unknown>; orderBy?: { name: "asc" } }) => {
    const rows = PEOPLE.filter((row) => matchesPrismaWhere(row, args.where))
    return args.orderBy ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows
  }) as never)
  vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([{ agentId: "seymur", _count: 3 }] as never)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
})

describe("the MTM leaderboard", () => {
  it("ranks the active field agents only — no administrator, manager or former agent", async () => {
    const rankings = await computeMtmRankings(ORG, new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-16T12:00:00.000Z"))

    expect(rankings.map((row) => [row.rank, row.name, row.score])).toEqual([
      [1, "Seymur Məmmədov", 30],
      [2, "Rashad Rahimov", 0],
    ])
  })

  it("names who it leaves out, so nobody wonders where the managers went", async () => {
    expect(await readMtmLeaderboardNotRanked(ORG)).toEqual(["Admin", "Saida Qojayeva", "Togrul"])
  })
})
