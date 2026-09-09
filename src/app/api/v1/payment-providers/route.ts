/**
 * D5 Payments — PaymentProvider CRUD (list + create).
 *
 * GET /api/v1/payment-providers — list tenant's configured providers.
 * POST /api/v1/payment-providers — register a new provider.
 *
 * ## VAULT GUARD (P0 until NamedCredentials vault is wired — Phase 5 N17)
 *
 * Live payment credentials MUST NOT be stored in plaintext in Postgres.
 * Guard logic lives in `src/lib/payments/vault-guard.ts`. Coverage:
 *   - Stripe: sk_live_* / pk_live_* / rk_live_* pattern scan
 *   - All providers: isTestMode:false rejected outright
 *   - PayPal / YooKassa / Robokassa: no reliable live-key pattern —
 *     isTestMode guard is the sole protection for these providers.
 *
 * Permissions: "payments" resource (requireAuth).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { PAYMENT_PROVIDER_TYPES, type PaymentProviderType } from "@/lib/payments/types"
import { rejectLiveCredentials } from "@/lib/payments/vault-guard"

/* ─── GET — list providers ──────────────────────────────────────────── */

export const GET = withRlsAuth("payments", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  try {
    const providers = await prisma.paymentProvider.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        name: true,
        isActive: true,
        isTestMode: true,
        createdAt: true,
        updatedAt: true,
        // Deliberately exclude `credentials` and `webhookSecret` from list
        // response — secrets must never appear in list endpoints.
      },
    })
    return NextResponse.json({ providers, total: providers.length })
  } catch (err) {
    console.error("[payment-providers] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load payment providers" },
      { status: 500 },
    )
  }
})

/* ─── POST — create provider ────────────────────────────────────────── */

interface CreateBody {
  type?: unknown
  name?: unknown
  credentials?: unknown
  isTestMode?: unknown
  webhookSecret?: unknown
  isActive?: unknown
}

export const POST = withRlsAuth("payments", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- type validation
  if (
    typeof body.type !== "string" ||
    !(PAYMENT_PROVIDER_TYPES as readonly string[]).includes(body.type)
  ) {
    return NextResponse.json(
      {
        error: `Invalid \`type\` — must be one of: ${PAYMENT_PROVIDER_TYPES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const type = body.type as PaymentProviderType

  // --- name
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json(
      { error: "`name` is required and must be a non-empty string" },
      { status: 400 },
    )
  }
  const name = body.name.trim().slice(0, 100)

  // --- mode flag
  const isTestMode = body.isTestMode !== false // default true

  // --- credentials
  const credentials =
    body.credentials !== null &&
    typeof body.credentials === "object" &&
    !Array.isArray(body.credentials)
      ? (body.credentials as Record<string, unknown>)
      : {}

  // --- VAULT GUARD (P0 — must remain until Phase 5 N17 vault is wired)
  const guardErr = rejectLiveCredentials(isTestMode, credentials)
  if (guardErr) return guardErr

  // --- webhookSecret
  const webhookSecret =
    typeof body.webhookSecret === "string" && body.webhookSecret.trim()
      ? body.webhookSecret.trim()
      : null

  const isActive = body.isActive !== false // default true

  try {
    const provider = await prisma.paymentProvider.create({
      data: {
        organizationId: orgId,
        type,
        name,
        credentials,
        isTestMode,
        webhookSecret,
        isActive,
        createdBy: auth.userId,
      },
      select: {
        id: true,
        type: true,
        name: true,
        isActive: true,
        isTestMode: true,
        createdAt: true,
        updatedAt: true,
        // Exclude credentials + webhookSecret from response
      },
    })
    return NextResponse.json({ provider }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        {
          error:
            `A ${type} provider already exists for this tenant in ${isTestMode ? "test" : "live"} mode. ` +
            "Each org may have at most one (type, isTestMode) pair.",
        },
        { status: 409 },
      )
    }
    console.error("[payment-providers] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create payment provider" },
      { status: 500 },
    )
  }
})
