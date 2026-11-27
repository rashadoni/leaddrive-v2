/**
 * «Продлить» — POST /api/v1/contracts/:id/renew { startDate, endDate, valueAmount? }
 * (owner 2026-11-26, mock «Продление»; rules in src/lib/clm/contract-renewal.ts).
 *
 * Makes the renewal DRAFT of an active, renewing or expired contract: the same parties, type,
 * currency, template and text, the dates and amount given, `renewalSourceContractId` → this one,
 * a number «<old>/<year>» made free, version 1 of its text. An active source becomes «Продлевается».
 * One open renewal at a time: a second press answers 409 RENEWAL_EXISTS with the open one's id.
 * One transaction under the source's row lock; an audit row on each contract.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { createContractDraft } from "@/lib/clm/create-contract-draft"
import { OPEN_RENEWAL_STATUSES, isRenewable, renewalNumberBase } from "@/lib/clm/contract-renewal"
import { parseCalendarDay } from "@/lib/clm/contract-closing"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const bodySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  valueAmount: nonNegativeFinancialAmountSchema.optional(),
})

class Refused extends Error {
  constructor(readonly code: string, readonly status: number, readonly extra: Record<string, unknown> = {}) { super(code) }
}

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { userId } = auth
  const { id } = await params
  if (!userId || auth.principalType === "api_key") return NextResponse.json({ error: "USER_REQUIRED", code: "USER_REQUIRED" }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "RENEWAL_DATES_INVALID", code: "RENEWAL_DATES_INVALID" }, { status: 400 })
  const start = parseCalendarDay(parsed.data.startDate)
  const end = parseCalendarDay(parsed.data.endDate)
  if (!start.ok || !end.ok || end.date.getTime() < start.date.getTime()) {
    return NextResponse.json({ error: "RENEWAL_DATES_INVALID", code: "RENEWAL_DATES_INVALID" }, { status: 400 })
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const source = await tx.contract.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true, contractNumber: true, title: true, type: true, status: true, currency: true, valueAmount: true,
          companyId: true, dealId: true, contactId: true, templateId: true, templateVersion: true,
          renderedBody: true, bodyHtml: true,
        },
      })
      if (!source) throw new Refused("NOT_FOUND", 404)
      if (!isRenewable(source.status)) throw new Refused("NOT_RENEWABLE", 409, { status: source.status })
      const open = await tx.contract.findFirst({
        where: { organizationId: orgId, renewalSourceContractId: id, status: { in: [...OPEN_RENEWAL_STATUSES] } },
        select: { id: true, contractNumber: true },
      })
      if (open) throw new Refused("RENEWAL_EXISTS", 409, { renewal: open })

      const renewal = await createContractDraft(tx, {
        organizationId: orgId,
        userId,
        contractNumber: renewalNumberBase(source.contractNumber, start.day),
        numberGenerated: true,
        title: source.title,
        type: source.type ?? "other",
        renderedBody: source.renderedBody ?? "",
        templateId: source.templateId,
        templateVersion: source.templateVersion,
        companyId: source.companyId,
        dealId: source.dealId,
        contactId: source.contactId,
        startDate: start.date,
        endDate: end.date,
        valueAmount: parsed.data.valueAmount ?? (source.valueAmount === null ? undefined : Number(source.valueAmount)),
        currency: source.currency ?? undefined,
      })
      await tx.contract.update({
        where: { id: renewal.id },
        data: { renewalSourceContractId: id, ...(source.bodyHtml ? { bodyHtml: source.bodyHtml } : {}) },
      })
      // An active source is «Продлевается»; an expired one stays as it is (a closed state).
      const movedSource = source.status === "active"
        ? (await tx.contract.updateMany({ where: { id, organizationId: orgId, status: "active" }, data: { status: "renewing" } })).count === 1
        : false
      await logAudit(orgId, "update", "contract", id, source.title, {
        oldValue: movedSource ? { status: { old: "active", new: "renewing" } } : { status: source.status },
        newValue: { reason: "renewal_created", renewalContractId: renewal.id, renewalNumber: renewal.contractNumber },
        userId,
      }, tx)
      await logAudit(orgId, "create", "contract", renewal.id, renewal.title, {
        newValue: { reason: "renewal_of", sourceContractId: id, sourceNumber: source.contractNumber, startDate: start.day, endDate: end.day },
        userId,
      }, tx)
      return { id: renewal.id, contractNumber: renewal.contractNumber }
    })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (e) {
    if (e instanceof Refused) return NextResponse.json({ error: e.code, code: e.code, ...e.extra }, { status: e.status })
    console.error("[contracts/:id/renew POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
