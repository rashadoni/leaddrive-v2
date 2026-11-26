import { describe, expect, it } from "vitest"
import {
  paperSignatureRefusal,
  paperSignerUserId,
  parseSignedAt,
  signedCopyExtension,
} from "@/lib/clm/paper-signature"

/** The rules of «Подписан на бумаге» (src/lib/clm/paper-signature.ts). */
describe("who may record a contract as signed on paper", () => {
  it("an approved contract: anyone who may edit contracts", () => {
    for (const role of ["admin", "manager", "sales", "superadmin"]) expect(paperSignatureRefusal("approved", role)).toBeNull()
  })
  it("a draft skips approval: an administrator only", () => {
    expect(paperSignatureRefusal("draft", "admin")).toBeNull()
    expect(paperSignatureRefusal("draft", "superadmin")).toBeNull()
    for (const role of ["manager", "sales", "support", "viewer", undefined, null]) {
      expect(paperSignatureRefusal("draft", role)).toBe("ADMIN_REQUIRED_FOR_DRAFT")
    }
  })
  it("nothing else — in approval, in force or closed", () => {
    for (const status of ["pending_approval", "active", "renewing", "renewed", "expired", "terminated", "rejected", "cancelled"]) {
      expect(paperSignatureRefusal(status, "admin")).toBe("NOT_SIGNABLE")
    }
  })
})

describe("the day on paper", () => {
  const now = new Date("2026-11-26T10:00:00Z")
  it("is a calendar day stored at 00:00 UTC", () => {
    expect(parseSignedAt("2026-11-20", now)).toEqual({ ok: true, date: new Date("2026-11-20T00:00:00Z"), day: "2026-11-20" })
  })
  it("may be today in Baku even when UTC is still on yesterday", () => {
    // 22:30 UTC on 25 November is 02:30 on 26 November in Baku.
    expect(parseSignedAt("2026-11-26", new Date("2026-11-25T22:30:00Z")).ok).toBe(true)
  })
  it("is not in the future", () => {
    expect(parseSignedAt("2026-11-28", now)).toEqual({ ok: false, code: "SIGNED_AT_IN_FUTURE" })
  })
  it("is a real day", () => {
    for (const raw of ["", "2026-02-30", "26.11.2026", "2026-13-01", "1899-01-01", null, 20261126]) {
      expect(parseSignedAt(raw, now)).toEqual({ ok: false, code: "SIGNED_AT_INVALID" })
    }
  })
})

describe("the scan", () => {
  const f = (name: string, type: string, size = 1000) => ({ name, type, size })
  it("PDF, JPG or PNG, the extension matching the type", () => {
    expect(signedCopyExtension(f("Dogovor.PDF", "application/pdf"))).toEqual({ ok: true, ext: ".pdf", mimeType: "application/pdf" })
    expect(signedCopyExtension(f("scan.jpeg", "image/jpeg"))).toMatchObject({ ok: true, ext: ".jpeg" })
    expect(signedCopyExtension(f("scan.png", "image/png"))).toMatchObject({ ok: true, ext: ".png" })
    expect(signedCopyExtension(f("scan.png", "application/pdf"))).toEqual({ ok: false, code: "FILE_TYPE_NOT_ALLOWED" })
    expect(signedCopyExtension(f("dogovor.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toEqual({ ok: false, code: "FILE_TYPE_NOT_ALLOWED" })
    expect(signedCopyExtension(f("dogovor", "application/pdf"))).toEqual({ ok: false, code: "FILE_TYPE_NOT_ALLOWED" })
  })
  it("is required and at most 10 MB", () => {
    expect(signedCopyExtension(null)).toEqual({ ok: false, code: "FILE_REQUIRED" })
    expect(signedCopyExtension(f("a.pdf", "application/pdf", 0))).toEqual({ ok: false, code: "FILE_REQUIRED" })
    expect(signedCopyExtension(f("a.pdf", "application/pdf", 10 * 1024 * 1024 + 1))).toEqual({ ok: false, code: "FILE_TOO_LARGE" })
  })
})

it("a paper signature names who recorded it; an e-signature does not", () => {
  expect(paperSignerUserId("paper:user-1")).toBe("user-1")
  expect(paperSignerUserId("esign:env-1")).toBeNull()
  expect(paperSignerUserId(null)).toBeNull()
  expect(paperSignerUserId("paper:")).toBeNull()
})
