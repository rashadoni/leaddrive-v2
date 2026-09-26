import { decryptToken, encryptToken, isEncrypted } from "@/lib/secure-token"
import {
  MAX_WORKFORCE_EXCEPTION_DECISIONS,
  WORKFORCE_EXCEPTION_WORKBENCH_DECISIONS,
  type WorkforceExceptionWorkbenchDecision,
} from "@/lib/workforce/exception-workbench"

const ACTION_TOKEN_PURPOSE = "workforce-exception-workbench-action:v1"
const ACTION_TOKEN_VERSION = 1
const DEFAULT_ACTION_TOKEN_TTL_SECONDS = 5 * 60
const MAX_ACTION_TOKEN_TTL_SECONDS = 10 * 60
const MAX_ACTION_TOKEN_LENGTH = 2_048
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,191}$/

type WorkforceExceptionActionTokenPayload = {
  v: typeof ACTION_TOKEN_VERSION
  organizationId: string
  principalUserId: string
  caseId: string
  decisionCode: WorkforceExceptionWorkbenchDecision
  decisionCount: number
  iat: number
  exp: number
}

export type WorkforceExceptionActionToken = Omit<WorkforceExceptionActionTokenPayload, "v" | "iat" | "exp"> & {
  issuedAt: Date
  expiresAt: Date
}

function validId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID.test(value)
}

function validInstant(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
}

/**
 * Creates a short-lived, principal-bound locator for a manager action. The
 * encrypted token is deliberately not an authorization grant: the write path
 * must still re-read the case, historical scope, live grants and lifecycle in
 * its serializable transaction.
 */
export function issueWorkforceExceptionActionToken(input: {
  organizationId: string
  principalUserId: string
  caseId: string
  decisionCode: WorkforceExceptionWorkbenchDecision
  decisionCount: number
  now?: Date
  ttlSeconds?: number
}): string {
  const now = input.now ?? new Date()
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_ACTION_TOKEN_TTL_SECONDS
  if (!validId(input.organizationId) || !validId(input.principalUserId) || !validId(input.caseId)
    || !validInstant(now) || !Number.isInteger(ttlSeconds)
    || ttlSeconds < 1 || ttlSeconds > MAX_ACTION_TOKEN_TTL_SECONDS
    || !WORKFORCE_EXCEPTION_WORKBENCH_DECISIONS.includes(input.decisionCode)
    || !Number.isInteger(input.decisionCount) || input.decisionCount < 0
    || input.decisionCount > MAX_WORKFORCE_EXCEPTION_DECISIONS) {
    throw new Error("WORKFORCE_EXCEPTION_ACTION_TOKEN_INPUT_INVALID")
  }
  const issuedAt = Math.floor(now.getTime() / 1_000)
  const payload: WorkforceExceptionActionTokenPayload = {
    v: ACTION_TOKEN_VERSION,
    organizationId: input.organizationId,
    principalUserId: input.principalUserId,
    caseId: input.caseId,
    decisionCode: input.decisionCode,
    decisionCount: input.decisionCount,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  }
  return encryptToken(JSON.stringify(payload), ACTION_TOKEN_PURPOSE)
}

/**
 * Opens only v1 ciphertext issued for this exact organization and principal.
 * `isEncrypted` is checked before `decryptToken` so the secure-token helper's
 * legacy plaintext compatibility can never turn caller text into a locator.
 */
export function readWorkforceExceptionActionToken(input: {
  token: unknown
  organizationId: string
  principalUserId: string
  now?: Date
}): WorkforceExceptionActionToken | null {
  const now = input.now ?? new Date()
  if (typeof input.token !== "string" || input.token.length > MAX_ACTION_TOKEN_LENGTH
    || !isEncrypted(input.token) || !validId(input.organizationId)
    || !validId(input.principalUserId) || !validInstant(now)) return null
  const encoded = input.token.slice("v1:".length)
  // Node's base64 decoder ignores an incomplete trailing quantum and unused
  // low bits in the final character. Decode and re-encode as well as checking
  // the alphabet so one authenticated blob has exactly one textual form.
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return null
  if (Buffer.from(encoded, "base64url").toString("base64url") !== encoded) return null

  try {
    const parsed = JSON.parse(decryptToken(input.token, ACTION_TOKEN_PURPOSE)) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    const payload = parsed as Record<string, unknown>
    const keys = Object.keys(payload).sort()
    if (keys.join(",") !== "caseId,decisionCode,decisionCount,exp,iat,organizationId,principalUserId,v") return null
    if (payload.v !== ACTION_TOKEN_VERSION || !validId(payload.organizationId)
      || !validId(payload.principalUserId) || !validId(payload.caseId)
      || typeof payload.decisionCode !== "string"
      || !WORKFORCE_EXCEPTION_WORKBENCH_DECISIONS.includes(payload.decisionCode as WorkforceExceptionWorkbenchDecision)
      || !Number.isSafeInteger(payload.decisionCount) || (payload.decisionCount as number) < 0
      || (payload.decisionCount as number) > MAX_WORKFORCE_EXCEPTION_DECISIONS
      || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null
    const nowSeconds = Math.floor(now.getTime() / 1_000)
    const issuedAt = payload.iat as number
    const expiresAt = payload.exp as number
    if (payload.organizationId !== input.organizationId
      || payload.principalUserId !== input.principalUserId
      || issuedAt > nowSeconds || expiresAt <= issuedAt
      || expiresAt - issuedAt > MAX_ACTION_TOKEN_TTL_SECONDS
      || nowSeconds >= expiresAt) return null
    return {
      organizationId: payload.organizationId,
      principalUserId: payload.principalUserId,
      caseId: payload.caseId,
      decisionCode: payload.decisionCode as WorkforceExceptionWorkbenchDecision,
      decisionCount: payload.decisionCount as number,
      issuedAt: new Date(issuedAt * 1_000),
      expiresAt: new Date(expiresAt * 1_000),
    }
  } catch {
    return null
  }
}
