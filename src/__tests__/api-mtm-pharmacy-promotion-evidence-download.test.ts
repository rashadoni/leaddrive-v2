import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context: unknown) => handler(req, {
      orgId: "org-1",
      userId: "manager-user",
      role: "member",
      email: "manager@example.com",
      name: "Manager",
      agentId: "manager-1",
      principal: "web",
    }, context),
}))

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}))

import { GET as downloadEvidence } from "@/app/api/v1/mtm/pharmacy-promotion-executions/[id]/evidence/[evidenceId]/download/route"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const CONTENT = Buffer.from("proof")
const CONTENT_HASH = createHash("sha256").update(CONTENT).digest("hex")

function request() {
  return new NextRequest(
    "http://localhost/api/v1/mtm/pharmacy-promotion-executions/execution-1/evidence/evidence-1/download",
  )
}

function params() {
  return { params: Promise.resolve({ id: "execution-1", evidenceId: "evidence-1" }) }
}

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    contentHash: CONTENT_HASH,
    document: {
      id: "document-1",
      fileName: "proof.txt",
      mimeType: "text/plain",
      sizeBytes: CONTENT.byteLength,
      checksumSha256: CONTENT_HASH,
      storageKey: "a".repeat(48),
      deletedAt: null,
    },
    ...overrides,
  }
}

describe("SWM-09 pharmacy promotion evidence download integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["agent-1"],
    })
    vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValue(evidenceRow() as never)
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: CONTENT.byteLength } as never)
    vi.mocked(readFile).mockResolvedValue(CONTENT as never)
    vi.mocked(prisma.mtmDocumentAssignment.updateMany).mockResolvedValue({ count: 1 } as never)
  })

  it("serves bytes only when size and every persisted checksum match", async () => {
    const response = await downloadEvidence(request(), params())

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT)
    expect(response.headers.get("Content-Length")).toBe(String(CONTENT.byteLength))
    expect(prisma.mtmDocumentAssignment.updateMany).toHaveBeenCalledOnce()
  })

  it("fails closed for same-size tampering and does not mark the document downloaded", async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from("troof") as never)

    const response = await downloadEvidence(request(), params())

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error: "Evidence file failed integrity verification",
      code: "MTM_PHARMACY_EVIDENCE_INTEGRITY_MISMATCH",
    })
    expect(prisma.mtmDocumentAssignment.updateMany).not.toHaveBeenCalled()
  })

  it("fails closed when the document checksum disagrees with the evidence hash", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValue(evidenceRow({
      document: {
        ...evidenceRow().document,
        checksumSha256: "0".repeat(64),
      },
    }) as never)

    const response = await downloadEvidence(request(), params())

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_EVIDENCE_INTEGRITY_MISMATCH" })
    expect(prisma.mtmDocumentAssignment.updateMany).not.toHaveBeenCalled()
  })

  it("uses the immutable evidence content hash when a legacy document checksum is absent", async () => {
    vi.mocked(prisma.mtmPharmacyPromotionEvidence.findFirst).mockResolvedValue(evidenceRow({
      document: { ...evidenceRow().document, checksumSha256: null },
    }) as never)

    const response = await downloadEvidence(request(), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmDocumentAssignment.updateMany).toHaveBeenCalledOnce()
  })
})
