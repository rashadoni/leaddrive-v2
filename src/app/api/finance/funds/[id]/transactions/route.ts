import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE, getCurrencySymbol } from "@/lib/constants"
import { decimalToNumber, normalizeFundTransactionRow } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"
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

const COMMAND_TYPE = "finance.RecordFundTransaction.v1"
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,199}$/

const createTransactionSchema = z.object({
  type: z.enum(["deposit", "withdrawal", "transfer_in", "transfer_out", "auto_allocation"]),
  amount: z.union([z.string().min(1).max(64), z.number().positive().max(999999999)]),
  description: z.string().max(500).optional().nullable(),
}).strict()

type RouteContext = { params: Promise<{ id: string }> }

class FundNotFoundError extends Error {}
class FundArchivedError extends Error {}
class FundChangedConcurrentlyError extends Error {}
class InsufficientFundBalanceError extends Error {
  constructor(
    readonly balance: string,
    readonly requested: string,
    readonly currency: string,
  ) {
    super("Insufficient fund balance")
  }
}

function exactPositiveMoney(value: string | number): string {
  let amount: Prisma.Decimal
  try {
    amount = new Prisma.Decimal(String(value))
  } catch {
    throw new TypeError("amount must be a decimal number")
  }
  if (!amount.isFinite() || !amount.gt(0) || amount.gt("999999999")) {
    throw new RangeError("amount must be greater than zero and at most 999999999")
  }
  if (amount.decimalPlaces() > 4) throw new RangeError("amount supports at most 4 decimal places")
  return amount.toFixed(4)
}

function receiptResponse(receipt: { responseBody: unknown; responseStatus: number }) {
  return NextResponse.json(receipt.responseBody, { status: receipt.responseStatus })
}

