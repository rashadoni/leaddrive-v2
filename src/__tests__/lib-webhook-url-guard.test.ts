/**
 * Tests for src/lib/integrations/webhook-url-guard.ts
 *
 * assertSafeWebhookUrl rejects unsafe URLs and only allows
 * provider-allowlisted HTTPS FQDN URLs.
 */
import { describe, it, expect } from "vitest"
import { assertSafeWebhookUrl } from "@/lib/integrations/webhook-url-guard"

// ─── Helper ───────────────────────────────────────────────────────────────────

function shouldThrow(url: string, provider: "slack" | "teams") {
  expect(() => assertSafeWebhookUrl(url, provider)).toThrow()
}

function shouldPass(url: string, provider: "slack" | "teams") {
  expect(() => assertSafeWebhookUrl(url, provider)).not.toThrow()
}

// ─── Unsafe URLs — must all throw ─────────────────────────────────────────────

describe("assertSafeWebhookUrl — rejects unsafe URLs", () => {
  it("rejects http://localhost (loopback hostname)", () => {
    shouldThrow("http://localhost/hook", "slack")
  })

  it("rejects https://localhost (loopback hostname)", () => {
    shouldThrow("https://localhost/hook", "slack")
  })

  it("rejects http://169.254.169.254 (SSRF metadata endpoint)", () => {
    shouldThrow("http://169.254.169.254/latest/meta-data/", "slack")
  })

  it("rejects https://169.254.169.254 (metadata endpoint — https)", () => {
    shouldThrow("https://169.254.169.254/hook", "teams")
  })

  it("rejects http://10.0.0.1 (RFC1918 private)", () => {
    shouldThrow("http://10.0.0.1/hook", "slack")
  })

  it("rejects https://10.255.255.255 (RFC1918 private)", () => {
    shouldThrow("https://10.255.255.255/hook", "slack")
  })

  it("rejects https://192.168.1.1 (RFC1918 private)", () => {
    shouldThrow("https://192.168.1.1/hook", "teams")
  })

  it("rejects https://172.16.0.1 (RFC1918 private — 172.16 block)", () => {
    shouldThrow("https://172.16.0.1/hook", "slack")
  })

  it("rejects https://172.31.255.255 (RFC1918 private — 172.31 block)", () => {
    shouldThrow("https://172.31.255.255/hook", "teams")
  })

  it("rejects an IPv4 literal (decimal) even over https", () => {
    shouldThrow("https://1.2.3.4/hook", "slack")
  })

  it("rejects an IPv6 literal ::1 (loopback)", () => {
    // Node URL parses [::1] → hostname "::1"
    shouldThrow("https://[::1]/hook", "slack")
  })

  it("rejects http: scheme on an otherwise valid Slack host", () => {
    shouldThrow("http://hooks.slack.com/services/abc", "slack")
  })

  it("rejects a non-allowlisted host for slack (even valid FQDN)", () => {
    shouldThrow("https://webhook.example.com/hook", "slack")
  })

  it("rejects a non-allowlisted host for teams (even valid FQDN)", () => {
    shouldThrow("https://webhook.example.com/hook", "teams")
  })

  it("rejects a bare *.office.com host for teams (evil.office.com — tightened 2026-06-08)", () => {
    shouldThrow("https://evil.office.com/webhook/abc", "teams")
  })

  it("rejects an invalid URL string", () => {
    shouldThrow("not-a-url", "slack")
  })

  it("rejects 0.0.0.0", () => {
    shouldThrow("https://0.0.0.0/hook", "teams")
  })
})

// ─── Safe URLs — provider allowlist ──────────────────────────────────────────

describe("assertSafeWebhookUrl — accepts allowlisted provider URLs", () => {
  it("accepts https://hooks.slack.com/services/T00/B00/abc for slack", () => {
    shouldPass("https://hooks.slack.com/services/T00/B00/abc", "slack")
  })

  it("accepts https://hooks.slack.com/ (root path) for slack", () => {
    shouldPass("https://hooks.slack.com/", "slack")
  })

  it("accepts https://xxx.webhook.office.com/webhook/abc for teams", () => {
    shouldPass("https://xxx.webhook.office.com/webhookb2/abc", "teams")
  })

  it("accepts https://outlook.office.com/webhook/abc for teams", () => {
    shouldPass("https://outlook.office.com/webhook/abc", "teams")
  })

  it("accepts https://prod-12.logic.azure.com/workflows/abc for teams (Power Automate)", () => {
    shouldPass("https://prod-12.logic.azure.com/workflows/abc", "teams")
  })
})

// ─── Cross-provider: a Slack URL is NOT valid for Teams and vice versa ───────

describe("assertSafeWebhookUrl — cross-provider rejection", () => {
  it("rejects hooks.slack.com URL for teams provider", () => {
    shouldThrow("https://hooks.slack.com/services/abc", "teams")
  })

  it("rejects outlook.office.com URL for slack provider", () => {
    shouldThrow("https://outlook.office.com/webhook/abc", "slack")
  })
})
