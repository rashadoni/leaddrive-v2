import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const orgFindFirst = vi.hoisted(() => vi.fn())
const executeRaw = vi.hoisted(() => vi.fn(() => ({ op: "features" })))
const divisionFindMany = vi.hoisted(() => vi.fn())
const pipelineFindMany = vi.hoisted(() => vi.fn())
const pipelineCount = vi.hoisted(() => vi.fn())
const pipelineUpdateMany = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn(async (ops: unknown[]) => ops))
const logAudit = vi.hoisted(() => vi.fn(async () => {}))
const auth = vi.hoisted(() => ({ current: { orgId: "org-1", userId: "user-1", role: "admin" } }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: orgFindFirst },
    $executeRaw: executeRaw,
    division: { findMany: divisionFindMany },
    pipeline: { findMany: pipelineFindMany, count: pipelineCount, updateMany: pipelineUpdateMany },
    $transaction: transaction,
  },
  logAudit,
}))

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: (req: NextRequest, ctx: { orgId: string }) => unknown) =>
    (req: NextRequest) => handler(req, { orgId: auth.current.orgId }),
  withRlsAuth: (
    _module: string,
    _action: string,
    handler: (req: NextRequest, a: typeof auth.current) => unknown,
  ) => (req: NextRequest) => handler(req, auth.current),
}))

import { GET, PUT } from "@/app/api/v1/settings/call-tasks/route"

/** What the atomic flag-replacement helper was told to do. */
function rawCall() {
  const values = executeRaw.mock.calls[0].slice(1)
  const [prefixes, additions] = values as [string[], string[]]
  return { prefixes: prefixes.map((p) => p.replace(/%$/, "")), additions }
}

function put(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/settings/call-tasks", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("GET/PUT /api/v1/settings/call-tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.current = { orgId: "org-1", userId: "user-1", role: "admin" }
    orgFindFirst.mockResolvedValue({ features: ["salesBoard:div-1", "commitmentDueDays:5", "other"] })
    divisionFindMany.mockResolvedValue([{ id: "div-1", name: "Görüşlər" }])
    pipelineFindMany.mockResolvedValue([{ id: "pipe-1", name: "Retail", taskBoardId: null }])
    pipelineCount.mockResolvedValue(1)
    pipelineUpdateMany.mockReturnValue({ op: "pipeline" })
  })

  it("reports the tenant's current choices with the lists to choose from", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/v1/settings/call-tasks"))
    const body = await res.json()
    expect(body.data).toMatchObject({
      boardId: "div-1",
      dueDays: 5,
      defaultDueDays: 2,
      boards: [{ id: "div-1" }],
      pipelines: [{ id: "pipe-1" }],
    })
  })

  it("falls back to the default window when the tenant has chosen none", async () => {
    orgFindFirst.mockResolvedValue({ features: ["salesBoard:div-1"] })
    const body = await (await GET(new NextRequest("http://localhost:3000/api/v1/settings/call-tasks"))).json()
    expect(body.data.dueDays).toBe(2)
  })

  it("saves both values in one atomic statement", async () => {
    const res = await PUT(put({ boardId: "div-1", dueDays: 7 }))
    expect(res.status).toBe(200)
    const { prefixes, additions } = rawCall()
    expect(additions).toEqual(["salesBoard:div-1", "commitmentDueDays:7"])
    // Rewriting the whole array in JS would lose a flag another request wrote
    // in the meantime — and that array also carries module entitlements.
    expect(prefixes).toContain("salesBoard:")
    expect(prefixes).toContain("commitmentDueDays:")
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it("clears the board for real, including the legacy inbox flag", async () => {
    orgFindFirst.mockResolvedValue({ features: ["inboxLeadQualificationBoard:div-old"] })
    await PUT(put({ boardId: null, dueDays: 3 }))
    const { prefixes, additions } = rawCall()
    expect(additions).toEqual(["commitmentDueDays:3"])
    // salesBoardId() falls back to the legacy flag, so leaving it behind would
    // keep filing tasks on the board the admin just cleared.
    expect(prefixes).toContain("inboxLeadQualificationBoard:")
  })

  it("never offers a board that has been archived", async () => {
    orgFindFirst.mockResolvedValue({ features: ["salesBoard:div-archived"] })
    pipelineFindMany.mockResolvedValue([{ id: "pipe-1", name: "Retail", taskBoardId: "div-archived" }])
    const body = await (await GET(new NextRequest("http://localhost:3000/api/v1/settings/call-tasks"))).json()
    // Echoing a dead id back would make every later save fail validation with
    // an error the operator cannot connect to any field on the page.
    expect(body.data.boardId).toBeNull()
    expect(body.data.pipelines[0].taskBoardId).toBeNull()
  })

  it("routes a pipeline to its own board", async () => {
    await PUT(put({ boardId: "div-1", dueDays: 2, pipelineBoards: { "pipe-1": "div-1" } }))
    expect(pipelineUpdateMany).toHaveBeenCalledWith({
      where: { id: "pipe-1", organizationId: "org-1" },
      data: { taskBoardId: "div-1" },
    })
  })

  it("refuses a board that is not this tenant's own", async () => {
    divisionFindMany.mockResolvedValue([])
    const res = await PUT(put({ boardId: "div-elsewhere", dueDays: 2 }))
    expect(res.status).toBe(400)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("refuses a window outside the allowed range", async () => {
    for (const dueDays of [0, 31, 2.5]) {
      const res = await PUT(put({ boardId: null, dueDays }))
      expect(res.status, `dueDays=${dueDays}`).toBe(400)
    }
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("refuses a non-admin even if the permission matrix ever lets them through", async () => {
    auth.current = { orgId: "org-1", userId: "user-2", role: "manager" }
    const res = await PUT(put({ boardId: "div-1", dueDays: 2 }))
    expect(res.status).toBe(403)
    expect(executeRaw).not.toHaveBeenCalled()
  })
})
