import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteContext = { params: Promise<{ id: string }> }
type RouteHandler = (req: NextRequest, auth: AuthContext, context: RouteContext) => Promise<Response>

const deps = vi.hoisted(() => ({
  registrations: [] as Array<{ module: string; action: string }>,
  replay: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (module: string, action: string, handler: RouteHandler) => {
    deps.registrations.push({ module, action })
    return (req: NextRequest, context: RouteContext) => handler(
      req,
      { orgId: "org-1", userId: "user-1", role: "manager" },
      context,
    )
  },
}))

vi.mock("@/lib/prisma", () => ({ logAudit: deps.logAudit }))
vi.mock("@/lib/social/ingest-envelope-replay", () => ({ replayIngestEnvelope: deps.replay }))

import { POST } from "@/app/api/v1/social/ingest-envelopes/[id]/replay/route"

function request() {
  return new NextRequest("http://localhost/api/v1/social/ingest-envelopes/envelope-1/replay", { method: "POST" })
}

function context(id = "envelope-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.replay.mockResolvedValue({
    status: "REPLAYED",
    envelopeId: "envelope-1",
    mentionId: "mention-1",
    created: true,
  })
})

describe("POST /api/v1/social/ingest-envelopes/[id]/replay", () => {
  it("replays only inside the authenticated organization and writes an audit event", async () => {
    const response = await POST(request(), context())

    expect(response.status).toBe(200)
    expect(deps.replay).toHaveBeenCalledWith("org-1", "envelope-1")
    expect(deps.logAudit).toHaveBeenCalledWith(
      "org-1",
      "replay",
      "ingest_envelope",
      "envelope-1",
      "REPLAYED",
    )
  })

  it("maps tenant-scoped misses to 404", async () => {
    deps.replay.mockRejectedValue(new Error("Ingest envelope not found"))
    const response = await POST(request(), context("missing"))
    expect(response.status).toBe(404)
    expect(deps.logAudit).not.toHaveBeenCalled()
  })

  it("maps non-replayable envelopes to a conflict", async () => {
    deps.replay.mockRejectedValue(new Error("Ingest envelope is not eligible for replay"))
    const response = await POST(request(), context())
    expect(response.status).toBe(409)
  })

  it("uses the social write permission gate", () => {
    expect(deps.registrations).toContainEqual({ module: "social", action: "write" })
  })

  it("does not finish the fenced route before the audit write settles", async () => {
    let releaseAudit!: () => void
    const auditPending = new Promise<void>((resolve) => {
      releaseAudit = resolve
    })
    deps.logAudit.mockReturnValueOnce(auditPending)

    let settled = false
    const responsePromise = POST(request(), context()).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(deps.logAudit).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    releaseAudit()
    await expect(responsePromise).resolves.toMatchObject({ status: 200 })
  })
})
