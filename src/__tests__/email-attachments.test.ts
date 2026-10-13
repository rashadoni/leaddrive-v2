import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}))

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  mocks.readFile.mockImplementation(actual.readFile)
  return { ...actual, readFile: mocks.readFile }
})
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { sendEmail } from "@/lib/email"

type Attachment = { filename: string; path: string }
type ResendAttachment = { filename: string; content: string }
type PostmarkAttachment = { Name: string; Content: string; ContentType: string }
type SmtpAttachment = { filename: string; content: Buffer; contentType?: string }

const mail = {
  to: "recipient@example.test",
  subject: "Attendance report",
  html: "<p>Attendance report</p>",
  transactional: true,
}
const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80, 0x0a])
const xlsxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xfe, 0x00, 0x0d])
const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
let fixtureDirectory: string
let outsideDirectory: string
let pdf: Attachment
let xlsx: Attachment

function enableProviders(...providers: ("resend" | "postmark" | "smtp")[]) {
  vi.stubEnv("RESEND_API_KEY", providers.includes("resend") ? "test-resend-key" : "")
  vi.stubEnv("POSTMARK_SERVER_TOKEN", providers.includes("postmark") ? "test-postmark-token" : "")
  vi.stubEnv("SMTP_USER", providers.includes("smtp") ? "sender@example.test" : "")
}

function requestBody(index = 0) {
  const init = mocks.fetch.mock.calls[index][1]
  return JSON.parse(String(init?.body))
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.fetch.mockReset()
  mocks.sendMail.mockResolvedValue({ messageId: "smtp-id" })
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail })
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("EMAIL_FROM_ADDRESS", "sender@example.test")
  vi.stubEnv("SMTP_HOST", "smtp.example.test")
  vi.stubEnv("SMTP_PORT", "587")
  vi.stubEnv("SMTP_PASS", "test-smtp-password")
  vi.stubEnv("SMTP_FROM", "sender@example.test")
  vi.stubEnv("POSTMARK_MESSAGE_STREAM", "outbound")
  enableProviders()
  fixtureDirectory = await mkdtemp("/tmp/leaddrive-email-attachments-")
  outsideDirectory = await mkdtemp("/var/tmp/leaddrive-email-outside-")
  pdf = { filename: "Davamiyyət — Отчёт.PDF", path: path.join(fixtureDirectory, "report.bin") }
  xlsx = { filename: "Attendance.xlsx", path: path.join(fixtureDirectory, "spreadsheet.bin") }
  await writeFile(pdf.path, bytes)
  await writeFile(xlsx.path, xlsxBytes)
})

