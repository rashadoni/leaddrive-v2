import crypto from "crypto"
import { hmacToken } from "@/lib/secure-token"

export const BRIGHT_DATA_WEBHOOK_AUTH_VERSION = "bright-data-webhook-bearer-v1"

export interface BrightDataWebhookAuthContext {
  organizationId: string
  idempotencyKey: string
  webhookSecretHash: string | null
}

function purpose(input: Pick<BrightDataWebhookAuthContext, "organizationId" | "idempotencyKey">): string {
  const organizationId = input.organizationId.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  if (!organizationId) throw new Error("organizationId is required")
  if (!idempotencyKey) throw new Error("idempotencyKey is required")
  return `bright-data-webhook:${organizationId}:${idempotencyKey}`
}

export function generateBrightDataWebhookSecret(): string {
  return crypto.randomBytes(32).toString("base64url")
}

export function hashBrightDataWebhookSecret(
  input: Pick<BrightDataWebhookAuthContext, "organizationId" | "idempotencyKey">,
  secret: string,
): string {
  const value = secret.trim()
  if (!value) throw new Error("Bright Data webhook secret is required")
  return hmacToken(value, purpose(input))
}

export function brightDataWebhookAuthorizationValue(secret: string): string {
  const value = secret.trim()
  if (!value) throw new Error("Bright Data webhook secret is required")
  return `Bearer ${value}`
}

/**
 * Bright Data documents caller-supplied Authorization headers, not a provider
 * payload signature. Verification is therefore a context-bound shared secret
 * comparison; callers must not label it as HMAC-signed provider evidence.
 */
export function verifyBrightDataWebhookAuthorization(
  input: BrightDataWebhookAuthContext,
  authorizationHeader: string | null | undefined,
): boolean {
  if (!input.webhookSecretHash || !authorizationHeader) return false
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(authorizationHeader.trim())
  if (!match) return false
  let expected: string
  try {
    expected = hashBrightDataWebhookSecret(input, match[1])
  } catch {
    return false
  }
  if (!/^[a-f0-9]{64}$/i.test(input.webhookSecretHash)) return false
  const received = Buffer.from(expected, "hex")
  const stored = Buffer.from(input.webhookSecretHash, "hex")
  return received.length === stored.length && crypto.timingSafeEqual(received, stored)
}
