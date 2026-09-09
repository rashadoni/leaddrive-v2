import { describe, expect, it } from "vitest"
import { isAuthenticatedGmailForwardingConfirmation } from "../../workers/email-inbound.js"

describe("Gmail forwarding confirmation gate", () => {
  const valid = {
    envelopeFrom: "forwarding-noreply@google.com",
    headerFrom: "Gmail Team <forwarding-noreply@google.com>",
    authenticationResults: "mx.cloudflare.net; dkim=pass header.d=google.com; spf=pass",
    subject: "(#12345678) Gmail Forwarding Confirmation - Receive Mail",
  }

  it("accepts only an authenticated Google forwarding confirmation", () => {
    expect(isAuthenticatedGmailForwardingConfirmation(valid)).toBe(true)
    expect(isAuthenticatedGmailForwardingConfirmation({
      ...valid,
      subject: "Подтверждение пересылки писем с brandmonitoringbaku@gmail.com",
    })).toBe(true)
    expect(isAuthenticatedGmailForwardingConfirmation({
      ...valid,
      authenticationResults: "mx.cloudflare.net; dkim=pass header.d=gaia.bounces.google.com; spf=pass",
    })).toBe(true)
    expect(isAuthenticatedGmailForwardingConfirmation({
      ...valid,
      authenticationResults: "mx.cloudflare.net; dkim=none; dmarc=pass header.from=google.com",
    })).toBe(true)
    expect(isAuthenticatedGmailForwardingConfirmation({
      ...valid,
      authenticationResults: "dkim=fail header.d=google.com",
    })).toBe(false)
    expect(isAuthenticatedGmailForwardingConfirmation({
      ...valid,
      envelopeFrom: "attacker@example.com",
    })).toBe(false)
    expect(isAuthenticatedGmailForwardingConfirmation({
      ...valid,
      subject: "Google Alert - Baku Electronics",
    })).toBe(false)
  })
})
