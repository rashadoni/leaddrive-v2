import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/api-auth", () => ({ orgHasModule: vi.fn() }))

import { portalContractWhere, waitingForSigner, type EnvelopeForWaiting } from "@/lib/portal-documents"
import { CONTRACT_STATUSES } from "@/lib/contract-lifecycle/types"

/** The counterparty cabinet's rules (src/lib/portal-documents.ts), without a database. */
describe("which contracts are the counterparty's", () => {
  it("its company's, agreed — never a draft, one in approval, rejected or cancelled", () => {
    const where = portalContractWhere("org-1", "co-1", "c1")
    expect(where).toEqual({ organizationId: "org-1", companyId: "co-1", id: "c1", status: { in: expect.any(Array) } })
    // every lifecycle status is decided: a new one must be added to one side on purpose
    const hidden = CONTRACT_STATUSES.filter((s) => !where.status.in.includes(s))
    expect(hidden).toEqual(["draft", "pending_approval", "rejected", "cancelled"])
    expect(where.status.in.every((s) => (CONTRACT_STATUSES as readonly string[]).includes(s))).toBe(true)
  })
})

describe("what waits for this person's signature", () => {
  const env = (over: Partial<EnvelopeForWaiting> = {}): EnvelopeForWaiting => ({
    id: "env-1", status: "sent", subject: "AKT № 1", sentAt: new Date("2026-12-01"), expiresAt: null, documentId: null,
    contract: { id: "c1", contractNumber: "AS/1", title: "Alğı-satqı" }, document: null,
    signers: [
      { id: "s-ours", email: "r@nümunə.az", role: "signer", status: "sent", order: 1 },
      { id: "s-farid", email: " F@Kaspi.AZ ", role: "signer", status: "viewed", order: 2 },
    ],
    ...over,
  })
  const now = new Date("2026-12-02")

  it("finds the person by e-mail, any case; the contract's own title for the contract", () => {
    expect(waitingForSigner([env()], "f@kaspi.az", now)).toEqual([
      expect.objectContaining({ signerId: "s-farid", kind: "contract", title: "Alğı-satqı", number: null, canSignNow: false }),
    ])
  })

  it("leaves out an expired, recalled or finished envelope, a copy recipient and a done signature", () => {
    expect(waitingForSigner([env({ expiresAt: new Date("2026-12-01") })], "f@kaspi.az", now)).toEqual([])
    expect(waitingForSigner([env({ status: "voided" }), env({ status: "completed" })], "f@kaspi.az", now)).toEqual([])
    const cc = env({ signers: [{ id: "s-cc", email: "f@kaspi.az", role: "cc", status: "sent", order: 1 }] })
    expect(waitingForSigner([cc], "f@kaspi.az", now)).toEqual([])
    const done = env({ signers: [{ id: "s-farid", email: "f@kaspi.az", role: "signer", status: "signed", order: 1 }] })
    expect(waitingForSigner([done], "f@kaspi.az", now)).toEqual([])
  })

  it("a document envelope is named by its subject and kind; may be signed once earlier signers have", () => {
    const doc = env({
      documentId: "act-1", document: { kind: "acceptance_act", number: 3 },
      signers: [
        { id: "s-ours", email: "r@x.az", role: "signer", status: "signed", order: 1 },
        { id: "s-farid", email: "f@kaspi.az", role: "signer", status: "sent", order: 2 },
      ],
    })
    expect(waitingForSigner([doc], "f@kaspi.az", now)).toEqual([
      expect.objectContaining({ kind: "acceptance_act", number: 3, title: "AKT № 1", canSignNow: true }),
    ])
  })
})