export const GET = withRlsAuth<RouteContext>(
  "finance",
  "read",
  async (_req, auth, { params }) => {
    const { id: fundId } = await params
    const transactions = await prisma.fundTransaction.findMany({
      where: { fundId, organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE.DEFAULT,
    })
    return NextResponse.json({ data: transactions.map(normalizeFundTransactionRow) })
  },
)

export const POST = withRlsAuth<RouteContext>(
  "finance",
  "write",
  async (req, auth, { params }) => {
    const { id: fundId } = await params
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? ""
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required (8-200 URL-safe characters)" },
        { status: 400 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data: z.infer<typeof createTransactionSchema>
    try {
      data = createTransactionSchema.parse(body)
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json({
          error: `Invalid data: ${error.issues.map((issue) => issue.message).join(", ")}`,
          details: error.flatten().fieldErrors,
        }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    let amount: string
    try {
      amount = exactPositiveMoney(data.amount)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid amount" },
        { status: 400 },
      )
    }

    const normalizedCommand = {
      fundId,
      type: data.type,
      amount,
      description: data.description?.trim() || null,
    }
    const requestHash = hashCanonicalJson(normalizedCommand)
    const receiptIdentity = {
      organizationId: auth.orgId,
      commandType: COMMAND_TYPE,
      idempotencyKey,
      requestHash,
    }
    const commandId = randomUUID()
    const correlationId = randomUUID()

    try {
      const response = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existingReceipt = await findCommandReceipt(tx, receiptIdentity)
        if (existingReceipt) return existingReceipt

        const fund = await tx.fund.findFirst({
          where: { id: fundId, organizationId: auth.orgId },
          select: { id: true, currency: true, currentBalance: true, isActive: true },
        })
        if (!fund) throw new FundNotFoundError()
        if (!fund.isActive) throw new FundArchivedError()

        const isCredit = data.type === "deposit"
          || data.type === "transfer_in"
          || data.type === "auto_allocation"
        const signedDelta = isCredit ? amount : new Prisma.Decimal(amount).negated().toFixed(4)
        if (!isCredit && new Prisma.Decimal(String(fund.currentBalance)).lt(amount)) {
          throw new InsufficientFundBalanceError(
            new Prisma.Decimal(String(fund.currentBalance)).toFixed(4),
            amount,
            fund.currency,
          )
        }

        // These DB guards turn an accidental legacy write into a failed
        // transaction. SET LOCAL cannot leak beyond this transaction.
        await tx.$executeRawUnsafe("SET LOCAL app.event_source_write = 'on'")
        await tx.$executeRawUnsafe("SET LOCAL app.event_projection_write = 'on'")

        const updatedFunds = await tx.$queryRawUnsafe<Array<{
          id: string
          currency: string
          currentBalance: Prisma.Decimal
        }>>(
          `UPDATE "funds"
              SET "currentBalance" = "currentBalance" + $3::numeric,
                  "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = $1
              AND "organizationId" = $2
              AND "isActive" = true
              AND ($3::numeric >= 0 OR "currentBalance" >= -$3::numeric)
          RETURNING "id", "currency", "currentBalance"`,
          fundId,
          auth.orgId,
          signedDelta,
        )
        const updatedFund = updatedFunds[0]
        if (!updatedFund) {
          throw new FundChangedConcurrentlyError()
        }

        const transaction = await tx.fundTransaction.create({
          data: {
            organizationId: auth.orgId,
            fundId,
            type: data.type,
            amount: new Prisma.Decimal(amount),
            description: normalizedCommand.description,
            relatedType: "manual",
            createdBy: auth.userId,
          },
        })

        const appended = await appendDomainEvent(tx, {
          organizationId: auth.orgId,
          domain: "finance",
          aggregateType: "fund",
          aggregateId: fundId,
          eventType: "finance.fund-transaction-recorded.v1",
          source: "urn:leaddrive:finance",
          dataSchema: "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
          classification: "confidential",
          subjectRef: `fund/${fundId}`,
          correlationId,
          causationId: commandId,
          commandId,
          producer: "finance-api",
          producerVersion: eventProducerVersion(),
          data: {
            fundId,
            transactionId: transaction.id,
            transactionType: data.type,
            amount,
            signedDelta,
            resultingBalance: new Prisma.Decimal(updatedFund.currentBalance).toFixed(4),
            currency: updatedFund.currency,
            relatedType: "manual",
          },
          occurredAt: transaction.createdAt,
        })

        const projection = await tx.fundBalanceProjection.updateMany({
          where: {
            organizationId: auth.orgId,
            fundId,
            projectionVersion: 1,
            status: "active",
          },
          data: {
            balance: updatedFund.currentBalance,
            aggregateVersion: appended.aggregateVersion,
            lastEventId: appended.eventId,
            evidence: { source: "live-command", eventId: appended.eventId },
          },
        })
        if (projection.count !== 1) {
          throw new Error(`Fund projection invariant failed: expected one active row, found ${projection.count}`)
        }

        let warning: string | undefined
        if (isCredit) {
          const [allFunds, cashFlowEntries] = await Promise.all([
            tx.fund.findMany({
              where: { organizationId: auth.orgId, isActive: true },
              select: { currentBalance: true },
            }),
            tx.cashFlowEntry.findMany({
              where: { organizationId: auth.orgId },
              select: { entryType: true, amount: true },
            }),
          ])
          const totalFunds = allFunds.reduce(
            (sum: Prisma.Decimal, row: { currentBalance: unknown }) => sum.plus(String(row.currentBalance)),
            new Prisma.Decimal(0),
          )
          const totalInflows = cashFlowEntries
            .filter((entry: { entryType: string }) => entry.entryType === "inflow")
            .reduce(
              (sum: Prisma.Decimal, entry: { amount: unknown }) => sum.plus(String(entry.amount)),
              new Prisma.Decimal(0),
            )
          const totalOutflows = cashFlowEntries
            .filter((entry: { entryType: string }) => entry.entryType === "outflow")
            .reduce(
              (sum: Prisma.Decimal, entry: { amount: unknown }) => sum.plus(String(entry.amount)),
              new Prisma.Decimal(0),
            )
          const cashBalance = totalInflows.minus(totalOutflows)
          if (totalFunds.gt(cashBalance) && cashBalance.gt(0)) {
            const coverage = cashBalance.div(totalFunds).mul(100).round().toNumber()
            warning = `Warning: after deposit, total funds (${totalFunds.toFixed(4)} ${getCurrencySymbol()}) will exceed cash balance (${cashBalance.toFixed(4)} ${getCurrencySymbol()}). Coverage: ${coverage}%`
          }
        }

        const balance = decimalToNumber(updatedFund.currentBalance)
        const balanceExact = new Prisma.Decimal(updatedFund.currentBalance).toFixed(4)
        const aggregateVersion = Number(appended.aggregateVersion)
        const normalizedTransaction = normalizeFundTransactionRow(transaction)
        const responseData = {
          ...normalizedTransaction,
          createdAt: transaction.createdAt instanceof Date
            ? transaction.createdAt.toISOString()
            : transaction.createdAt,
          balance,
          balanceExact,
          eventId: appended.eventId,
          aggregateVersion,
          ...(warning ? { warning } : {}),
        }
        const responseBody = {
          data: responseData,
          // Preserve the existing direct-API response shape while the finance
          // hook unwraps `data`; both paths receive the same exact metadata.
          balance,
          balanceExact,
          eventId: appended.eventId,
          aggregateVersion,
          ...(warning ? { warning } : {}),
        }
        return storeCommandReceipt(tx, {
          ...receiptIdentity,
          responseStatus: 201,
          responseBody,
          eventIds: [appended.eventId],
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      return receiptResponse(response)
    } catch (error) {
      // A concurrent request may finish the same key while this transaction is
      // running. Its unique receipt INSERT wins; all local mutations roll back,
      // then the committed response is replayed exactly.
      if (isUniqueConstraintError(error)) {
        try {
          const receipt = await findCommandReceipt(prisma, receiptIdentity)
          if (receipt) return receiptResponse(receipt)
        } catch (receiptError) {
          if (receiptError instanceof IdempotencyConflictError) {
            return NextResponse.json(
              { error: receiptError.message, code: receiptError.code },
              { status: 409 },
            )
          }
          console.error("[finance-fund-event] receipt reconciliation failed", receiptError)
          return NextResponse.json({ error: "Fund transaction outcome requires reconciliation" }, { status: 500 })
        }
      }
      if (error instanceof IdempotencyConflictError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
      }
      if (error instanceof AggregateVersionConflictError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
      }
      if (error instanceof FundNotFoundError) {
        return NextResponse.json({ error: "Fund not found" }, { status: 404 })
      }
      if (error instanceof FundArchivedError) {
        return NextResponse.json({ error: "Archived fund cannot accept transactions" }, { status: 409 })
      }
      if (error instanceof FundChangedConcurrentlyError) {
        return NextResponse.json(
          { error: "Fund changed concurrently; retry with the same Idempotency-Key" },
          { status: 409, headers: { "Retry-After": "1" } },
        )
      }
      if (error instanceof InsufficientFundBalanceError) {
        return NextResponse.json({
          error: `Insufficient fund balance. Balance: ${decimalToNumber(error.balance).toLocaleString(undefined)} ${getCurrencySymbol(error.currency)}, requested: ${decimalToNumber(error.requested).toLocaleString(undefined)} ${getCurrencySymbol(error.currency)}`,
        }, { status: 400 })
      }
      if (error && typeof error === "object" && "code" in error
          && (error as { code?: unknown }).code === "P2034") {
        return NextResponse.json(
          { error: "Concurrent fund update; retry with the same Idempotency-Key" },
          { status: 409, headers: { "Retry-After": "1" } },
        )
      }
      console.error("[finance-fund-event] transaction failed", error)
      return NextResponse.json({ error: "Fund transaction could not be committed" }, { status: 500 })
    }
  },
)
