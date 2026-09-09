/**
 * CLM Slice 7d — E-sign provider config CRUD.
 *
 * GET    /api/v1/integrations/esign-provider        — list org's configs (creds MASKED)
 * POST   /api/v1/integrations/esign-provider        — create/update a provider config
 * DELETE /api/v1/integrations/esign-provider?id=…   — delete a config
 *
 * Security:
 *   • requireAuth(contracts, write) + ADMIN role gate (mirrors 7a/7c pattern).
 *   • Creds are ENCRYPTED at rest via encryptForTenant() (AES-256-GCM per-org DEK).
 *   • GET response NEVER returns the config column — only id, provider, isActive.
 *   • Org-scoped: all operations validate organizationId from the session.
 *   • Only providers listed in ALLOWED_PROVIDERS can be stored (defence against
 *     arbitrary blob injection).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { encryptForTenant } from "@/lib/crypto/tenant-pii-encryption"

// ─── Allowed providers (whitelist) ────────────────────────────────────────────

const ALLOWED_PROVIDERS = ["docusign"] as const
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number]

function isAllowedProvider(p: unknown): p is AllowedProvider {
  return ALLOWED_PROVIDERS.includes(p as AllowedProvider)
}

// ─── Admin role gate ──────────────────────────────────────────────────────────

function requireAdminRole(role: string): NextResponse | null {
  if (role === "admin" || role === "superadmin") return null
  return NextResponse.json(
    {
      error: "Forbidden",
      message: "E-sign provider configuration requires admin role",
    },
    { status: 403 }
  )
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * DocuSign creds schema — validated before encrypt.
 * clientId + clientSecret + accountId are required.
 * basePath is optional (defaults to the DocuSign demo/prod base URL).
 */
const docusignCredsSchema = z.object({
  clientId: z.string().min(1, "clientId required"),
  clientSecret: z.string().min(1, "clientSecret required"),
  accountId: z.string().min(1, "accountId required"),
  basePath: z.string().url("basePath must be a URL").optional(),
})

const createConfigSchema = z.object({
  provider: z.string().min(1),
  creds: z.record(z.string(), z.string()),
  isActive: z.boolean().optional().default(true),
})

// ─── GET — list configs (creds masked) ───────────────────────────────────────

export const GET = withRlsAuth("contracts", "read", async (_req, session) => {
  const { orgId, role } = session
  const adminCheck = requireAdminRole(role)
  if (adminCheck) return adminCheck

  const configs = await prisma.esignProviderConfig.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    // Select ONLY safe fields — config (encrypted creds) is intentionally excluded
    select: {
      id: true,
      provider: true,
      isActive: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({
    success: true,
    data: configs,
    // Explicit note for API consumers
    note: "Credentials are not returned for security. Re-POST to rotate.",
  })
})

// ─── POST — create or replace a provider config ──────────────────────────────

export const POST = withRlsAuth("contracts", "write", async (req, session) => {
  const { orgId, role, userId } = session
  const adminCheck = requireAdminRole(role)
  if (adminCheck) return adminCheck

  const body = await req.json()
  const parsed = createConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { provider, creds, isActive } = parsed.data

  // Whitelist check
  if (!isAllowedProvider(provider)) {
    return NextResponse.json(
      { error: `Unknown provider "${provider}". Allowed: ${ALLOWED_PROVIDERS.join(", ")}` },
      { status: 400 }
    )
  }

  // Validate creds shape per provider
  if (provider === "docusign") {
    const credsCheck = docusignCredsSchema.safeParse(creds)
    if (!credsCheck.success) {
      return NextResponse.json(
        { error: `DocuSign creds validation: ${credsCheck.error.issues[0].message}` },
        { status: 400 }
      )
    }
  }

  // Encrypt creds at rest — NEVER stored plaintext
  let encryptedConfig: string
  try {
    encryptedConfig = encryptForTenant(orgId, JSON.stringify(creds))
  } catch (e) {
    console.error("[esign-provider POST] encrypt failed:", e)
    return NextResponse.json(
      { error: "Failed to encrypt credentials — TENANT_PII_MASTER_KEY may not be set" },
      { status: 500 }
    )
  }

  // Upsert: one config per (org, provider)
  const now = new Date()
  const config = await prisma.esignProviderConfig.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    create: {
      organizationId: orgId,
      provider,
      config: encryptedConfig,
      isActive,
      createdBy: userId ?? null,
      updatedAt: now,
    },
    update: {
      config: encryptedConfig,
      isActive,
      updatedAt: now,
    },
    select: {
      id: true,
      provider: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      // config intentionally excluded from response
    },
  })

  return NextResponse.json(
    {
      success: true,
      data: config,
      note: "Credentials stored encrypted. They are not returned in GET responses.",
    },
    { status: 201 }
  )
})

// ─── DELETE — remove a config ─────────────────────────────────────────────────

export const DELETE = withRlsAuth("contracts", "write", async (req, session) => {
  const { orgId, role } = session
  const adminCheck = requireAdminRole(role)
  if (adminCheck) return adminCheck

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id query parameter required" }, { status: 400 })
  }

  // Verify it belongs to this org (cross-tenant guard)
  const existing = await prisma.esignProviderConfig.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 })
  }

  await prisma.esignProviderConfig.delete({ where: { id } })

  return NextResponse.json({ success: true })
})
