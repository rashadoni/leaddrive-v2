/**
 * R6 Energy & Utilities — customer per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — three-way handling + transitionCustomer slice-1 helper.
 *   Auto-stamps activatedAt / suspendedAt / terminatedAt; STATUS_RANK
 *   backfill ensures activatedAt is present on any transition to
 *   active/suspended/terminated (DB CHECK `active_coherence`).
 *
 * Immutable on PATCH:
 *   • accountNumber — institutional billing identifier
 *
 * DELETE NOT exposed — customers referenced by meteringPoints /
 * serviceCalls; use status=terminated to retire.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { withRlsAuth } from "@/lib/with-rls"
import { transitionCustomer } from "@/lib/energy-utilities/state-machine"
import {
  CUSTOMER_CLASSES,
  type CustomerStatus,
} from "@/lib/energy-utilities/types"
import {
  encryptForTenantBound,
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 extras PR-1 (2026-05-29): column-bound AAD. See
// `utility-customers/route.ts` header for full rationale.
const TABLE = "utility_customers"
const MAX_NAME_LEN = 200
const MAX_ADDR_LEN = 200

// PII columns encrypted at the slice-2 column-by-column wrap.
const PII_COLUMNS = new Set<string>([
  "accountHolderName",
  "serviceAddressLine1",
  "serviceAddressLine2",
  "serviceCity",
  "servicePostalCode",
  "serviceCountry",
])

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

const STATUS_RANK: Record<CustomerStatus, number> = {
  prospect: 0,
  active: 1,
  suspended: 2,
  terminated: 3,
}

export const GET = withRlsAuth("energy-utilities", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing customer id" },
      { status: 400 },
    )
  }

  try {
    const customer = await prisma.utilityCustomer.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!customer) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: customer.id,
      action: "read",
      metadata: {
        accountNumber: customer.accountNumber,
        customerClass: customer.customerClass,
        status: customer.status,
      },
    })

    return NextResponse.json({
      customer: {
        ...customer,
        accountHolderName: softDecryptForTenantBound(
          orgId,
          TABLE,
          "accountHolderName",
          customer.accountHolderName,
        ),
        serviceAddressLine1: softDecryptForTenantBound(
          orgId,
          TABLE,
          "serviceAddressLine1",
          customer.serviceAddressLine1,
        ),
        serviceAddressLine2: softDecryptForTenantBound(
          orgId,
          TABLE,
          "serviceAddressLine2",
          customer.serviceAddressLine2,
        ),
        serviceCity: softDecryptForTenantBound(orgId, TABLE, "serviceCity", customer.serviceCity),
        servicePostalCode: softDecryptForTenantBound(
          orgId,
          TABLE,
          "servicePostalCode",
          customer.servicePostalCode,
        ),
        serviceCountry: softDecryptForTenantBound(orgId, TABLE, "serviceCountry", customer.serviceCountry),
      },
    })
  } catch (err) {
    console.error("[utility-customers/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load customer" },
      { status: 500 },
    )
  }
})

interface PatchBody {
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

export const PATCH = withRlsAuth("energy-utilities", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing customer id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.utilityCustomer.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      activatedAt: true,
      suspendedAt: true,
      terminatedAt: true,
    },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Customer not found" },
      { status: 404 },
    )
  }

  const data: {
    contactId?: string | null
    accountHolderName?: string
    serviceAddressLine1?: string
    serviceAddressLine2?: string | null
    serviceCity?: string
    servicePostalCode?: string | null
    serviceCountry?: string | null
    customerClass?: string
    status?: string
    activatedAt?: Date
    suspendedAt?: Date
    terminatedAt?: Date
    metadata?: unknown
  } = {}

  if (body.contactId !== undefined) {
    const v = strField(body.contactId, 64)
    if (v !== undefined) data.contactId = v
  }
  // Slice-2 PII column wrap: encrypt PII columns before persisting.
  if (body.accountHolderName !== undefined) {
    const v = strField(body.accountHolderName, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`accountHolderName` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.accountHolderName = encryptForTenantBound(orgId, TABLE, "accountHolderName", v)
  }
  if (body.serviceAddressLine1 !== undefined) {
    const v = strField(body.serviceAddressLine1, MAX_ADDR_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`serviceAddressLine1` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.serviceAddressLine1 = encryptForTenantBound(orgId, TABLE, "serviceAddressLine1", v)
  }
  if (body.serviceAddressLine2 !== undefined) {
    const v = strField(body.serviceAddressLine2, MAX_ADDR_LEN)
    if (v !== undefined) {
      data.serviceAddressLine2 = encryptForTenantBoundOrNull(orgId, TABLE, "serviceAddressLine2", v)
    }
  }
  if (body.serviceCity !== undefined) {
    const v = strField(body.serviceCity, 100)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`serviceCity` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.serviceCity = encryptForTenantBound(orgId, TABLE, "serviceCity", v)
  }
  if (body.servicePostalCode !== undefined) {
    const v = strField(body.servicePostalCode, 32)
    if (v !== undefined) {
      data.servicePostalCode = encryptForTenantBoundOrNull(orgId, TABLE, "servicePostalCode", v)
    }
  }
  if (body.serviceCountry !== undefined) {
    const v = strField(body.serviceCountry, 64)
    if (v !== undefined) {
      data.serviceCountry = encryptForTenantBoundOrNull(orgId, TABLE, "serviceCountry", v)
    }
  }
  if (body.customerClass !== undefined) {
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
    data.customerClass = body.customerClass
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionCustomer(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }
    data.status = body.status
    const now = new Date()
    const target = body.status as CustomerStatus
    const targetRank = STATUS_RANK[target]

    // active_coherence_check: status IN (active, suspended, terminated)
    // → activatedAt NOT NULL. Backfill on any forward transition.
    if (targetRank >= STATUS_RANK.active && !existing.activatedAt) {
      data.activatedAt = now
    }
    if (body.status === "suspended" && !existing.suspendedAt) {
      data.suspendedAt = now
    }
    if (body.status === "terminated" && !existing.terminatedAt) {
      data.terminatedAt = now
    }
  }

  if (body.metadata !== undefined) {
    if (
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const customer = await prisma.utilityCustomer.update({
      where: { id },
      data,
      select: {
        id: true,
        accountNumber: true,
        contactId: true,
        accountHolderName: true,
        serviceAddressLine1: true,
        serviceAddressLine2: true,
        serviceCity: true,
        servicePostalCode: true,
        serviceCountry: true,
        customerClass: true,
        status: true,
        activatedAt: true,
        suspendedAt: true,
        terminatedAt: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "activatedAt",
      "suspendedAt",
      "terminatedAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: customer.id,
      action: "write",
      metadata: {
        bodyFields,
        autoStampedFields:
          autoStampedFields.length > 0 ? autoStampedFields : undefined,
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      customer: {
        ...customer,
        accountHolderName: softDecryptForTenantBound(
          orgId,
          TABLE,
          "accountHolderName",
          customer.accountHolderName,
        ),
        serviceAddressLine1: softDecryptForTenantBound(
          orgId,
          TABLE,
          "serviceAddressLine1",
          customer.serviceAddressLine1,
        ),
        serviceAddressLine2: softDecryptForTenantBound(
          orgId,
          TABLE,
          "serviceAddressLine2",
          customer.serviceAddressLine2,
        ),
        serviceCity: softDecryptForTenantBound(orgId, TABLE, "serviceCity", customer.serviceCity),
        servicePostalCode: softDecryptForTenantBound(
          orgId,
          TABLE,
          "servicePostalCode",
          customer.servicePostalCode,
        ),
        serviceCountry: softDecryptForTenantBound(orgId, TABLE, "serviceCountry", customer.serviceCountry),
      },
    })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A customer with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[utility-customers/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 },
    )
  }
})
