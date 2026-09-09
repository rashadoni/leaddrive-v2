/**
 * R6 Energy & Utilities — customer roster / create (slice-2-mini).
 *
 * Twentieth route-layer consumer. Utility customer rows carry PII
 * (accountHolderName, serviceAddress). Audit via
 * `recordPiiAccessFromRequest`.
 *
 * Status lifecycle (slice-1 `transitionCustomer` helper):
 *   prospect → active | terminated
 *   active → suspended | terminated
 *   suspended → active | terminated
 *   terminated — terminal
 *
 * Schema default status is `active` — auto-stamp `activatedAt = now()`
 * on creation to satisfy DB CHECK `active_coherence_check` unless
 * caller explicitly creates as `prospect`.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { CUSTOMER_CLASSES } from "@/lib/energy-utilities/types"
import {
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 extras PR-1 (2026-05-29): column-bound AAD on the 6
// PII columns — 3 required (accountHolderName, serviceAddressLine1,
// serviceCity) via strict bound encrypt + 3 optional
// (serviceAddressLine2, servicePostalCode, serviceCountry) via bound
// OrNull. AAD binds to (orgId, utility_customers, "<column>"); soft-
// decrypt fallback handles slice-2 ciphertext + pre-wrap plaintext.
const TABLE = "utility_customers"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200
const MAX_ADDR_LEN = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

export const GET = withRlsAuth("energy-utilities", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const customerClass = searchParams.get("customerClass")
  const search = searchParams.get("search")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    customerClass?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (status) where.status = status
  if (customerClass) where.customerClass = customerClass
  // accountHolderName + serviceCity are encrypted (slice-2 column
  // wrap) — substring search against ciphertext returns zero results.
  // Slice-3 will add blind-index hash columns. Until then search hits
  // accountNumber only.
  if (search && search.length >= 2) {
    where.OR = [
      { accountNumber: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const customers = await prisma.utilityCustomer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        accountNumber: true,
        contactId: true,
        accountHolderName: true,
        serviceCity: true,
        servicePostalCode: true,
        customerClass: true,
        status: true,
        activatedAt: true,
        suspendedAt: true,
        terminatedAt: true,
        createdAt: true,
      },
    })
    const hasMore = customers.length > limit
    const rawRows = hasMore ? customers.slice(0, limit) : customers
    // Soft-decrypt encrypted PII columns in list response.
    const rows = rawRows.map(
      (c: { accountHolderName: string; serviceCity: string; servicePostalCode: string | null } & Record<string, unknown>) => ({
        ...c,
        accountHolderName: softDecryptForTenantBound(orgId, TABLE, "accountHolderName", c.accountHolderName),
        serviceCity: softDecryptForTenantBound(orgId, TABLE, "serviceCity", c.serviceCity),
        servicePostalCode: softDecryptForTenantBound(orgId, TABLE, "servicePostalCode", c.servicePostalCode),
      }),
    )
    const nextCursor = hasMore ? (rows[rows.length - 1].id as string) : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        customerClass: customerClass ?? null,
        searchHit: search !== null && search.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ customers: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[utility-customers] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load customers" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  accountNumber?: unknown
  contactId?: unknown
  accountHolderName?: unknown
  serviceAddressLine1?: unknown
  serviceAddressLine2?: unknown
  serviceCity?: unknown
  servicePostalCode?: unknown
  serviceCountry?: unknown
  customerClass?: unknown
  status?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("energy-utilities", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const accountNumber = trimOrNull(body.accountNumber, 64)
  if (!accountNumber) {
    return NextResponse.json(
      { error: "`accountNumber` is required" },
      { status: 400 },
    )
  }
  const accountHolderName = trimOrNull(body.accountHolderName, MAX_NAME_LEN)
  if (!accountHolderName) {
    return NextResponse.json(
      { error: "`accountHolderName` is required" },
      { status: 400 },
    )
  }
  const serviceAddressLine1 = trimOrNull(body.serviceAddressLine1, MAX_ADDR_LEN)
  if (!serviceAddressLine1) {
    return NextResponse.json(
      { error: "`serviceAddressLine1` is required" },
      { status: 400 },
    )
  }
  const serviceCity = trimOrNull(body.serviceCity, 100)
  if (!serviceCity) {
    return NextResponse.json(
      { error: "`serviceCity` is required" },
      { status: 400 },
    )
  }

  let customerClass: string = "residential"
  if (body.customerClass !== undefined && body.customerClass !== null) {
    if (
      typeof body.customerClass !== "string" ||
      !(CUSTOMER_CLASSES as readonly string[]).includes(body.customerClass)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`customerClass\` — must be one of: ${CUSTOMER_CLASSES.join(", ")}`,
        },
        { status: 400 },
      )
    }
    customerClass = body.customerClass
  }

  // Schema default status is "active". Caller can override to
  // "prospect" if it's not yet provisioned. Status "suspended" /
  // "terminated" not allowed on create — those reached via PATCH.
  let status: string = "active"
  if (body.status !== undefined && body.status !== null) {
    if (
      typeof body.status !== "string" ||
      (body.status !== "active" && body.status !== "prospect")
    ) {
      return NextResponse.json(
        {
          error: "`status` on create must be `active` or `prospect`",
        },
        { status: 400 },
      )
    }
    status = body.status
  }

  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  try {
    const customer = await prisma.utilityCustomer.create({
      data: {
        organizationId: orgId,
        accountNumber,
        contactId: trimOrNull(body.contactId, 64),
        // Slice-2 PII column wrap: account holder name + service
        // address are PII; encrypt at the route boundary.
        accountHolderName: encryptForTenantBound(orgId, TABLE, "accountHolderName", accountHolderName),
        serviceAddressLine1: encryptForTenantBound(orgId, TABLE, "serviceAddressLine1", serviceAddressLine1),
        serviceAddressLine2: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "serviceAddressLine2",
          trimOrNull(body.serviceAddressLine2, MAX_ADDR_LEN),
        ),
        serviceCity: encryptForTenantBound(orgId, TABLE, "serviceCity", serviceCity),
        servicePostalCode: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "servicePostalCode",
          trimOrNull(body.servicePostalCode, 32),
        ),
        serviceCountry: encryptForTenantBoundOrNull(
          orgId,
          TABLE,
          "serviceCountry",
          trimOrNull(body.serviceCountry, 64),
        ),
        customerClass,
        status,
        // active_coherence_check requires activatedAt NOT NULL when
        // status is active/suspended/terminated. Auto-stamp on create
        // when status=active.
        activatedAt: status === "active" ? new Date() : null,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        accountNumber: true,
        accountHolderName: true,
        serviceCity: true,
        customerClass: true,
        status: true,
        activatedAt: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: customer.id,
      action: "write",
      metadata: {
        accountNumber: customer.accountNumber,
        customerClass: customer.customerClass,
        status: customer.status,
      },
    })

    return NextResponse.json(
      {
        customer: {
          ...customer,
          accountHolderName: softDecryptForTenantBound(
            orgId,
            TABLE,
            "accountHolderName",
            customer.accountHolderName,
          ),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: "A customer with this `accountNumber` already exists",
        },
        { status: 409 },
      )
    }
    console.error("[utility-customers] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create customer" },
      { status: 500 },
    )
  }
})
