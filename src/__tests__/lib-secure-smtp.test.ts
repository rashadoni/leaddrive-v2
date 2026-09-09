import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
  isPrivateHost: vi.fn(() => false),
}))

vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }))
vi.mock("@/lib/url-validation", () => ({ isPrivateHost: mocks.isPrivateHost }))

import {
  assertSafeMailHeaderValue,
  createSecureSmtpTransport,
  sanitizeMailHeaders,
} from "@/lib/secure-smtp"

describe("secure SMTP boundary", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fails closed for private hosts, CRLF and invalid ports", () => {
    mocks.isPrivateHost.mockReturnValueOnce(true)
    expect(() => createSecureSmtpTransport({ host: "127.0.0.1", port: 25 })).toThrow(/private\/internal/)
    expect(() => createSecureSmtpTransport({ host: "smtp.example.com\r\nX: y", port: 587 })).toThrow(/line break/)
    expect(() => createSecureSmtpTransport({ host: "smtp.example.com", port: 0 })).toThrow(/port/)
  })

  it("disables Nodemailer file and URL dereferencing and enforces TLS", () => {
    createSecureSmtpTransport({ host: "smtp.example.com", port: 587, user: "user", pass: "pass" })
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      tls: { rejectUnauthorized: true },
    }))
  })

  it("rejects header injection and preserves safe list headers", () => {
    expect(() => assertSafeMailHeaderValue("Subject", "safe\r\nBcc: attacker@example.com")).toThrow(/line break/)
    expect(() => sanitizeMailHeaders({ "Bad Header": "x" })).toThrow(/name/)
    expect(sanitizeMailHeaders({ "List-Unsubscribe": "<https://example.com/u>" })).toEqual({
      "List-Unsubscribe": "<https://example.com/u>",
    })
  })
})
