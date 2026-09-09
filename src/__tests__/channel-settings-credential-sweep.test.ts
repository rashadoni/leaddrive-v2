import { describe, expect, it } from "vitest"

import { publicChannelConfig } from "@/lib/channels/public-channel-config"

/**
 * Finding F-33 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * `ChannelConfig.settings` is a free-form JSON blob served to any tenant user
 * who can read channels. Its redaction was a hand-maintained deny list holding
 * exactly one credential name, `webhookSecret`.
 *
 * That list cannot keep up with the blob. Two credentials landed in `settings`
 * the same week this test was written — the VK Callback `secret` (F-26) and the
 * SMS `inboundSecret` (F-26) — and a list written before them would have served
 * both. The rule is therefore carried by the key NAME.
 *
 * The cases below are the real keys this product stores, not invented ones.
 */

const channel = (settings: Record<string, unknown>) =>
  publicChannelConfig({
    id: "ch1",
    channelType: "sms",
    settings,
  } as never) as unknown as { settings: Record<string, unknown> }

describe("channel settings never serve a credential", () => {
  it.each([
    ["secret", "VK Callback API secret — F-26"],
    ["inboundSecret", "SMS inbound webhook secret — F-26"],
    ["webhookSecret", "the one name the old deny list knew"],
    ["atlPassword", "ATL SMS provider password"],
    ["authToken", "Twilio auth token"],
    ["apiSecret", "Vonage api secret"],
    ["clientSecret", "OAuth client secret"],
    ["apiKey", "generic provider key"],
    ["accessToken", "provider access token"],
    ["refreshToken", "provider refresh token"],
  ])("strips %s (%s)", key => {
    const out = channel({ [key]: "the-actual-secret-value", displayName: "Main" })
    expect(out.settings).not.toHaveProperty(key)
    expect(JSON.stringify(out)).not.toContain("the-actual-secret-value")
    // The UI still needs to know a value is configured, without receiving it.
    expect(JSON.stringify(out)).toContain("has")
    // Non-credential settings survive.
    expect(out.settings.displayName).toBe("Main")
  })

  it("reports existence without the value", () => {
    const withSecret = channel({ inboundSecret: "abc" })
    const without = channel({ inboundSecret: "" })
    expect(withSecret.settings.hasInboundSecret).toBe(true)
    expect(without.settings.hasInboundSecret).toBe(false)
  })

  // A blanket "token" rule would take these with it, and the UI renders them.
  it.each(["tokenExpiresAt", "tokenExpiry", "replyMode", "confirmationCode"])(
    "keeps the non-credential setting %s",
    key => {
      const out = channel({ [key]: "value-1" })
      expect(out.settings[key]).toBe("value-1")
    },
  )
})
