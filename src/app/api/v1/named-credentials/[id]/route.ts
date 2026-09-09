/**
 * PATCH /api/v1/named-credentials/[id] — update metadata / rotate secret.
 * DELETE /api/v1/named-credentials/[id]
 *
 * Permanently remove a credential. Slice 1 hard-delete; slice 2 will
 * soft-delete with a "deleted_at" column + a usage-log check that
 * refuses to delete credentials referenced by active flow steps.
 *
 * Part of N17 Named Credentials (Phase 5 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { encryptSecret } from "@/lib/credentials/vault"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"

const authConfigSchema = z.record(z.string(), z.unknown()).optional()

const patchSchema = z.object({
  description: z.string().max(2000).nullable().optional(),
  baseUrl: z.string().url().optional(),
  authType: z.enum(["bearer", "basic", "api_key_header", "none"]).optional(),
  authConfig: authConfigSchema,
  secret: z.string().min(1).max(8000).optional(),
  isActive: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.authType === "none" && data.secret) {
    ctx.addIssue({
      code: "custom",
      message: "authType=none must not include `secret`",
      path: ["secret"],
    })
  }
  if (data.baseUrl !== undefined && !data.baseUrl.startsWith("https://")) {
    ctx.addIssue({
      code: "custom",
      message: "baseUrl must use https:// (slice 1 hardening)",
      path: ["baseUrl"],
    })
  }
  if (data.authType === "basic" && data.secret && !data.secret.includes(":")) {
    ctx.addIssue({
      code: "custom",
      message: 'basic auth secret must be in "user:pass" form',
      path: ["secret"],
    })
  }
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

const credentialSelect = {
  id: true,
  name: true,
  description: true,
  baseUrl: true,
  authType: true,
  authConfig: true,
  testStatus: true,
  testStatusMessage: true,
  testedAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NamedCredentialSelect

export const PATCH = withRlsAuth("settings", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Body must include at least one credential field" }, { status: 400 })
  }

  const existing = await prisma.namedCredential.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      baseUrl: true,
      authType: true,
      authConfig: true,
      secretCiphertext: true,
      secretIv: true,
      secretTag: true,
      secretAlg: true,
    },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let normalizedBaseUrl: string | undefined
  if (parsed.data.baseUrl !== undefined) {
    try {
      const target = await validateOutboundWebhookUrl(parsed.data.baseUrl, {
        allowHttp: false,
      })
      normalizedBaseUrl = target.url.toString()
    } catch {
      return NextResponse.json(
        { error: "baseUrl must be a resolvable public HTTPS URL" },
        { status: 400 },
      )
    }
  }

  const nextAuthType = parsed.data.authType ?? existing.authType
  const nextAuthConfig = parsed.data.authConfig ?? (existing.authConfig as Record<string, unknown> | null) ?? {}
  if (nextAuthType === "none" && parsed.data.secret !== undefined) {
    return NextResponse.json(
      { error: "authType=none must not include `secret`" },
      { status: 400 },
    )
  }
  if (nextAuthType === "basic" && parsed.data.secret && !parsed.data.secret.includes(":")) {
    return NextResponse.json(
      { error: 'basic auth secret must be in "user:pass" form' },
      { status: 400 },
    )
  }
  if (nextAuthType === "api_key_header") {
    const headerName = nextAuthConfig.headerName
    if (typeof headerName !== "string" || headerName.length === 0) {
      return NextResponse.json(
        { error: "api_key_header requires authConfig.headerName" },
        { status: 400 },
      )
    }
  }

  const data: Prisma.NamedCredentialUpdateInput = {}
  if (parsed.data.description !== undefined) data.description = parsed.data.description
  if (normalizedBaseUrl !== undefined) data.baseUrl = normalizedBaseUrl
  if (parsed.data.authType !== undefined) data.authType = parsed.data.authType
  if (parsed.data.authConfig !== undefined) data.authConfig = parsed.data.authConfig as Prisma.InputJsonValue
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive

  const authChanged =
    parsed.data.baseUrl !== undefined ||
    parsed.data.authType !== undefined ||
    parsed.data.authConfig !== undefined ||
    parsed.data.secret !== undefined

  if (nextAuthType === "none") {
    data.secretCiphertext = null
    data.secretIv = null
    data.secretTag = null
    data.secretAlg = null
  } else if (parsed.data.secret !== undefined) {
    const encrypted = encryptSecret({
      organizationId: auth.orgId,
      name: existing.name,
      plaintext: parsed.data.secret,
    })
    data.secretCiphertext = encrypted.ciphertext
    data.secretIv = encrypted.iv
    data.secretTag = encrypted.tag
    data.secretAlg = encrypted.alg
  } else if (
    !existing.secretCiphertext ||
    !existing.secretIv ||
    !existing.secretTag ||
    !existing.secretAlg
  ) {
    return NextResponse.json(
      { error: `authType=${nextAuthType} requires \`secret\`` },
      { status: 400 },
    )
  }

  if (authChanged) {
    data.testStatus = "untested"
    data.testStatusMessage = null
    data.testedAt = null
  }

  const credential = await prisma.namedCredential.update({
    where: { id: existing.id },
    data,
    select: credentialSelect,
  })

  return NextResponse.json({ credential })
})

export const DELETE = withRlsAuth("settings", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  // updateMany + deleteMany with org guard so a cross-tenant id-guess
  // returns 404, not a successful delete.
  const result = await prisma.namedCredential.deleteMany({
    where: { id, organizationId: auth.orgId },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
})
