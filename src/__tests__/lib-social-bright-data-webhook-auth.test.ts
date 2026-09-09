import { describe, expect, it } from "vitest"
import {
  BRIGHT_DATA_WEBHOOK_AUTH_VERSION,
  brightDataWebhookAuthorizationValue,
  generateBrightDataWebhookSecret,
  hashBrightDataWebhookSecret,
  verifyBrightDataWebhookAuthorization,
} from "@/lib/social/bright-data-webhook-auth"

const context = {
  organizationId: "org-1",
  idempotencyKey: "bright-data:route-1:snapshot-1",
}

describe("Bright Data webhook bearer authentication", () => {
  it("generates a high-entropy secret and stores only a context-bound hash", () => {
    const secret = generateBrightDataWebhookSecret()
    const hash = hashBrightDataWebhookSecret(context, secret)

    expect(BRIGHT_DATA_WEBHOOK_AUTH_VERSION).toBe("bright-data-webhook-bearer-v1")
    expect(secret.length).toBeGreaterThanOrEqual(43)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain(secret)
  })

  it("accepts the documented caller-supplied Bearer header", () => {
    const secret = generateBrightDataWebhookSecret()
    const webhookSecretHash = hashBrightDataWebhookSecret(context, secret)

    expect(verifyBrightDataWebhookAuthorization(
      { ...context, webhookSecretHash },
      brightDataWebhookAuthorizationValue(secret),
    )).toBe(true)
  })

  it("rejects unsigned, wrong-scheme, malformed and wrong-secret requests", () => {
    const secret = generateBrightDataWebhookSecret()
    const webhookSecretHash = hashBrightDataWebhookSecret(context, secret)
    const input = { ...context, webhookSecretHash }

    expect(verifyBrightDataWebhookAuthorization(input, null)).toBe(false)
    expect(verifyBrightDataWebhookAuthorization(input, `Basic ${secret}`)).toBe(false)
    expect(verifyBrightDataWebhookAuthorization(input, "Bearer short")).toBe(false)
    expect(verifyBrightDataWebhookAuthorization(input, brightDataWebhookAuthorizationValue(generateBrightDataWebhookSecret()))).toBe(false)
    expect(verifyBrightDataWebhookAuthorization({ ...input, webhookSecretHash: "not-hex" }, brightDataWebhookAuthorizationValue(secret))).toBe(false)
  })

  it("prevents replay of the same secret across tenant or run context", () => {
    const secret = generateBrightDataWebhookSecret()
    const webhookSecretHash = hashBrightDataWebhookSecret(context, secret)
    const header = brightDataWebhookAuthorizationValue(secret)

    expect(verifyBrightDataWebhookAuthorization({
      ...context,
      organizationId: "org-2",
      webhookSecretHash,
    }, header)).toBe(false)
    expect(verifyBrightDataWebhookAuthorization({
      ...context,
      idempotencyKey: "bright-data:route-1:snapshot-2",
      webhookSecretHash,
    }, header)).toBe(false)
  })
})
