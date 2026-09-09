import { IdempotencyConflictError } from "./errors"

export interface StoredCommandReceipt {
  id: string
  requestHash: string
  responseStatus: number
  responseBody: unknown
  eventIds: string[]
}

interface ReceiptClient {
  eventCommandReceipt: {
    findUnique(args: Record<string, unknown>): Promise<StoredCommandReceipt | null>
    create(args: Record<string, unknown>): Promise<StoredCommandReceipt>
  }
}

export interface CommandReceiptIdentity {
  organizationId: string
  commandType: string
  idempotencyKey: string
  requestHash: string
}

export async function findCommandReceipt(
  db: ReceiptClient,
  identity: CommandReceiptIdentity,
): Promise<StoredCommandReceipt | null> {
  const receipt = await db.eventCommandReceipt.findUnique({
    where: {
      organizationId_commandType_idempotencyKey: {
        organizationId: identity.organizationId,
        commandType: identity.commandType,
        idempotencyKey: identity.idempotencyKey,
      },
    },
    select: {
      id: true,
      requestHash: true,
      responseStatus: true,
      responseBody: true,
      eventIds: true,
    },
  })
  if (receipt && receipt.requestHash !== identity.requestHash) throw new IdempotencyConflictError()
  return receipt
}

export async function storeCommandReceipt(
  db: ReceiptClient,
  input: CommandReceiptIdentity & {
    responseStatus: number
    responseBody: unknown
    eventIds: string[]
    expiresAt?: Date
  },
): Promise<StoredCommandReceipt> {
  return db.eventCommandReceipt.create({
    data: {
      organizationId: input.organizationId,
      commandType: input.commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      eventIds: input.eventIds,
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      requestHash: true,
      responseStatus: true,
      responseBody: true,
      eventIds: true,
    },
  })
}

export function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2002"
}
