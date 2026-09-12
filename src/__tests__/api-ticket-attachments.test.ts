import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  ticketFindFirst: vi.fn(),
  attachmentCount: vi.fn(),
  attachmentFindMany: vi.fn(),
  attachmentFindFirst: vi.fn(),
  attachmentCreate: vi.fn(),
  attachmentDeleteMany: vi.fn(),
  rateLimit: vi.fn(),
  validateBytes: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findFirst: mocks.ticketFindFirst },
    ticketAttachment: {
      count: mocks.attachmentCount,
      findMany: mocks.attachmentFindMany,
      findFirst: mocks.attachmentFindFirst,
      create: mocks.attachmentCreate,
      deleteMany: mocks.attachmentDeleteMany,
    },
  },
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }))
vi.mock("@/lib/upload-security", () => ({ validateUploadBytes: mocks.validateBytes }))
vi.mock("@/lib/runtime-paths", () => ({ runtimePublicUploadDirectory: () => "/runtime/uploads/tickets" }))
vi.mock("fs/promises", () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile, unlink: mocks.unlink }))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: unknown) => handler,
}))

import { GET, POST } from "@/app/api/v1/tickets/[id]/files/route"
import { DELETE } from "@/app/api/v1/tickets/[id]/files/[fileId]/route"

const context = { params: Promise.resolve({ id: "ticket-1" }) }
const deleteContext = { params: Promise.resolve({ id: "ticket-1", fileId: "file-1" }) }
const auth = { orgId: "org-1", userId: "user-1", role: "support" }
const getHandler = GET as unknown as (
  request: NextRequest,
  authContext: typeof auth,
  routeContext: typeof context,
) => Promise<Response>
const postHandler = POST as unknown as typeof getHandler
const deleteHandler = DELETE as unknown as (
  request: NextRequest,
  authContext: typeof auth,
  routeContext: typeof deleteContext,
) => Promise<Response>

function requestWithFile(file: File) {
  const data = new FormData()
  data.set("file", file)
  return new NextRequest("http://localhost/api/v1/tickets/ticket-1/files", { method: "POST", body: data })
}

describe("ticket attachment API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rateLimit.mockReturnValue(true)
    mocks.validateBytes.mockReturnValue(null)
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.unlink.mockResolvedValue(undefined)
    mocks.ticketFindFirst.mockResolvedValue({ id: "ticket-1", status: "open" })
    mocks.attachmentCount.mockResolvedValue(0)
    mocks.attachmentDeleteMany.mockResolvedValue({ count: 1 })
  })

  it("lists only files after verifying the tenant-scoped ticket", async () => {
    mocks.attachmentFindMany.mockResolvedValue([{ id: "file-1" }])
    const response = await getHandler(new NextRequest("http://localhost/api/v1/tickets/ticket-1/files"), auth, context)

    expect(response.status).toBe(200)
    expect(mocks.ticketFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "ticket-1", organizationId: "org-1" },
    }))
    expect(mocks.attachmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ticketId: "ticket-1", organizationId: "org-1" },
    }))
  })

  it("rejects uploads on closed tickets before reading file bytes", async () => {
    mocks.ticketFindFirst.mockResolvedValue({ id: "ticket-1", status: "closed" })
    const response = await postHandler(requestWithFile(new File(["hello"], "note.txt", { type: "text/plain" })), auth, context)

    expect(response.status).toBe(409)
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("rejects a MIME and extension mismatch through content validation", async () => {
    mocks.validateBytes.mockReturnValue("File content does not match its declared type")
    const response = await postHandler(requestWithFile(new File(["not a png"], "image.png", { type: "image/png" })), auth, context)

    expect(response.status).toBe(400)
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it("stores a random filename and a tenant-owned pending record", async () => {
    mocks.attachmentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "file-1", commentId: null, ...data }))
    const response = await postHandler(requestWithFile(new File(["hello"], "note.txt", { type: "text/plain" })), auth, context)

    expect(response.status).toBe(201)
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/runtime\/uploads\/tickets\/[0-9a-f]{32}\.txt$/),
      expect.any(Buffer),
      { flag: "wx" },
    )
    expect(mocks.attachmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: "org-1",
      ticketId: "ticket-1",
      originalName: "note.txt",
      uploadedBy: "user-1",
    }) })
  })

  it("only removes the caller's pending tenant-owned attachment", async () => {
    mocks.attachmentFindFirst.mockResolvedValue({ id: "file-1", fileName: "0123456789abcdef0123456789abcdef.pdf" })
    const response = await deleteHandler(new NextRequest("http://localhost/api/v1/tickets/ticket-1/files/file-1", { method: "DELETE" }), auth, deleteContext)

    expect(response.status).toBe(200)
    expect(mocks.attachmentFindFirst).toHaveBeenCalledWith({ where: {
      id: "file-1",
      ticketId: "ticket-1",
      organizationId: "org-1",
      uploadedBy: "user-1",
      commentId: null,
    } })
    expect(mocks.unlink).toHaveBeenCalledWith("/runtime/uploads/tickets/0123456789abcdef0123456789abcdef.pdf")
  })
})
