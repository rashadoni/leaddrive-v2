import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { normalizeFundRow } from "@/lib/prisma-decimal"
import {
  AggregateVersionConflictError,
  IdempotencyConflictError,
  appendDomainEvent,
  eventProducerVersion,
  findCommandReceipt,
  hashCanonicalJson,
  isUniqueConstraintError,
  storeCommandReceipt,
} from "@/lib/event-platform"
import { withRlsAuth } from "@/lib/with-rls"

const COMMAND_TYPE = "finance.OpenFund.v1"
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,199}$/

const fundSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  targetAmount: z.union([z.string().min(1).max(64), z.number().min(0).max(999999999)]).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code").default(DEFAULT_CURRENCY),
  color: z.string().trim().max(20).optional(),
}).strict()

function exactOptionalMoney(value: string | number | undefined): Prisma.Decimal | null {
  if (value === undefined) return null
  let amount: Prisma.Decimal
  try {
    amount = new Prisma.Decimal(String(value))
  } catch {
    throw new TypeError("targetAmount must be a decimal number")
  }
  if (!amount.isFinite() || amount.lt(0) || amount.gt("999999999")) {
    throw new RangeError("targetAmount must be between zero and 999999999")
  }
  if (amount.decimalPlaces() > 4) throw new RangeError("targetAmount supports at most 4 decimal places")
  return amount
}

export const GET = withRlsAuth(
  "finance",
  "read",
  async (_req, auth) => {
    const funds = await prisma.fund.findMany({
      where: { organizationId: auth.orgId },
      include: { rules: true },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json({ data: funds.map(normalizeFundRow) })
  },
)

export const POST = withRlsAuth(
  "finance",
  "write",
  async (req, auth) => {
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? ""
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required (8-200 URL-safe characters)" },
        { status: 400 },
      )
    }

    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    const parsed = fundSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { name, description, targetAmount, currency, color } = parsed.data
    let exactTarget: Prisma.Decimal | null
    try {
      exactTarget = exactOptionalMoney(targetAmount)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid targetAmount" },
        { status: 400 },
      )
    }

    const normalizedCommand = {
      name,
      description: description || null,
      targetAmount: exactTarget?.toFixed(4) ?? null,
      currency,
      color: color || null,
    }
    const receiptIdentity = {
      organizationId: auth.orgId,
      commandType: COMMAND_TYPE,
      idempotencyKey,
      requestHash: hashCanonicalJson(normalizedCommand),
    }
    const commandId = randomUUID()
    const correlationId = randomUUID()

    try {
      const response = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existingReceipt = await findCommandReceipt(tx, receiptIdentity)
        if (existingReceipt) return existingReceipt

        // Suppress the rollback-compatibility triggers: this artifact writes
        // state, canonical event and projection in this same transaction.
        await tx.$executeRawUnsafe("SET LOCAL app.event_source_write = 'on'")
        await tx.$executeRawUnsafe("SET LOCAL app.event_projection_write = 'on'")
        const created = await tx.fund.create({
          data: {
            organizationId: auth.orgId,
            name,
            description: normalizedCommand.description,
            targetAmount: exactTarget,
            currency,
            color: normalizedCommand.color,
            createdBy: auth.userId,
          },
        })
        const appended = await appendDomainEvent(tx, {
          organizationId: auth.orgId,
          domain: "finance",
          aggregateType: "fund",
          aggregateId: created.id,
          expectedVersion: 0,
          eventType: "finance.fund-opened.v1",
          source: "urn:leaddrive:finance",
          dataSchema: "urn:leaddrive:schema:finance.fund-opened:v1",
          classification: "confidential",
          subjectRef: `fund/${created.id}`,
          correlationId,
          causationId: commandId,
          commandId,
          producer: "finance-api",
          producerVersion: eventProducerVersion(),
          data: {
            fundId: created.id,
            currency,
            openingBalance: "0.0000",
            targetAmount: normalizedCommand.targetAmount,
            name,
            description: normalizedCommand.description,
            color: normalizedCommand.color,
            isActive: true,
            legacyBootstrap: false,
          },
          occurredAt: created.createdAt,
        })
        await tx.fundBalanceProjection.create({
          data: {
            organizationId: auth.orgId,
            fundId: created.id,
            projectionVersion: 1,
            buildKey: `live-${created.id}`,
            status: "active",
            balance: 0,
            currency,
            aggregateVersion: appended.aggregateVersion,
            lastEventId: appended.eventId,
            evidence: { source: "live-command", eventId: appended.eventId },
            promotedAt: new Date(),
          },
        })
        const normalizedFund = normalizeFundRow(created)
        const receiptFund = {
          ...normalizedFund,
          createdAt: created.createdAt instanceof Date
            ? created.createdAt.toISOString()
            : created.createdAt,
          updatedAt: created.updatedAt instanceof Date
            ? created.updatedAt.toISOString()
            : created.updatedAt,
        }
        return storeCommandReceipt(tx, {
          ...receiptIdentity,
          responseStatus: 201,
          responseBody: {
            // Command receipts are JSONB and must replay byte-for-byte stable
            // JSON values; do not hand Prisma Date objects to a Json field.
            data: receiptFund,
            eventId: appended.eventId,
            aggregateVersion: Number(appended.aggregateVersion),
          },
          eventIds: [appended.eventId],
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      return NextResponse.json(response.responseBody, { status: response.responseStatus })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        try {
          const receipt = await findCommandReceipt(prisma, receiptIdentity)
          if (receipt) {
            return NextResponse.json(receipt.responseBody, { status: receipt.responseStatus })
          }
        } catch (receiptError) {
          if (receiptError instanceof IdempotencyConflictError) {
            return NextResponse.json(
              { error: receiptError.message, code: receiptError.code },
              { status: 409 },
            )
          }
          console.error("[finance-fund-event] open receipt reconciliation failed", receiptError)
          return NextResponse.json({ error: "Fund creation outcome requires reconciliation" }, { status: 500 })
        }
      }
      if (error instanceof IdempotencyConflictError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
      }
      if (error instanceof AggregateVersionConflictError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
      }
      if (error && typeof error === "object" && "code" in error
          && (error as { code?: unknown }).code === "P2034") {
        return NextResponse.json(
          { error: "Concurrent fund creation; retry with the same Idempotency-Key" },
          { status: 409, headers: { "Retry-After": "1" } },
        )
      }
      console.error("[finance-fund-event] open failed", error)
      return NextResponse.json({ error: "Fund could not be created" }, { status: 500 })
    }
  },
)
