import { describe, expect, it } from "vitest"

import { redactOAuthProviderText } from "@/lib/oauth-redaction"

describe("redactOAuthProviderText", () => {
  it("redacts OAuth secrets in URLs, JSON, and form-like provider errors", () => {
    const input = [
      "https://graph.facebook.com/oauth/access_token?client_secret=APP_SECRET&access_token=USER_TOKEN&ok=1",
      '{"error":{"message":"bad"},"client_secret":"APP_SECRET","refresh_token":"REFRESH"}',
      "fb_exchange_token=SHORT_TOKEN code='AUTH_CODE' token: raw-token",
    ].join("\n")

    const out = redactOAuthProviderText(input)

    expect(out).not.toContain("APP_SECRET")
    expect(out).not.toContain("USER_TOKEN")
    expect(out).not.toContain("REFRESH")
    expect(out).not.toContain("SHORT_TOKEN")
    expect(out).not.toContain("AUTH_CODE")
    expect(out).not.toContain("raw-token")
    expect(out).toContain("ok=1")
    expect(out).toContain("message")
  })
})
