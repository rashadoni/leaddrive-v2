import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { normalizeFundRow } from "@/lib/prisma-decimal"
import { appendDomainEvent, eventProducerVersion } from "@/lib/event-platform"
import { withRlsAuth } from "@/lib/with-rls"

const updateFundSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  targetAmount: z.union([z.string().min(1).max(64), z.number(), z.null()]).optional(),
  // Currency belongs to the event stream identity. Accept the existing value
  // for old clients, but never permit an in-place currency conversion.
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code").optional(),
  color: z.string().max(20).optional().nullable(),
}).strict()

type RouteContext = { params: Promise<{ id: string }> }

class FundNotFoundError extends Error {}
class FundCurrencyImmutableError extends Error {}
class FundConcurrencyError extends Error {}

function exactNullableMoney(value: string | number | null): Prisma.Decimal | null {
  if (value === null) return null
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

function sameNullableMoney(left: unknown, right: Prisma.Decimal | null): boolean {
  if (left == null || right == null) return left == null && right == null
  return new Prisma.Decimal(String(left)).eq(right)
}

function concurrencyResponse() {
  return NextResponse.json(
    { error: "Concurrent fund update; retry the request" },
    { status: 409, headers: { "Retry-After": "1" } },
  )
}

export const GET = withRlsAuth<RouteContext>(
  "finance",
  "read",
  async (_req, auth, { params }) => {
    const { id } = await params
    const fund = await prisma.fund.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { rules: true },
    })
    if (!fund) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ data: normalizeFundRow(fund) })
  },
)

export const PUT = withRlsAuth<RouteContext>(
  "finance",
  "write",
  async (req, auth, { params }) => {
    const { id } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data: z.infer<typeof updateFundSchema>
    try {
      data = updateFundSchema.parse(body)
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json({ error: "Validation failed", details: error.flatten().fieldErrors }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    let exactTarget: Prisma.Decimal | null | undefined
    try {
      exactTarget = data.targetAmount === undefined ? undefined : exactNullableMoney(data.targetAmount)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid targetAmount" },
        { status: 400 },
      )
    }

    try {
      const fund = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.fund.findFirst({
          where: { id, organizationId: auth.orgId },
        })
        if (!existing) throw new FundNotFoundError()
        if (data.currency !== undefined && data.currency !== existing.currency) {
          throw new FundCurrencyImmutableError()
        }

        const changedFields: string[] = []
        if (data.name !== undefined && data.name !== existing.name) changedFields.push("name")
        if (data.description !== undefined && data.description !== existing.description) changedFields.push("description")
        if (exactTarget !== undefined && !sameNullableMoney(existing.targetAmount, exactTarget)) changedFields.push("targetAmount")
        if (data.color !== undefined && data.color !== existing.color) changedFields.push("color")
        if (changedFields.length === 0) return existing

        await tx.$executeRawUnsafe("SET LOCAL app.event_source_write = 'on'")
        await tx.$executeRawUnsafe("SET LOCAL app.event_projection_write = 'on'")
        const updated = await tx.fund.update({
          where: { id },
          data: {
            ...(data.name !== undefined && { name: data.name }),
            ...(data.description !== undefined && { description: data.description }),
            ...(exactTarget !== undefined && { targetAmount: exactTarget }),
            ...(data.color !== undefined && { color: data.color }),
          },
        })
        const appended = await appendDomainEvent(tx, {
          organizationId: auth.orgId,
          domain: "finance",
          aggregateType: "fund",
          aggregateId: id,
          eventType: "finance.fund-metadata-updated.v1",
          source: "urn:leaddrive:finance",
          dataSchema: "urn:leaddrive:schema:finance.fund-metadata-updated:v1",
          classification: "confidential",
          subjectRef: `fund/${id}`,
          producer: "finance-api",
          producerVersion: eventProducerVersion(),
          data: {
            fundId: id,
            changedFields,
            name: updated.name,
            description: updated.description,
            targetAmount: updated.targetAmount == null
              ? null
              : new Prisma.Decimal(String(updated.targetAmount)).toFixed(4),
            currency: updated.currency,
            color: updated.color,
            isActive: updated.isActive,
          },
        })
        const projection = await tx.fundBalanceProjection.updateMany({
          where: {
            organizationId: auth.orgId,
            fundId: id,
            projectionVersion: 1,
            status: "active",
          },
          data: {
            aggregateVersion: appended.aggregateVersion,
            lastEventId: appended.eventId,
            evidence: { source: "live-command", eventId: appended.eventId },
          },
        })
        if (projection.count !== 1) {
          throw new Error(`Fund projection invariant failed: expected one active row, found ${projection.count}`)
        }
        return updated
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      return NextResponse.json({ data: normalizeFundRow(fund) })
    } catch (error) {
      if (error instanceof FundNotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 })
      if (error instanceof FundCurrencyImmutableError) {
        return NextResponse.json({ error: "Fund currency is immutable after creation" }, { status: 409 })
      }
      if (error && typeof error === "object" && "code" in error
          && (error as { code?: unknown }).code === "P2034") return concurrencyResponse()
      console.error("[finance-fund-event] metadata update failed", error)
      return NextResponse.json({ error: "Fund update could not be committed" }, { status: 500 })
    }
  },
)

export const DELETE = withRlsAuth<RouteContext>(
  "finance",
  "delete",
  async (_req, auth, { params }) => {
    const { id } = await params
    try {
      const archived = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.fund.findFirst({
          where: { id, organizationId: auth.orgId },
          select: { id: true, isActive: true },
        })
        if (!existing) throw new FundNotFoundError()
        if (!existing.isActive) return false

        await tx.$executeRawUnsafe("SET LOCAL app.event_source_write = 'on'")
        await tx.$executeRawUnsafe("SET LOCAL app.event_projection_write = 'on'")
        const changed = await tx.fund.updateMany({
          where: { id, organizationId: auth.orgId, isActive: true },
          data: { isActive: false },
        })
        if (changed.count !== 1) throw new FundConcurrencyError()

        const appended = await appendDomainEvent(tx, {
          organizationId: auth.orgId,
          domain: "finance",
          aggregateType: "fund",
          aggregateId: id,
          eventType: "finance.fund-archived.v1",
          source: "urn:leaddrive:finance",
          dataSchema: "urn:leaddrive:schema:finance.fund-archived:v1",
          classification: "confidential",
          subjectRef: `fund/${id}`,
          producer: "finance-api",
          producerVersion: eventProducerVersion(),
          data: { fundId: id, reason: "user-requested" },
        })
        const projection = await tx.fundBalanceProjection.updateMany({
          where: {
            organizationId: auth.orgId,
            fundId: id,
            projectionVersion: 1,
            status: "active",
          },
          data: {
            aggregateVersion: appended.aggregateVersion,
            lastEventId: appended.eventId,
            evidence: { source: "live-command", eventId: appended.eventId },
          },
        })
        if (projection.count !== 1) {
          throw new Error(`Fund projection invariant failed: expected one active row, found ${projection.count}`)
        }
        return true
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

      return NextResponse.json({ data: { success: true, archived: true, changed: archived } })
    } catch (error) {
      if (error instanceof FundNotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 })
      if (error instanceof FundConcurrencyError) return concurrencyResponse()
      if (error && typeof error === "object" && "code" in error
          && (error as { code?: unknown }).code === "P2034") return concurrencyResponse()
      console.error("[finance-fund-event] archive failed", error)
      return NextResponse.json({ error: "Fund archive could not be committed" }, { status: 500 })
    }
  },
)
