import { describe, it, expect } from "vitest"
import { sanitizeEmailHtml, stripHtmlToText } from "@/lib/sanitize"
import { sanitizeWorkflowActionConfig } from "@/lib/workflow-template"

/**
 * Behavioral tests on the REAL payloads that reached production. The two
 * `welcome-new-lead` workflow rules in LeadDrive Inc. stored these exact
 * bodies (created 2026-07-24) and `sendEmail` transmitted them verbatim; the
 * fix must strip the event handler wherever the body enters the system.
 */
const PROD_PAYLOAD_1 = "<img src=x onerror=alert(2)>"
const PROD_PAYLOAD_2 = "<img src=x onerror=confirm(9)>"

describe("sanitizeEmailHtml — neutralizes the production XSS payloads", () => {
  it("strips the onerror handler but keeps the image", () => {
    for (const payload of [PROD_PAYLOAD_1, PROD_PAYLOAD_2]) {
      const out = sanitizeEmailHtml(payload)
      expect(out.toLowerCase()).not.toContain("onerror")
      expect(out).toContain("<img")
    }
  })

  it("removes <script> and javascript: URIs", () => {
    expect(sanitizeEmailHtml("<p>hi</p><script>steal()</script>").toLowerCase()).not.toContain("<script")
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>').toLowerCase()).not.toContain("javascript:")
  })

  it("drops event handlers introduced via svg/other tags", () => {
    expect(sanitizeEmailHtml("<svg/onload=alert(1)>").toLowerCase()).not.toContain("onload")
  })

  it("drops redirect/embedding vectors (meta refresh, iframe, style block)", () => {
    expect(sanitizeEmailHtml("<meta http-equiv=refresh content=0><p>x</p>").toLowerCase()).not.toContain("<meta")
    expect(sanitizeEmailHtml('<iframe src="//evil"></iframe><p>x</p>').toLowerCase()).not.toContain("<iframe")
    expect(sanitizeEmailHtml("<style>.a{color:red}</style><p>x</p>").toLowerCase()).not.toContain("<style")
  })
})

describe("sanitizeEmailHtml — preserves legitimate email HTML", () => {
  it("keeps tables, inline style, bgcolor and width", () => {
    const out = sanitizeEmailHtml(
      '<table width="600"><tr><td bgcolor="#eee" style="padding:8px;color:#333">Hi</td></tr></table>',
    )
    expect(out).toContain("<td")
    expect(out).toContain('bgcolor="#eee"')
    expect(out).toContain("padding:8px")
  })

  it("keeps {{variable}} placeholders untouched (safe on unrendered templates)", () => {
    expect(sanitizeEmailHtml("<p>Hi {{firstName}},</p>")).toContain("{{firstName}}")
  })

  it("scrubs dangerous CSS from an inline style while keeping the safe part", () => {
    const out = sanitizeEmailHtml('<div style="color:red;background:url(javascript:alert(1))">y</div>')
    expect(out.toLowerCase()).not.toContain("javascript:")
    expect(out).toContain("color:red")
    expect(sanitizeEmailHtml('<p style="width:expression(alert(1))">x</p>').toLowerCase()).not.toContain("expression(")
  })
})

describe("stripHtmlToText", () => {
  it("reduces a subject to plain text", () => {
    expect(stripHtmlToText("<img src=x onerror=alert(1)>Welcome!").toLowerCase()).not.toContain("onerror")
    expect(stripHtmlToText("<b>Hello</b>")).toBe("Hello")
  })
})

describe("sanitizeWorkflowActionConfig", () => {
  it("sanitizes body/template as HTML and reduces subject/message/title to text", () => {
    const out = sanitizeWorkflowActionConfig({
      subject: "<img src=x onerror=confirm(9)>",
      body: PROD_PAYLOAD_1,
      template: "<p>ok</p><script>x()</script>",
      message: "<b>text</b>",
      title: "<i>t</i>",
    })
    expect(out.subject.toLowerCase()).not.toContain("onerror")
    expect(out.subject.toLowerCase()).not.toContain("<img")
    expect(out.body.toLowerCase()).not.toContain("onerror")
    expect(out.template.toLowerCase()).not.toContain("<script")
    expect(out.message).toBe("text")
    expect(out.title).toBe("t")
  })

  it("leaves non-message keys and non-string values untouched", () => {
    const out = sanitizeWorkflowActionConfig({
      url: "https://hooks.example.com/x",
      method: "POST",
      delayMinutes: 120,
      field: "status",
      value: "won",
      assignTo: "user-1",
    })
    expect(out).toEqual({
      url: "https://hooks.example.com/x",
      method: "POST",
      delayMinutes: 120,
      field: "status",
      value: "won",
      assignTo: "user-1",
    })
  })

  it("passes through non-object configs", () => {
    expect(sanitizeWorkflowActionConfig(null)).toBeNull()
    expect(sanitizeWorkflowActionConfig("x" as unknown)).toBe("x")
  })
})