afterEach(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true })
  await rm(outsideDirectory, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("sendEmail attachment delivery through real provider selection", () => {
  it("sends exact binary PDF/XLSX bytes and Unicode names through Resend", async () => {
    enableProviders("resend", "postmark", "smtp")
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "resend-id" })))

    expect(await sendEmail({ ...mail, attachments: [pdf, xlsx] })).toEqual({ success: true, messageId: "resend-id" })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.resend.com/emails")
    const attachments = requestBody().attachments as ResendAttachment[]
    expect(attachments.map(item => item.filename)).toEqual([pdf.filename, xlsx.filename])
    expect(attachments.map(item => Buffer.from(item.content, "base64"))).toEqual([bytes, xlsxBytes])
    expect(attachments.every(item => !Object.hasOwn(item, "path"))).toBe(true)
    expect(mocks.readFile).toHaveBeenCalledTimes(2)
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it("sends Postmark the validated bytes with explicit PDF/XLSX MIME types", async () => {
    enableProviders("postmark", "smtp")
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ MessageID: "postmark-id" })))

    expect(await sendEmail({ ...mail, attachments: [pdf, xlsx] })).toEqual({ success: true, messageId: "postmark-id" })

    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.postmarkapp.com/email")
    const attachments = requestBody().Attachments as PostmarkAttachment[]
    expect(attachments.map(item => item.Name)).toEqual([pdf.filename, xlsx.filename])
    expect(attachments.map(item => item.ContentType)).toEqual(["application/pdf", xlsxMime])
    expect(attachments.map(item => Buffer.from(item.Content, "base64"))).toEqual([bytes, xlsxBytes])
    expect(attachments.every(item => !Object.hasOwn(item, "path"))).toBe(true)
    expect(mocks.readFile).toHaveBeenCalledTimes(2)
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it("gives SMTP Buffers rather than paths and keeps file/URL dereferencing disabled", async () => {
    enableProviders("smtp")

    expect(await sendEmail({ ...mail, attachments: [pdf, xlsx] })).toEqual({ success: true, messageId: "smtp-id" })

    const attachments = mocks.sendMail.mock.calls[0][0].attachments as SmtpAttachment[]
    expect(attachments).toEqual([
      { filename: pdf.filename, content: bytes, contentType: "application/pdf" },
      { filename: xlsx.filename, content: xlsxBytes, contentType: xlsxMime },
    ])
    expect(attachments.every(item => Buffer.isBuffer(item.content) && !Object.hasOwn(item, "path"))).toBe(true)
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ disableFileAccess: true, disableUrlAccess: true }))
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(["postmark", "smtp"] as const)("reads once and preserves original bytes when falling back to %s", async winner => {
    enableProviders("resend", "postmark", "smtp")
    mocks.fetch.mockImplementationOnce(async () => {
      // Providers only get the already validated snapshot, even if its source
      // is replaced while delivery is in progress.
      await writeFile(pdf.path, "a later version of this report")
      return new Response("Resend unavailable", { status: 503 })
    })
    if (winner === "postmark") {
      mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ MessageID: "postmark-id" })))
    } else {
      mocks.fetch.mockRejectedValueOnce(new Error("Postmark connection failed"))
    }

    expect(await sendEmail({ ...mail, attachments: [pdf] })).toEqual({ success: true, messageId: `${winner}-id` })

    expect(mocks.fetch.mock.calls.map(call => call[0])).toEqual(["https://api.resend.com/emails", "https://api.postmarkapp.com/email"])
    expect(Buffer.from(requestBody(0).attachments[0].content, "base64")).toEqual(bytes)
    expect(Buffer.from(requestBody(1).Attachments[0].Content, "base64")).toEqual(bytes)
    expect(mocks.readFile).toHaveBeenCalledTimes(1)
    if (winner === "smtp") {
      expect(mocks.sendMail.mock.calls[0][0].attachments[0].content).toEqual(bytes)
    } else {
      expect(mocks.sendMail).not.toHaveBeenCalled()
    }
  })

  it("keeps non-report attachments supported with a generic Postmark MIME type", async () => {
    enableProviders("postmark")
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ MessageID: "postmark-id" })))
    expect((await sendEmail({ ...mail, attachments: [{ ...pdf, filename: "data.custom" }] })).success).toBe(true)
    expect(requestBody().Attachments[0]).toEqual({ Name: "data.custom", Content: bytes.toString("base64"), ContentType: "application/octet-stream" })
  })
})

