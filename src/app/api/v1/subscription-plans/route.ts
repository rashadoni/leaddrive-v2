/**
 * Subscription-plan catalog — D4 Phase 6 Block A slice 2.
 *
 *   POST /api/v1/subscription-plans  — create a plan
 *   GET  /api/v1/subscription-plans  — list (filter by isActive)
 *
 * Plans are the catalog rows a Subscription references via FK
 * (ON DELETE RESTRICT — deleting a plan with active subscriptions is
 * blocked at the DB level). Slice 3 adds the plan-archive workflow
 * (soft-deactivate by setting isActive=false) + admin UI.
 *
 * RBAC: gated on `subscriptions:write`. With the default role matrix,
 * manager + sales can create plans; that matches sibling modules
 * (`pricing` / `commerce` / `invoices`) where sales reps create
 * catalog rows in B2B workflows. Tighter "plans = admin-only" RBAC
 * is deferred to slice 3 alongside a `subscription-plans:write`
 * scope split, IF a customer asks for the separation.
 *
 * Snapshot semantics: Subscription.unitAmount + billingInterval are
 * captured AT CREATE TIME from the plan; later plan price changes do
 * NOT retro-mutate active subscriptions (mirrors the D1 BuyerOrderItem
 * immutable-line-item pattern).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { normalizeSubscriptionPlanRow } from "@/lib/prisma-decimal"

const BILLING_INTERVALS = ["day", "week", "month", "year"] as const

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  unitAmount: z.number().min(0).max(1_000_000_000),
  currency: z.string().length(3).optional(),
  billingInterval: z.enum(BILLING_INTERVALS).optional(),
  billingIntervalCount: z.number().int().min(1).max(365).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
})

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

  const created = await prisma.subscriptionPlan.create({
    data: {
      organizationId: auth.orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      unitAmount: parsed.data.unitAmount,
      currency: parsed.data.currency ?? "USD",
      billingInterval: parsed.data.billingInterval ?? "month",
      billingIntervalCount: parsed.data.billingIntervalCount ?? 1,
      trialDays: parsed.data.trialDays ?? 0,
      isActive: parsed.data.isActive ?? true,
      createdBy: auth.userId,
    },
  })

  return NextResponse.json({ plan: normalizeSubscriptionPlanRow(created) }, { status: 201 })
})

export const GET = withRlsAuth("subscriptions", "read", async (req, auth) => {
  const url = new URL(req.url)
  const isActiveRaw = url.searchParams.get("isActive")
  let isActiveFilter: boolean | undefined
  if (isActiveRaw === "true") isActiveFilter = true
  else if (isActiveRaw === "false") isActiveFilter = false
  else if (isActiveRaw != null) {
    return NextResponse.json(
      { error: `Invalid isActive filter: "${isActiveRaw.slice(0, 16)}" (expected "true" or "false")` },
      { status: 400 }
    )
  }

  const plans = await prisma.subscriptionPlan.findMany({
    where: {
      organizationId: auth.orgId,
      ...(isActiveFilter !== undefined ? { isActive: isActiveFilter } : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    // TODO(slice 3): cursor pagination paired with the admin catalog UI.
    take: 500,
  })

  return NextResponse.json({ plans: plans.map(normalizeSubscriptionPlanRow) })
})
