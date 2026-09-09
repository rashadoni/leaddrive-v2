import { createHash } from "node:crypto"

/** The server accepts one deliberately small, self-planning command grammar. */
export const MTM_MOBILE_ROUTE_COMMAND_SCHEMA_VERSION = 1
export const MTM_MOBILE_ROUTE_COMMAND_RECEIPT_RETENTION_DAYS = 90

export type MtmMobileRouteCommandName = "CREATE_DRAFT" | "UPDATE_DRAFT" | "PUBLISH" | "START"

export interface MtmMobileRouteCommandHashInput {
  command: MtmMobileRouteCommandName
  targetRouteId: string | null
  /** Parsed, normalized command data. Operation/tenant/device identities are
   * receipt scope, not payload, and intentionally do not participate here. */
  payload: unknown
}

export interface MtmMobileRouteCommandReceiptScope extends MtmMobileRouteCommandHashInput {
  organizationId: string
  agentId: string
  deviceId: string
  operationId: string
  requestHash: string
}

export interface MtmMobileRouteCommandReceiptMatch {
  organizationId: string
  agentId: string
  deviceId: string
  operationId: string
  command: string
  targetRouteId: string | null
  requestHash: string
  expiresAt: Date
}

/**
 * Stable JSON encoding for a hash only. Arrays retain their business order;
 * object keys are recursively sorted so harmless transport key ordering never
 * changes an idempotency receipt.
 */
export function canonicalMtmMobileRouteCommandJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function hashMtmMobileRouteCommand(input: MtmMobileRouteCommandHashInput): string {
  return createHash("sha256")
    .update(canonicalMtmMobileRouteCommandJson({
      schemaVersion: MTM_MOBILE_ROUTE_COMMAND_SCHEMA_VERSION,
      command: input.command,
      targetRouteId: input.targetRouteId,
      payload: input.payload,
    }))
    .digest("hex")
}

export function expiresMtmMobileRouteCommandReceiptAt(completedAt: Date): Date {
  return new Date(
    completedAt.getTime() + MTM_MOBILE_ROUTE_COMMAND_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
}

/**
 * Replays are deliberately strict: even an improbable operation-ID collision
 * cannot reveal a result across agent/device/request boundaries.
 */
export function isExactMtmMobileRouteCommandReceiptMatch(
  receipt: MtmMobileRouteCommandReceiptMatch,
  requested: MtmMobileRouteCommandReceiptScope,
  now = new Date(),
): boolean {
  return receipt.expiresAt > now && isMtmMobileRouteCommandReceiptScopeMatch(receipt, requested)
}

/** Compare every replay boundary except expiry so callers can return a
 * deterministic "new operation ID required" result for an expired receipt. */
export function isMtmMobileRouteCommandReceiptScopeMatch(
  receipt: Omit<MtmMobileRouteCommandReceiptMatch, "expiresAt">,
  requested: MtmMobileRouteCommandReceiptScope,
): boolean {
  return receipt.organizationId === requested.organizationId
    && receipt.agentId === requested.agentId
    && receipt.deviceId === requested.deviceId
    && receipt.operationId === requested.operationId
    && receipt.command === requested.command
    && receipt.targetRouteId === requested.targetRouteId
    && receipt.requestHash === requested.requestHash
}
