import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { normalizeContractRow, decimalToNumber } from "@/lib/prisma-decimal"
import { CONTRACT_STATUSES } from "@/lib/contract-lifecycle/types"
import { upsertRenewalAlerts } from "@/lib/contract-lifecycle/upsert-renewal-alerts"
import { withRlsAuth } from "@/lib/with-rls"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const updateContractSchema = z.object({
  contractNumber: z.string().optional(),
  title: z.string().optional(),
  companyId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  type: z.string().optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  valueAmount: nonNegativeFinancialAmountSchema.optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
})

export const GET = withRlsAuth("contracts", "read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  try {
    // NOTE: This route uses `include` (relations only), so every base
    // Contract column is returned by default — including
    // `spawnedFromQuoteId` which the detail page at
    // `src/app/(dashboard)/contracts/[id]/page.tsx` consumes to render
    // the "Auto-spawned from quote" provenance backlink (slice-3
    // piece-4.5). If you ever convert this to `select:`, you MUST
    // include `spawnedFromQuoteId: true` or the chip silently disappears.
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      include: {
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, name: true } },
        contact: { select: { id: true, fullName: true } },
        // FIX 2: org-filter tag reads — defense-in-depth vs implicit m2m
        tags: { where: { organizationId: orgId }, select: { id: true, name: true, color: true } },
        approvalStages: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            label: true,
            status: true,
            assigneeUserId: true,
            assigneeRole: true,
            slaHours: true,
            dueAt: true,
            escalationLevel: true,
            decidedAt: true,
            decidedBy: true,
          },
        },
      },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Fetch history from audit log
    const history = await prisma.auditLog.findMany({
      where: { organizationId: orgId, entityType: "contract", entityId: id },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE.DEFAULT,
    })

    return NextResponse.json({ success: true, data: { ...normalizeContractRow(contract), history } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const body = await req.json()
  const parsed = updateContractSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    // Get old values for audit
    const oldContract = await prisma.contract.findFirst({ where: { id, organizationId: orgId } })
    if (!oldContract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (parsed.data.status !== undefined && parsed.data.status !== oldContract.status) {
      return NextResponse.json(
        {
          error: "Contract status must be changed through lifecycle actions",
          code: "LIFECYCLE_ACTION_REQUIRED",
        },
        { status: 409 },
      )
    }

    // Cross-tenant FK guard: validate any supplied companyId/dealId/contactId belong
    // to this org BEFORE the $transaction. Only check FKs present in the payload
    // (null means explicit clear — skip validation; undefined means not supplied).
    if (parsed.data.companyId != null && parsed.data.companyId !== undefined) {
      const c = await prisma.company.findFirst({
        where: { id: parsed.data.companyId, organizationId: orgId },
        select: { id: true },
      })
      if (!c) return NextResponse.json({ error: "Company not found in this tenant" }, { status: 404 })
    }
    if (parsed.data.dealId != null && parsed.data.dealId !== undefined) {
      const d = await prisma.deal.findFirst({
        where: { id: parsed.data.dealId, organizationId: orgId },
        select: { id: true },
      })
      if (!d) return NextResponse.json({ error: "Deal not found in this tenant" }, { status: 404 })
    }
    if (parsed.data.contactId != null && parsed.data.contactId !== undefined) {
      const ct = await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, organizationId: orgId },
        select: { id: true },
      })
      if (!ct) return NextResponse.json({ error: "Contact not found in this tenant" }, { status: 404 })
    }

    // Cross-tenant guard: if tagIds supplied, verify ALL belong to this org
    if (parsed.data.tagIds !== undefined) {
      if (parsed.data.tagIds.length > 0) {
        const tagCount = await prisma.contractTag.count({
          where: { id: { in: parsed.data.tagIds }, organizationId: orgId },
        })
        if (tagCount !== parsed.data.tagIds.length) {
          return NextResponse.json({ error: "One or more tags not found in this organization" }, { status: 400 })
        }
      }
    }

    // Separate scalar data from tagIds (updateMany doesn't support relation writes)
    const { tagIds: newTagIds, status: _ignoredStatus, ...scalarData } = parsed.data

    // FIX 4: wrap scalar update + tag.set in ONE $transaction — prevents partial
    // apply where the scalar write commits but the tag write fails (or vice-versa).
    const scalarPayload = {
      ...scalarData,
      companyId: scalarData.companyId === null ? null : scalarData.companyId || undefined,
      dealId: scalarData.dealId === null ? null : scalarData.dealId || undefined,
      contactId: scalarData.contactId === null ? null : scalarData.contactId || undefined,
      startDate: scalarData.startDate ? new Date(scalarData.startDate) : undefined,
      // null → explicitly clear the date; undefined → not in payload, leave as-is
      endDate: scalarData.endDate === null
        ? null
        : scalarData.endDate
        ? new Date(scalarData.endDate)
        : undefined,
    }

    const { updateCount } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: oldContract.status },
        data: scalarPayload,
      })
      if (result.count === 0) return { updateCount: 0 }

      // Tag assignment — use update (not updateMany) to support relation writes
      if (newTagIds !== undefined) {
        await tx.contract.update({
          where: { id },
          data: {
            tags: { set: newTagIds.map((tagId: string) => ({ id: tagId })) },
          },
        })
      }
      return { updateCount: result.count }
    })

    if (updateCount === 0) {
      const stillExists = await prisma.contract.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      })
      if (stillExists) {
        return NextResponse.json(
          {
            error: "Contract changed while saving. Refresh and try again.",
            code: "CONTRACT_STATE_CHANGED",
          },
          { status: 409 },
        )
      }

      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updated = await prisma.contract.findFirst({ where: { id, organizationId: orgId } })

    // Log changes to audit
    const changes: Record<string, { old: any; new: any }> = {}
    const fields = ["contractNumber", "title", "companyId", "dealId", "contactId", "type", "status", "currency", "notes"] as const
    for (const f of fields) {
      const oldVal = (oldContract as any)[f]
      const newVal = (updated as any)[f]
      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        changes[f] = { old: oldVal, new: newVal }
      }
    }
    // valueAmount: compare as numbers to avoid Decimal/float string mismatch
    const oldAmount = decimalToNumber(oldContract.valueAmount)
    const newAmount = decimalToNumber(updated?.valueAmount)
    if (oldAmount !== newAmount) {
      changes.valueAmount = { old: oldAmount, new: newAmount }
    }
    // Check dates separately
    const oldStart = oldContract.startDate?.toISOString().split("T")[0] || ""
    const newStart = updated?.startDate?.toISOString().split("T")[0] || ""
    if (oldStart !== newStart) changes.startDate = { old: oldStart, new: newStart }
    const oldEnd = oldContract.endDate?.toISOString().split("T")[0] || ""
    const newEnd = updated?.endDate?.toISOString().split("T")[0] || ""
    if (oldEnd !== newEnd) changes.endDate = { old: oldEnd, new: newEnd }

    if (Object.keys(changes).length > 0) {
      await prisma.auditLog.create({
        data: {
          organizationId: orgId,
          action: "update",
          entityType: "contract",
          entityId: id,
          entityName: updated?.title || oldContract.title,
          oldValue: changes,
          newValue: parsed.data,
        },
      }).catch(() => {}) // non-critical
    }

    // Re-schedule renewal alerts whenever endDate is part of the update
    // payload (even if unchanged — upsert is idempotent). This also handles
    // the case where endDate is moved forward/backward.
    if ("endDate" in parsed.data && updated) {
      upsertRenewalAlerts(orgId, id, updated.endDate ?? null).catch((err) =>
        console.error("[contracts PUT] upsertRenewalAlerts failed:", err),
      )
    }

    return NextResponse.json({ success: true, data: updated ? normalizeContractRow(updated) : null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  try {
    const contract = await prisma.contract.findFirst({ where: { id, organizationId: orgId } })
    const result = await prisma.contract.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Log deletion
    if (contract) {
      await prisma.auditLog.create({
        data: {
          organizationId: orgId,
          action: "delete",
          entityType: "contract",
          entityId: id,
          entityName: contract.title,
          oldValue: contract as any,
        },
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
