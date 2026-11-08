/**
 * What a Kapital Bank order leaves behind on its PaymentIntent, and how to
 * read it back.
 *
 * The order's password is the credential that lets anyone ask the bank about
 * that order — and send the customer to its payment page — so it is stored
 * encrypted to the tenant, under one AAD. This file is where that AAD lives:
 * two copies of it in two callers would be two ways of writing a secret that
 * only one of them can read back.
 */
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"

/** Kapital Bank merchant accounts settle in manats. */
export const ONLINE_PAYMENT_CURRENCY = "AZN"

const ORDER_PASSWORD_AAD = { table: "payment_intents", column: "metadata.orderPassword" } as const

export function encodeOrderPassword(orgId: string, password: string): string {
  return encryptForTenantBound(orgId, ORDER_PASSWORD_AAD.table, ORDER_PASSWORD_AAD.column, password)
}

export function readOrderPassword(orgId: string, metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).orderPassword
  if (typeof value !== "string" || !value) return null
  return decryptForTenantBound(orgId, ORDER_PASSWORD_AAD.table, ORDER_PASSWORD_AAD.column, value)
}

export function readOrderHppUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).hppUrl
  return typeof value === "string" && value ? value : null
}

export function readOrderTestMode(metadata: unknown): boolean | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>).testMode
  return typeof value === "boolean" ? value : null
}
