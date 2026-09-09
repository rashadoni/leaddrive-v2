/**
 * R7 Insurance — policy roster / create (slice-2-mini).
 *
 * Mirrors PR #93 R2 health-patients pattern. Real route-layer consumer
 * of `recordPiiAccessFromRequest` (Personal Insurance Information audit
 * — required by state DOI regulators on policy-data accesses).
 *
 * Status lifecycle (slice-1 `transitionPolicy` helper):
 *   quote → bound → active
 *   (expired / lapsed / cancelled side exits, all terminal)
 *
 * Policy is child of PolicyHolder; FK enforces cross-tenant isolation
 * but we still pre-check holder ownership belt-and-braces.
 *
 * Decimal-money discipline: coverageLimit / deductible / annualPremium
 * are Decimal(18,2). Route accepts JSON number OR string and converts
 * to Prisma.Decimal — never Float arithmetic on the way through. Same
 * P0 plan as D5 Payments.
 *
 * Encryption note: The Policy model carries no customer-PII columns on
 * create (policyNumber is institutional; financials are Decimal). The
 * one PII-adjacent text field — `cancellationReason` — is written only
 * via PATCH (status → cancelled) and is encrypted there via slice-3
 * column-bound AAD (`encryptForTenantBoundOrNull` with
 * `(orgId, "policies", "cancellationReason")` — see `[id]/route.ts`).
 * This list endpoint intentionally omits `cancellationReason` from
 * its select, so no decrypt step is needed here.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { LINES_OF_BUSINESS, BILLING_FREQUENCIES } from "@/lib/insurance/types"

const TABLE = "policies"
const MAX_PAGE_SIZE = 200
const MAX_GENERIC_LEN = 200

function strField(v: unknown, max: number = MAX_GENERIC_LEN): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

function parseDecimal(
  v: unknown,
  allowNegative = false,
): Prisma.Decimal | null | "invalid" {
  if (v === undefined || v === null) return null
  // Accept number or numeric string. Reject Infinity / NaN /
  // >2-decimal precision. The DB stores Decimal(18,2) — the route is
  // the rounding/rejection boundary, not Postgres. Both number and
  // string paths reject the same way to avoid silent rounding only on
  // the number path.
  let raw: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid"
    raw = String(v)
  } else if (typeof v === "string") {
    raw = v.trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "invalid"
  } else {
    return "invalid"
  }
  // Enforce max 2 decimal places on both paths.
  const dot = raw.indexOf(".")
  if (dot !== -1 && raw.length - dot - 1 > 2) {
    return "invalid"
  }
  try {
    const d = new Prisma.Decimal(raw)
    if (!allowNegative && d.isNegative()) return "invalid"
    return d
  } catch {
    return "invalid"
  }
}

export const GET = withRlsAuth("insurance", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const lineOfBusiness = searchParams.get("lineOfBusiness")
  const policyHolderId = searchParams.get("policyHolderId")
  const underwriterId = searchParams.get("underwriterId")
  // `policyNumberSearch` only — policies don't carry name/email of
  // their own (those live on the linked PolicyHolder, queried via a
  // separate /policy-holders search). Operator UX is honest: this
  // param matches policyNumber alone.
  const policyNumberSearch = searchParams.get("policyNumberSearch")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    lineOfBusiness?: string
    policyHolderId?: string
    underwriterId?: string
    policyNumber?: { contains: string; mode: "insensitive" }
  } = { organizationId: orgId }
  if (status) where.status = status
  if (lineOfBusiness) where.lineOfBusiness = lineOfBusiness
  if (policyHolderId) where.policyHolderId = policyHolderId
  if (underwriterId) where.underwriterId = underwriterId
  if (policyNumberSearch && policyNumberSearch.length > 0) {
    where.policyNumber = { contains: policyNumberSearch, mode: "insensitive" }
  }

  try {
    const policies = await prisma.policy.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        policyNumber: true,
        policyHolderId: true,
        lineOfBusiness: true,
        status: true,
        coverageLimit: true,
        annualPremium: true,
        billingFrequency: true,
        effectiveDate: true,
        expirationDate: true,
        underwriterId: true,
        createdAt: true,
      },
    })
    const hasMore = policies.length > limit
    const rows = hasMore ? policies.slice(0, limit) : policies
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        lineOfBusiness: lineOfBusiness ?? null,
        policyHolderId: policyHolderId ?? null,
        underwriterId: underwriterId ?? null,
        searchHit:
          policyNumberSearch !== null && policyNumberSearch.length > 0,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ policies: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[policies] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load policies" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  policyNumber?: unknown
  policyHolderId?: unknown
  lineOfBusiness?: unknown
  coverageLimit?: unknown
  deductible?: unknown
  annualPremium?: unknown
  billingFrequency?: unknown
  effectiveDate?: unknown
  expirationDate?: unknown
  underwriterId?: unknown
}

export const POST = withRlsAuth("insurance", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const policyNumber = strField(body.policyNumber, 64)
  if (!policyNumber) {
    return NextResponse.json(
      { error: "`policyNumber` is required" },
      { status: 400 },
    )
  }
  const policyHolderId = strField(body.policyHolderId, 64)
  if (!policyHolderId) {
    return NextResponse.json(
      { error: "`policyHolderId` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.lineOfBusiness !== "string" ||
    !(LINES_OF_BUSINESS as readonly string[]).includes(body.lineOfBusiness)
  ) {
    return NextResponse.json(
      {
        error: `\`lineOfBusiness\` is required and must be one of: ${LINES_OF_BUSINESS.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const lineOfBusiness = body.lineOfBusiness

  let billingFrequency: string = "annual"
  if (body.billingFrequency !== undefined && body.billingFrequency !== null) {
    if (
      typeof body.billingFrequency !== "string" ||
      !(BILLING_FREQUENCIES as readonly string[]).includes(body.billingFrequency)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`billingFrequency\` — must be one of: ${BILLING_FREQUENCIES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    billingFrequency = body.billingFrequency
  }

  // Decimal money — non-negative for all three.
  const coverageLimit = parseDecimal(body.coverageLimit ?? 0)
  if (coverageLimit === "invalid") {
    return NextResponse.json(
      { error: "Invalid `coverageLimit` (must be non-negative number)" },
      { status: 400 },
    )
  }
  const annualPremium = parseDecimal(body.annualPremium ?? 0)
  if (annualPremium === "invalid") {
    return NextResponse.json(
      { error: "Invalid `annualPremium` (must be non-negative number)" },
      { status: 400 },
    )
  }
  const deductible = parseDecimal(body.deductible)
  if (deductible === "invalid") {
    return NextResponse.json(
      { error: "Invalid `deductible` (must be non-negative number)" },
      { status: 400 },
    )
  }

  const effectiveDate = parseDate(body.effectiveDate)
  if (effectiveDate === "invalid") {
    return NextResponse.json(
      { error: "Invalid `effectiveDate`" },
      { status: 400 },
    )
  }
  const expirationDate = parseDate(body.expirationDate)
  if (expirationDate === "invalid") {
    return NextResponse.json(
      { error: "Invalid `expirationDate`" },
      { status: 400 },
    )
  }
  if (
    effectiveDate &&
    expirationDate &&
    expirationDate.getTime() <= effectiveDate.getTime()
  ) {
    return NextResponse.json(
      { error: "`expirationDate` must be after `effectiveDate`" },
      { status: 400 },
    )
  }

  // Tenant pre-check on holder. underwriter is optional + same-tenant
  // verified only if present.
  const holderCheck = await prisma.policyHolder.findFirst({
    where: { id: policyHolderId, organizationId: orgId },
    select: { id: true },
  })
  if (!holderCheck) {
    return NextResponse.json(
      { error: "Policy holder not found for this tenant" },
      { status: 404 },
    )
  }

  const underwriterId = strField(body.underwriterId, 64)
  if (underwriterId) {
    const u = await prisma.insuranceServiceTeamMember.findFirst({
      where: { id: underwriterId, organizationId: orgId },
      select: { id: true },
    })
    if (!u) {
      return NextResponse.json(
        { error: "Underwriter not found for this tenant" },
        { status: 404 },
      )
    }
  }

  try {
    const policy = await prisma.policy.create({
      data: {
        organizationId: orgId,
        policyNumber,
        policyHolderId,
        lineOfBusiness,
        coverageLimit: coverageLimit ?? new Prisma.Decimal(0),
        annualPremium: annualPremium ?? new Prisma.Decimal(0),
        deductible: deductible ?? null,
        billingFrequency,
        effectiveDate,
        expirationDate,
        underwriterId,
      },
      select: {
        id: true,
        policyNumber: true,
        policyHolderId: true,
        lineOfBusiness: true,
        status: true,
        coverageLimit: true,
        annualPremium: true,
        billingFrequency: true,
        effectiveDate: true,
        expirationDate: true,
        underwriterId: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: policy.id,
      action: "write",
      metadata: {
        policyNumber: policy.policyNumber,
        policyHolderId: policy.policyHolderId,
        lineOfBusiness: policy.lineOfBusiness,
      },
    })

    return NextResponse.json({ policy }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A policy with this `policyNumber` already exists" },
        { status: 409 },
      )
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Invalid foreign key (`policyHolderId` / `underwriterId`)" },
        { status: 400 },
      )
    }
    console.error("[policies] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create policy" },
      { status: 500 },
    )
  }
})
