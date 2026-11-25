import { beforeEach, describe, expect, it, vi } from "vitest"

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock("@/lib/email", () => ({ sendEmail }))

import { sendDemoRequestPartnerNotification } from "@/lib/demo-center/email"

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ success: true })
})

describe("partner notice for a demo request from her site", () => {
  it("says which site, which company and when — nothing about the person", async () => {
    await sendDemoRequestPartnerNotification({
      to: "partner@example.az",
      site: "biznesdoktoru.az",
      company: "Acme <MMC>",
      at: new Date("2026-11-25T08:05:00Z"),
    })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const mail = sendEmail.mock.calls[0][0]
    expect(mail.to).toBe("partner@example.az")
    expect(mail.subject).toBe("biznesdoktoru.az — yeni demo sorğusu")
    // a reply must not reach the prospect: the partner only gets a heads-up
    expect(mail).not.toHaveProperty("replyTo")
    expect(mail.html).toContain("biznesdoktoru.az")
    expect(mail.html).toContain("Acme &lt;MMC&gt;")
    // 08:05 UTC is 12:05 in Baku
    expect(mail.html).toContain("12:05")
    expect(mail.html).toContain("25.11.2026")
    for (const label of ["E-poçt", "Telefon", "Vəzifə", "Mesaj", "Ad<"]) {
      expect(mail.html).not.toContain(label)
    }
    expect(mail.html).not.toMatch(/@/u)
  })
})
