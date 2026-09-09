/**
 * D5 Payments — PaymentProvider per-id (GET / PATCH / DELETE).
 *
 * GET    /api/v1/payment-providers/[id] — fetch one provider. Credential
 *   values are REDACTED ("***") — only field names are returned so the
 *   admin UI can show which fields are configured without leaking secrets.
 *   `webhookSecret` is returned as "***" if set, null otherwise.
 * PATCH  /api/v1/payment-providers/[id] — partial update. `type` is
 *   immutable post-create (changing it would orphan existing PaymentIntents
 *   that reference this provider and bypass the unique-per-type constraint).
 * DELETE /api/v1/payment-providers/[id] — hard delete, blocked by FK Restrict
 *   if the provider has associated PaymentIntents. Use isActive=false instead.
 *
 * Vault guard: live credentials are rejected until Phase 5 N17 vault is wired.
 * See `src/lib/payments/vault-guard.ts` for pattern definitions and coverage notes.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rejectLiveCredentials } from "@/lib/payments/vault-guard"
import { withRlsAuth } from "@/lib/with-rls"

/* ─── GET — fetch one provider ──────────────────────────────────────── */

export const GET = withRlsAuth("payments", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await context.params

  try {
    const provider = await prisma.paymentProvider.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        type: true,
        name: true,
        isActive: true,
        isTestMode: true,
        // Return credentials with keys present but values REDACTED so
        // the admin UI can show which fields are set without leaking values.
        credentials: true,
        webhookSecret: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 })
    }

    // Redact credential values — return only the field names (non-null check).
    const redactedCredentials: Record<string, "***"> = {}
    if (provider.credentials && typeof provider.credentials === "object") {
      for (const key of Object.keys(provider.credentials as Record<string, unknown>)) {
        redactedCredentials[key] = "***"
      }
    }

    return NextResponse.json({
      provider: {
        ...provider,
        credentials: redactedCredentials,
        webhookSecret: provider.webhookSecret ? "***" : null,
      },
    })
  } catch (err) {
    console.error("[payment-providers/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load payment provider" },
      { status: 500 },
    )
  }
})

/* ─── PATCH — partial update ────────────────────────────────────────── */

interface PatchBody {
  type?: unknown        // captured to return explicit 400 — immutable post-create
  name?: unknown
  credentials?: unknown
  isTestMode?: unknown
  webhookSecret?: unknown
  isActive?: unknown
}

export const PATCH = withRlsAuth("payments", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await context.params

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // `type` is immutable post-create: changing it would orphan PaymentIntents
  // that reference this provider and bypass the unique-per-(type, isTestMode)
  // constraint. Return 400 explicitly rather than silently ignoring it.
  if (body.type !== undefined) {
    return NextResponse.json(
      { error: "`type` is immutable post-create — create a new provider instead" },
      { status: 400 },
    )
  }

  // Load existing to merge mode + credentials for vault guard
  const existing = await prisma.paymentProvider.findFirst({
    where: { id, organizationId: orgId },
    select: { isTestMode: true, credentials: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  }

  const data: {
    name?: string
    credentials?: Record<string, unknown>
    isTestMode?: boolean
    webhookSecret?: string | null
    isActive?: boolean
  } = {}

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "`name` must be a non-empty string" }, { status: 400 })
    }
    data.name = body.name.trim().slice(0, 100)
  }

  if (body.credentials !== undefined) {
    if (
      body.credentials === null ||
      typeof body.credentials !== "object" ||
      Array.isArray(body.credentials)
    ) {
      return NextResponse.json({ error: "`credentials` must be a JSON object" }, { status: 400 })
    }
    data.credentials = body.credentials as Record<string, unknown>
  }

  if (body.isTestMode !== undefined) {
    data.isTestMode = Boolean(body.isTestMode)
  }

  if (body.webhookSecret !== undefined) {
    data.webhookSecret =
      typeof body.webhookSecret === "string" && body.webhookSecret.trim()
        ? body.webhookSecret.trim()
        : null
  }

  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 })
  }

  // Resolve effective mode + credentials AFTER applying patch values
  const effectiveTestMode = data.isTestMode ?? existing.isTestMode
  const effectiveCredentials = data.credentials ?? existing.credentials

  // --- VAULT GUARD (P0 — must remain until Phase 5 N17 vault is wired)
  const guardErr = rejectLiveCredentials(effectiveTestMode, effectiveCredentials)
  if (guardErr) return guardErr

  try {
    const provider = await prisma.paymentProvider.update({
      where: { id },
      data,
      select: {
        id: true,
        type: true,
        name: true,
        isActive: true,
        isTestMode: true,
        createdAt: true,
        updatedAt: true,
        // Exclude credentials + webhookSecret from update response
      },
    })
    return NextResponse.json({ provider })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A provider with this type/mode combination already exists for your tenant" },
        { status: 409 },
      )
    }
    console.error("[payment-providers/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update payment provider" },
      { status: 500 },
    )
  }
})

/* ─── DELETE — remove provider ──────────────────────────────────────── */

export const DELETE = withRlsAuth("payments", "delete", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await context.params

  try {
    const existing = await prisma.paymentProvider.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 })
    }

    await prisma.paymentProvider.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // P2003 = FK violation (payment_intents.providerId has Restrict on delete)
    if (msg.includes("P2003") || msg.includes("foreign key")) {
      return NextResponse.json(
        {
          error:
            "Cannot delete provider: it has associated PaymentIntents. " +
            "Set isActive=false to disable it instead.",
        },
        { status: 409 },
      )
    }
    console.error("[payment-providers/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to delete payment provider" },
      { status: 500 },
    )
  }
})
