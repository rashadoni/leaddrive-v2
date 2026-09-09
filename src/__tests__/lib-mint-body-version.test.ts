/**
 * Shared body-version mint helper (Slice 1, Step 6).
 *
 * The SHA-binding-critical mint extracted from PUT /body so PUT /body and
 * POST /import-docx mint through one code path. Coverage:
 *   - happy: returns versionNo from create; contentHash === sha256(serialize);
 *     `source` is threaded to ContractVersion.create
 *   - NOT_EDITABLE: CAS updateMany count 0 → BodyVersionConflict("…","NOT_EDITABLE")
 *   - P2002 retry: a unique(contractId,versionNo) race retries and then succeeds
 *   - exhaust: 4 consecutive P2002 → BodyVersionConflict("…","VERSION_CONFLICT")
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "crypto"
import { Prisma } from "@prisma/client"

const mockTransaction = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

import { mintBodyVersion, BodyVersionConflict } from "@/lib/clm/mint-body-version"
import { serializeContractBody } from "@/lib/clm/serialize-body"

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const USER_ID = "user-1"

/** A tx whose updateMany returns `casCount` and whose create echoes versionNo. */
function makeTx(opts: { maxVersion: number | null; casCount: number; captureCreate?: (a: unknown) => void }) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ max: opts.maxVersion }]),
    contractVersion: {
      create: vi.fn().mockImplementation((args: { data: { versionNo: number } }) => {
        opts.captureCreate?.(args)
        return { versionNo: args.data.versionNo }
      }),
    },
    contract: {
      updateMany: vi.fn().mockResolvedValue({ count: opts.casCount }),
    },
  }
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "test",
  })
}

beforeEach(() => vi.clearAllMocks())

describe("mintBodyVersion", () => {
  it("happy: mints version max+1, contentHash = sha256(serialize), threads source", async () => {
    let createArgs: { data: { source: string; versionNo: number; renderedBody: string; contentHash: string } } | null =
      null
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx({ maxVersion: 4, casCount: 1, captureCreate: (a) => (createArgs = a as never) })),
    )

    const cleanHtml = "<h1>Agreement</h1><p>The Buyer pays the Seller.</p>"
    const expectedRendered = serializeContractBody(cleanHtml)
    const expectedHash = createHash("sha256").update(expectedRendered).digest("hex")

    const res = await mintBodyVersion({
      orgId: ORG_ID,
      contractId: CONTRACT_ID,
      cleanHtml,
      source: "import",
      createdBy: USER_ID,
    })

    expect(res.versionNo).toBe(5) // max 4 + 1
    expect(res.contentHash).toBe(expectedHash)
    expect(res.renderedBody).toBe(expectedRendered)
    // source + the SHA-critical fields are threaded into the version row.
    expect(createArgs!.data.source).toBe("import")
    expect(createArgs!.data.versionNo).toBe(5)
    expect(createArgs!.data.renderedBody).toBe(expectedRendered)
    expect(createArgs!.data.contentHash).toBe(expectedHash)
  })

  it("first version when no prior versions exist (MAX = null → 1)", async () => {
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx({ maxVersion: null, casCount: 1 })),
    )
    const res = await mintBodyVersion({
      orgId: ORG_ID,
      contractId: CONTRACT_ID,
      cleanHtml: "<p>First</p>",
      source: "editor",
      createdBy: USER_ID,
    })
    expect(res.versionNo).toBe(1)
  })

  it("NOT_EDITABLE: CAS updateMany count 0 → BodyVersionConflict(NOT_EDITABLE)", async () => {
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx({ maxVersion: 1, casCount: 0 })),
    )
    await expect(
      mintBodyVersion({
        orgId: ORG_ID,
        contractId: CONTRACT_ID,
        cleanHtml: "<p>x</p>",
        source: "editor",
        createdBy: USER_ID,
      }),
    ).rejects.toMatchObject({ code: "NOT_EDITABLE" })
  })

  it("P2002 race retries then succeeds", async () => {
    let calls = 0
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      calls++
      if (calls === 1) throw p2002()
      return cb(makeTx({ maxVersion: 2, casCount: 1 }))
    })
    const res = await mintBodyVersion({
      orgId: ORG_ID,
      contractId: CONTRACT_ID,
      cleanHtml: "<p>retry</p>",
      source: "editor",
      createdBy: USER_ID,
    })
    expect(res.versionNo).toBe(3)
    expect(calls).toBe(2)
  })

  it("exhausting P2002 retries → BodyVersionConflict(VERSION_CONFLICT)", async () => {
    mockTransaction.mockImplementation(async () => {
      throw p2002()
    })
    await expect(
      mintBodyVersion({
        orgId: ORG_ID,
        contractId: CONTRACT_ID,
        cleanHtml: "<p>x</p>",
        source: "editor",
        createdBy: USER_ID,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
    // 4 attempts (0..3) before giving up.
    expect(mockTransaction).toHaveBeenCalledTimes(4)
  })

  it("BodyVersionConflict is an Error subclass with a code", () => {
    const e = new BodyVersionConflict("msg", "NOT_EDITABLE")
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe("NOT_EDITABLE")
    expect(e.name).toBe("BodyVersionConflict")
  })
})
