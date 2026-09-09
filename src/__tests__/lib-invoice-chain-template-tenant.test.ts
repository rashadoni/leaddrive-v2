import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdateMany: vi.fn(),
  journeyFindFirst: vi.fn(),
  journeyCreate: vi.fn(),
  stepCreateMany: vi.fn(),
}))

const tx = {
  invoice: {
    findFirst: mocks.invoiceFindFirst,
    updateMany: mocks.invoiceUpdateMany,
  },
  journey: {
    findFirst: mocks.journeyFindFirst,
    create: mocks.journeyCreate,
  },
  journeyStep: { createMany: mocks.stepCreateMany },
}

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}))

import { getOrCreateInvoiceChainJourney } from "@/lib/invoice-chain-template"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  )
  mocks.journeyCreate.mockResolvedValue({ id: "journey-new" })
  mocks.stepCreateMany.mockResolvedValue({ count: 7 })
  mocks.invoiceUpdateMany.mockResolvedValue({ count: 1 })
})

describe("invoice-chain template tenant ownership", () => {
  it("rejects a foreign or missing invoice before creating a Journey", async () => {
    mocks.invoiceFindFirst.mockResolvedValue(null)

    await expect(
      getOrCreateInvoiceChainJourney("foreign-invoice", "org-1"),
    ).rejects.toThrow("Invoice not found")

    expect(mocks.invoiceFindFirst).toHaveBeenCalledWith({
      where: { id: "foreign-invoice", organizationId: "org-1" },
      select: { chainJourneyId: true, invoiceNumber: true, documentLanguage: true },
    })
    expect(mocks.journeyCreate).not.toHaveBeenCalled()
    expect(mocks.invoiceUpdateMany).not.toHaveBeenCalled()
  })

  it("reuses a chain only when the Journey belongs to the same org", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      chainJourneyId: "journey-existing",
      invoiceNumber: "INV-1",
      documentLanguage: "en",
    })
    mocks.journeyFindFirst.mockResolvedValue({ id: "journey-existing" })

    const result = await getOrCreateInvoiceChainJourney("invoice-1", "org-1")

    expect(result).toBe("journey-existing")
    expect(mocks.journeyFindFirst).toHaveBeenCalledWith({
      where: { id: "journey-existing", organizationId: "org-1" },
      select: { id: true },
    })
    expect(mocks.journeyCreate).not.toHaveBeenCalled()
  })

  it("replaces an invalid chain pointer with a tenant-owned Journey atomically", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      chainJourneyId: "foreign-journey",
      invoiceNumber: "INV-1",
      documentLanguage: "en",
    })
    mocks.journeyFindFirst.mockResolvedValue(null)

    const result = await getOrCreateInvoiceChainJourney("invoice-1", "org-1")

    expect(result).toBe("journey-new")
    expect(mocks.journeyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1" }),
    })
    expect(mocks.invoiceUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "invoice-1",
        organizationId: "org-1",
        chainJourneyId: "foreign-journey",
      },
      data: { chainJourneyId: "journey-new" },
    })
  })
})
