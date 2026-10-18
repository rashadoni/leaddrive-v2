/**
 * The owner hears about a demo request once its address is proven, exactly
 * once, and the prospect's demo never waits on that (owner, 2026-10-18).
 * The claim itself is exercised on a real Postgres in
 * demo-center-db-constraints.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const sendDemoRequestNotification = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: { demoRequest: { updateMany: vi.fn(), findUnique: vi.fn() } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
}))
vi.mock("@/lib/demo-center/email", () => ({ sendDemoRequestNotification }))
vi.mock("@/lib/constants", () => ({ COMPANY_EMAIL: "owner@example.test" }))

import { prisma } from "@/lib/prisma"
import { confirmDemoRequestEmail } from "@/lib/demo-center/email-confirmation"

const NOW = new Date("2026-10-18T10:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.demoRequest.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue({
    id: "request-1",
    name: "Nigar Əliyeva",
    company: "Xəzər Logistika MMC",
    email: "nigar@xezer.az",
    phone: "+994501234567",
    jobTitle: null,
    message: null,
    requestedModules: ["crm"],
  } as never)
  sendDemoRequestNotification.mockResolvedValue({ success: true, messageId: "owner-1" })
})

describe("confirmDemoRequestEmail", () => {
  it("marks the request and tells the owner, saying the address is confirmed", async () => {
    await expect(confirmDemoRequestEmail("request-1", NOW)).resolves.toBe("confirmed")

    expect(prisma.demoRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "request-1", emailConfirmedAt: null },
      data: { emailConfirmedAt: NOW },
    })
    expect(sendDemoRequestNotification).toHaveBeenCalledTimes(1)
    expect(sendDemoRequestNotification.mock.calls[0][0]).toMatchObject({
      to: "owner@example.test",
      confirmation: "confirmed",
      requestId: "request-1",
      company: "Xəzər Logistika MMC",
      email: "nigar@xezer.az",
    })
  })

  it("tells nobody a second time once the request is confirmed", async () => {
    vi.mocked(prisma.demoRequest.updateMany).mockResolvedValue({ count: 0 })

    await expect(confirmDemoRequestEmail("request-1", NOW)).resolves.toBe("already_confirmed")
    expect(sendDemoRequestNotification).not.toHaveBeenCalled()
  })

  it("keeps the confirmation when the owner's email is not delivered", async () => {
    sendDemoRequestNotification.mockResolvedValue({ success: false, error: "smtp down" })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(confirmDemoRequestEmail("request-1", NOW)).resolves.toBe("confirmed")
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it("never throws into the prospect's demo", async () => {
    vi.mocked(prisma.demoRequest.updateMany).mockRejectedValue(new Error("database unavailable"))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(confirmDemoRequestEmail("request-1", NOW)).resolves.toBe("failed")
    expect(sendDemoRequestNotification).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