describe("attachment validation before any provider can send", () => {
  it.each(["missing", "directory", "outside", "symlink-outside", "remote-url", "CR", "LF", "CRLF", "oversize"])("rejects %s without calling any provider", async scenario => {
    enableProviders("resend", "postmark", "smtp")
    const attachment = { ...pdf }
    if (scenario === "missing") attachment.path = path.join(fixtureDirectory, "missing.pdf")
    if (scenario === "directory") attachment.path = fixtureDirectory
    if (scenario === "outside" || scenario === "symlink-outside") {
      const outsidePath = path.join(outsideDirectory, "outside.pdf")
      await writeFile(outsidePath, bytes)
      attachment.path = outsidePath
      if (scenario === "symlink-outside") {
        attachment.path = path.join(fixtureDirectory, "escape.pdf")
        await symlink(outsidePath, attachment.path)
      }
    }
    if (scenario === "remote-url") attachment.path = "https://example.test/report.pdf"
    if (scenario === "CR") attachment.filename = "report\rBcc: other@example.test"
    if (scenario === "LF") attachment.filename = "report\nBcc: other@example.test"
    if (scenario === "CRLF") attachment.filename = "report\r\nBcc: other@example.test"
    if (scenario === "oversize") await truncate(attachment.path, 25 * 1024 * 1024 + 1)

    expect(await sendEmail({ ...mail, attachments: [attachment] })).toEqual({ success: false, error: "Failed to send email" })

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.createTransport).not.toHaveBeenCalled()
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it("does not send a partial attachment list when a later file is invalid", async () => {
    enableProviders("resend", "postmark", "smtp")
    expect((await sendEmail({ ...mail, attachments: [pdf, { ...xlsx, path: path.join(fixtureDirectory, "missing.xlsx") }] })).success).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it("accepts a regular file exactly at the existing 25 MiB boundary", async () => {
    enableProviders("smtp")
    await truncate(pdf.path, 25 * 1024 * 1024)
    expect((await sendEmail({ ...mail, attachments: [pdf] })).success).toBe(true)
    const content = mocks.sendMail.mock.calls[0][0].attachments[0].content as Buffer
    expect(Buffer.isBuffer(content)).toBe(true)
    expect(content.length).toBe(25 * 1024 * 1024)
    expect(content.subarray(0, bytes.length)).toEqual(bytes)
  })
})

describe("messages without attachments", () => {
  it.each(["resend", "postmark", "smtp"] as const)("keeps %s delivery and existing body/headers without attachment fields", async provider => {
    enableProviders(provider)
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "resend-id", MessageID: "postmark-id" })))

    expect((await sendEmail({ ...mail, attachments: [], replyTo: "reply@example.test", headers: { "X-Report": "attendance" } })).success).toBe(true)

    const body = provider === "smtp" ? mocks.sendMail.mock.calls[0][0] : requestBody()
    expect(body).not.toHaveProperty("attachments")
    expect(body).not.toHaveProperty("Attachments")
    if (provider === "postmark") {
      expect(body).toMatchObject({ To: mail.to, Subject: mail.subject, HtmlBody: mail.html, TextBody: "Attendance report", ReplyTo: "reply@example.test", Headers: [{ Name: "X-Report", Value: "attendance" }] })
    } else {
      expect(body).toMatchObject({ to: mail.to, subject: mail.subject, html: mail.html, text: "Attendance report", headers: { "X-Report": "attendance" } })
      expect(body[provider === "resend" ? "reply_to" : "replyTo"]).toBe("reply@example.test")
    }
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it("keeps fallback to SMTP when both APIs reject a message without attachments", async () => {
    enableProviders("resend", "postmark", "smtp")
    mocks.fetch.mockImplementation(async () => new Response("Unavailable", { status: 503 }))
    expect(await sendEmail(mail)).toEqual({ success: true, messageId: "smtp-id" })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.sendMail.mock.calls[0][0]).not.toHaveProperty("attachments")
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
})

describe("single handoff for delivery jobs", () => {
  it.each([
    ["resend", "HTTP rejection"], ["resend", "connection lost"],
    ["postmark", "HTTP rejection"], ["postmark", "connection lost"],
  ] as const)("does not fall back after %s reports %s when fallback is disabled", async (provider, outcome) => {
    enableProviders(...(provider === "resend" ? ["resend", "postmark", "smtp"] as const : ["postmark", "smtp"] as const))
    if (outcome === "HTTP rejection") mocks.fetch.mockResolvedValue(new Response("Unavailable", { status: 503 }))
    else mocks.fetch.mockRejectedValue(new Error("Connection lost after request was written"))

    expect(await sendEmail({ ...mail, attachments: [pdf], allowProviderFallback: false })).toEqual({ success: false, error: "Failed to send email" })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][0]).toBe(provider === "resend" ? "https://api.resend.com/emails" : "https://api.postmarkapp.com/email")
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(mocks.readFile).toHaveBeenCalledTimes(1)
  })

  it("uses SMTP once when it is the only configured provider and fallback is disabled", async () => {
    enableProviders("smtp")
    expect(await sendEmail({ ...mail, attachments: [pdf], allowProviderFallback: false })).toEqual({ success: true, messageId: "smtp-id" })
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
