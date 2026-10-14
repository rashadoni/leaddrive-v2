import { createHash } from "node:crypto"
import { decryptForTenantBound, encryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { UTC_NOW, type ReceiverSqlTransaction } from "./sql"

const TABLE = "customer_receiver_payloads"
const COLUMN = "body"

export class ReceiverPayloadError extends Error {
  constructor(readonly code: "payload_missing" | "payload_expired" | "payload_unreadable" | "payload_hash_mismatch") { super(code); this.name = "ReceiverPayloadError" }
}

/** Fails before any queue write when the tenant encryption key is unavailable. */
export function sealReceiverBody(organizationId: string, body: string) {
  const bodySha256 = createHash("sha256").update(body, "utf8").digest("hex")
  return { cipherText: encryptForTenantBound(organizationId, TABLE, COLUMN, body), bodySha256, bodyBytes: Buffer.byteLength(body, "utf8") }
}

export async function storeReceiverPayload(tx: ReceiverSqlTransaction, input: {
  organizationId: string; effectId: string; integrationId: string; environment: "TEST" | "PROD"
  sealed: ReturnType<typeof sealReceiverBody>; ttlHours: number
}) {
  if (!Number.isInteger(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > 336) throw new RangeError("ttlHours")
  const rows = await tx.$queryRawUnsafe<{ expiresAt: Date }[]>(
    `INSERT INTO "${TABLE}" ("organizationId", "effectId", "integrationId", "environment", "cipherText", "bodySha256", "bodyBytes", "expiresAt", "createdAt")
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, ${UTC_NOW} + make_interval(hours => $8::int), ${UTC_NOW})
     RETURNING "expiresAt"`,
    input.organizationId, input.effectId, input.integrationId, input.environment,
    input.sealed.cipherText, input.sealed.bodySha256, input.sealed.bodyBytes, input.ttlHours,
  )
  return rows[0].expiresAt
}

/** Returns the exact frozen bytes, or throws a code that never contains payload data. */
export async function openReceiverPayload(tx: ReceiverSqlTransaction, input: { organizationId: string; effectId: string; bodySha256: string }) {
  const rows = await tx.$queryRawUnsafe<{ cipherText: string; bodySha256: string; expired: boolean }[]>(
    `SELECT "cipherText", "bodySha256", "expiresAt" <= ${UTC_NOW} AS "expired" FROM "${TABLE}" WHERE "organizationId" = $1 AND "effectId" = $2::uuid`,
    input.organizationId, input.effectId,
  )
  if (!rows[0]) throw new ReceiverPayloadError("payload_missing")
  // TTL bounds the sending window too; an incident hold keeps the row for
  // investigation, it does not extend delivery.
  if (rows[0].expired) throw new ReceiverPayloadError("payload_expired")
  let body: string
  try { body = decryptForTenantBound(input.organizationId, TABLE, COLUMN, rows[0].cipherText) } catch { throw new ReceiverPayloadError("payload_unreadable") }
  const digest = createHash("sha256").update(body, "utf8").digest("hex")
  // The ledger hash (immutable effect metadata) is the authority: a swapped or
  // re-encrypted row with different content cannot be sent under this effect.
  if (digest !== input.bodySha256 || rows[0].bodySha256 !== input.bodySha256) throw new ReceiverPayloadError("payload_hash_mismatch")
  return body
}

/** Deletes only what the database itself agrees is expired and not on hold. */
export async function purgeExpiredReceiverPayloads(tx: ReceiverSqlTransaction, input: { organizationId: string; limit: number }) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5000) throw new RangeError("limit")
  return tx.$executeRawUnsafe(
    `DELETE FROM "${TABLE}" WHERE "id" IN (
       SELECT "id" FROM "${TABLE}"
        WHERE "organizationId" = $1 AND "expiresAt" <= ${UTC_NOW}
          AND ("holdUntil" IS NULL OR "holdUntil" <= ${UTC_NOW})
        ORDER BY "expiresAt" LIMIT $2
        FOR UPDATE SKIP LOCKED)`,
    input.organizationId, input.limit,
  )
}

export async function purgeExpiredRuntimeSecurityEvents(tx: ReceiverSqlTransaction, input: { organizationId: string; limit: number }) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5000) throw new RangeError("limit")
  return tx.$executeRawUnsafe(
    `DELETE FROM "customer_receiver_security_events" WHERE "id" IN (
       SELECT "id" FROM "customer_receiver_security_events"
        WHERE "organizationId" = $1 AND "retainUntil" <= ${UTC_NOW}
          AND ("holdUntil" IS NULL OR "holdUntil" <= ${UTC_NOW})
        ORDER BY "retainUntil" LIMIT $2
        FOR UPDATE SKIP LOCKED)`,
    input.organizationId, input.limit,
  )
}

/**
 * Incident hold: extends (never shortens) retention of payloads and runtime
 * security events created in [from, to) for one integration. The reason is a
 * short code (e.g. an incident ticket id), not free text.
 */
export async function placeReceiverIncidentHold(tx: ReceiverSqlTransaction, input: {
  organizationId: string; integrationId: string; environment: "TEST" | "PROD"; from: Date; to: Date; holdUntil: Date; reason: string
}) {
  if (!/^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(input.reason)) throw new RangeError("reason")
  if (!(input.from < input.to) || !(input.holdUntil > new Date())) throw new RangeError("interval")
  const payloads = await tx.$executeRawUnsafe(
    `UPDATE "${TABLE}" SET "holdUntil" = GREATEST(COALESCE("holdUntil", $5::timestamp), $5::timestamp), "holdReason" = COALESCE("holdReason", $6)
      WHERE "organizationId" = $1 AND "integrationId" = $2 AND "environment" = $7 AND "createdAt" >= $3::timestamp AND "createdAt" < $4::timestamp`,
    input.organizationId, input.integrationId, input.from.toISOString(), input.to.toISOString(), input.holdUntil.toISOString(), input.reason, input.environment,
  )
  const events = await tx.$executeRawUnsafe(
    `UPDATE "customer_receiver_security_events" SET "holdUntil" = GREATEST(COALESCE("holdUntil", $4::timestamp), $4::timestamp)
      WHERE "organizationId" = $1 AND "environment" = $5 AND "eventTime" >= $2::timestamp AND "eventTime" < $3::timestamp`,
    input.organizationId, input.from.toISOString(), input.to.toISOString(), input.holdUntil.toISOString(), input.environment,
  )
  return { payloads, events }
}
