import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/constants"
import crypto from "crypto"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { API_SCOPES } from "@/lib/permissions"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const MAX_API_KEY_BODY_SIZE = 16 * 1024
const API_SCOPE_ALLOWLIST = new Set<string>(API_SCOPES)

const apiKeyScopeSchema = z.string().refine(
  (scope) => API_SCOPE_ALLOWLIST.has(scope),
  { message: "Invalid API key scope" },
)

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(apiKeyScopeSchema).min(1).max(API_SCOPES.length)
    .refine((scopes) => new Set(scopes).size === scopes.length, { message: "Duplicate API key scope" }),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
}).strict()

async function requireApiKeyAdministrator(auth: { orgId: string; role: string }) {
  if (!isAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // This surface historically used the `core` module gate. Keep that tenant
  // entitlement after switching from requireAuth to the session-only wrapper.
  if (auth.role !== "superadmin" && !(await orgHasModule(auth.orgId, "crm"))) {
    return moduleDisabledResponse("crm")
  }
  return null
}

// GET /api/v1/api-keys — list all keys for org
export const GET = withRlsSessionAuth(async (_req, auth) => {
  const denial = await requireApiKeyAdministrator(auth)
  if (denial) return denial

  const keys = await prisma.apiKey.findMany({
    where: { organizationId: auth.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      isActive: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      createdBy: true,
    },
  })

  return NextResponse.json({ success: true, data: keys })
})

// POST /api/v1/api-keys — generate new key
export const POST = withRlsSessionAuth(async (req, auth) => {
  const denial = await requireApiKeyAdministrator(auth)
  if (denial) return denial

  const requestBody = await readJsonRequestWithinLimit(req, MAX_API_KEY_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid request" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = createApiKeySchema.safeParse(requestBody.value)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const { name, scopes, expiresInDays } = parsed.data

  // Generate random key: ld_<32 hex chars>
  const rawKey = `ld_${crypto.randomBytes(32).toString("hex")}`
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
  const keyPrefix = rawKey.slice(0, 10)

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null

  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: auth.orgId,
      name,
      keyHash,
      keyPrefix,
      scopes,
      expiresAt,
      createdBy: auth.userId,
    },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  // Return the raw key ONLY on creation — it won't be shown again
  return NextResponse.json({
    success: true,
    data: {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey,
      keyPrefix,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    },
  })
})
