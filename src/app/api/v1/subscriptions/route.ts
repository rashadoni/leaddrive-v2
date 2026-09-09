/**
 * Subscription registry — D4 Phase 6 Block A slice 2.
 *
 *   POST /api/v1/subscriptions  — create a subscription on a plan
 *   GET  /api/v1/subscriptions  — list (filter by status / planId)
 *
 * Wraps the slice-1 calculateInitialPeriod helper so the trial vs
 * no-trial branching is centralized. POST snapshots plan fields
 * (unitAmount, currency, billingInterval, billingIntervalCount) onto
 * the row — survives later plan-price changes (slice 3 plan upgrade
 * applies the new price via the proration calculator + plan_changed
 * event).
 *
 * Cross-tenant safety: planId, companyId, contactId are all validated
 * via findFirst { id, organizationId } before write. The DB FK
 * (planId → subscription_plans) is org-cascaded, but a wrong-tenant
 * planId would still violate the org boundary at the application layer.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { calculateInitialPeriod } from "@/lib/subscriptions/billing-period-calculator"
import {
  SUBSCRIPTION_STATUSES,
  type PlanSnapshotForCreate,
} from "@/lib/subscriptions/types"
import { normalizeSubscriptionRow, normalizeSubscriptionPlanRow, decimalToNumber } from "@/lib/prisma-decimal"

const createSchema = z
  .object({
    planId: z.string().min(1).max(120),
    companyId: z.string().min(1).max(120).optional(),
    contactId: z.string().min(1).max(120).optional(),
    /** Optional caller-supplied metadata (link-back to win-back source, etc.). */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => d.companyId != null || d.contactId != null, {
    message: "Subscription requires at least one of companyId / contactId",
  })

const statusFilterSchema = z.enum(SUBSCRIPTION_STATUSES).optional()

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("subscriptions", "write", async (req, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Cross-tenant plan check + snapshot read in one query. Shape matches
  // `PlanSnapshotForCreate` from `@/lib/subscriptions/types`; the select
  // clause and the type must stay in sync (see types.ts header).
  const plan = (await prisma.subscriptionPlan.findFirst({
    where: { id: parsed.data.planId, organizationId: auth.orgId },
    select: {
      id: true,
      unitAmount: true,
      currency: true,
      billingInterval: true,
      billingIntervalCount: true,
      trialDays: true,
      isActive: true,
    },
  })) as PlanSnapshotForCreate | null
  if (!plan) {
    return NextResponse.json({ error: "Plan not found in tenant" }, { status: 404 })
  }
  if (!plan.isActive) {
    return NextResponse.json(
      { error: "Plan is archived (isActive=false); cannot create subscription on it" },
      { status: 409 }
    )
  }

  // Cross-tenant subject checks — both optional but at least one supplied
  // (zod refine above guarantees that; we just verify each present one
  // belongs to this tenant).
  if (parsed.data.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: parsed.data.companyId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!company) {
      return NextResponse.json({ error: "Company not found in tenant" }, { status: 404 })
    }
  }
  if (parsed.data.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found in tenant" }, { status: 404 })
    }
  }

  const now = new Date()
  const period = calculateInitialPeriod({
    anchor: now,
    trialDays: plan.trialDays,
    config: {
      billingInterval: plan.billingInterval,
      billingIntervalCount: plan.billingIntervalCount,
    },
  })

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const sub = await tx.subscription.create({
      data: {
        organizationId: auth.orgId,
        planId: plan.id,
        companyId: parsed.data.companyId ?? null,
        contactId: parsed.data.contactId ?? null,
        status: period.initialStatus,
        trialEndsAt: period.trialEndsAt,
        currentPeriodStart: period.currentPeriodStart,
        currentPeriodEnd: period.currentPeriodEnd,
        nextBillingAt: period.nextBillingAt,
        currency: plan.currency,
        unitAmount: decimalToNumber(plan.unitAmount),
        billingInterval: plan.billingInterval,
        billingIntervalCount: plan.billingIntervalCount,
        metadata: (parsed.data.metadata ?? {}) as unknown as Prisma.InputJsonValue,
        createdBy: auth.userId,
      },
    })
    // `created` SubscriptionEvent — append-only audit. Slice 3 reporting
    // (MRR/cohort) reads this; create-now-or-never to keep the audit chain
    // consistent.
    await tx.subscriptionEvent.create({
      data: {
        organizationId: auth.orgId,
        subscriptionId: sub.id,
        eventType: "created",
        newStatus: period.initialStatus,
        newPlanId: plan.id,
        metadata: { source: "api" } as unknown as Prisma.InputJsonValue,
      },
    })
    return sub
  })

  return NextResponse.json({ subscription: normalizeSubscriptionRow(created) }, { status: 201 })
})

export const GET = withRlsAuth("subscriptions", "read", async (req, auth) => {
  const url = new URL(req.url)
  const planId = url.searchParams.get("planId")
  const statusRaw = url.searchParams.get("status")
  const statusParsed = statusFilterSchema.safeParse(statusRaw ?? undefined)
  if (!statusParsed.success) {
    const echo = (statusRaw ?? "").slice(0, 32)
    return NextResponse.json({ error: `Invalid status filter: "${echo}"` }, { status: 400 })
  }

  const subscriptions = await prisma.subscription.findMany({
    where: {
      organizationId: auth.orgId,
      ...(planId ? { planId } : {}),
      ...(statusParsed.data ? { status: statusParsed.data } : {}),
    },
    orderBy: { createdAt: "desc" },
    // TODO(slice 3): cursor pagination alongside the admin subscriptions UI.
    take: 500,
  })

  return NextResponse.json({ subscriptions: subscriptions.map(normalizeSubscriptionRow) })
})
