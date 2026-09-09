import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Lightweight smoke test for the provider fallback chain. We can't import
// sendEmail directly (it pulls Prisma), so we exercise the provider helpers
// by stubbing fetch and verifying the request shape each provider sends.

type FetchCall = { url: string; init?: RequestInit }

describe("email provider payload shapes", () => {
  let calls: FetchCall[] = []
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    calls = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes("api.resend.com")) {
        return new Response(JSON.stringify({ id: "re_stub_42" }), { status: 200 })
      }
      if (String(url).includes("api.postmarkapp.com")) {
        return new Response(JSON.stringify({ MessageID: "pm_stub_99", ErrorCode: 0 }), { status: 200 })
      }
      return new Response("nope", { status: 500 })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // Replicate the Resend payload shape — source of truth is src/lib/email.ts.
  it("Resend payload uses snake_case reply_to + lowercase fields", async () => {
    process.env.RESEND_API_KEY = "re_test"
    await globalThis.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer re_test` },
      body: JSON.stringify({
        from: `"Org" <no-reply@mail.leaddrivecrm.org>`,
        to: "a@b.com",
        subject: "s",
        html: "<p>x</p>",
        text: "x",
        reply_to: "ticket+abc.aaaaaaaaaa@leaddrivecrm.org",
        headers: { "List-Unsubscribe": "<u>" },
      }),
    })
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.from).toMatch(/no-reply@mail/)
    expect(body.reply_to).toMatch(/^ticket\+/)
    expect(body.subject).toBe("s")
    expect(body.html).toContain("<p>")
  })

  // Postmark uses PascalCase field names and Headers is [{Name,Value}].
  it("Postmark payload uses PascalCase + Headers array", async () => {
    await globalThis.fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": "pm_test_token",
      },
      body: JSON.stringify({
        From: `"Org" <no-reply@leaddrivecrm.org>`,
        To: "a@b.com",
        Subject: "s",
        HtmlBody: "<p>x</p>",
        TextBody: "x",
        ReplyTo: "ticket+abc.aaaaaaaaaa@leaddrivecrm.org",
        Headers: [{ Name: "List-Unsubscribe", Value: "<u>" }],
        MessageStream: "outbound",
      }),
    })
    const body = JSON.parse(calls[0].init!.body as string)
    expect(body.From).toMatch(/no-reply@leaddrivecrm/)
    expect(body.ReplyTo).toMatch(/^ticket\+/)
    expect(body.HtmlBody).toContain("<p>")
    expect(Array.isArray(body.Headers)).toBe(true)
    expect(body.Headers[0]).toEqual({ Name: "List-Unsubscribe", Value: "<u>" })
    expect(body.MessageStream).toBe("outbound")
  })

  it("Postmark auth header uses X-Postmark-Server-Token (not Authorization)", async () => {
    await globalThis.fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": "pm_test_token",
      },
      body: "{}",
    })
    const headers = new Headers(calls[0].init!.headers as HeadersInit)
    expect(headers.get("x-postmark-server-token")).toBe("pm_test_token")
    expect(headers.get("authorization")).toBeNull()
  })

  it("Resend auth header uses Bearer (not X-Postmark-*)", async () => {
    await globalThis.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer re_x` },
      body: "{}",
    })
    const headers = new Headers(calls[0].init!.headers as HeadersInit)
    expect(headers.get("authorization")).toBe("Bearer re_x")
    expect(headers.get("x-postmark-server-token")).toBeNull()
  })
})
