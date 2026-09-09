import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const capabilitySchema = z.object({
  providerKey: z.string().trim().min(1).max(120),
  adapterKey: z.string().trim().min(1).max(120),
  platform: z.enum(["facebook", "instagram", "tiktok", "youtube", "twitter", "telegram", "vkontakte"]),
  capability: z.enum(["DISCOVER_POSTS", "READ_OWNED_COMMENTS", "READ_EXTERNAL_COMMENTS", "READ_THREAD", "REPLY_OWNED", "REPLY_EXTERNAL", "READ_MEDIA"]),
  contentScopes: z.array(z.enum(["OWNED", "TAGGED", "BRANDED", "MENTIONED", "PUBLIC", "AD"])).min(1),
  policyVersion: z.string().trim().min(1).max(120).default("social-monitoring-v2-pr2"),
  schemaVersion: z.string().trim().min(1).max(120),
  endpointHost: z.string().trim().max(255).nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  attributionRequired: z.boolean().optional(),
}).strict()

function normalizedEndpointHost(value: string | null | undefined): string | null {
  if (!value) return null
  const raw = value.includes("://") ? value : `https://${value}`
  const url = new URL(raw)
  if (url.protocol !== "https:") throw new Error("endpoint_host_https_required")
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) throw new Error("endpoint_host_not_allowed")
  return host
}

export const GET = withRlsAuth("social", "read", async (_request: NextRequest, auth) => {
  const proofs = await prisma.socialProviderCapabilityProof.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  })
  return NextResponse.json({ success: true, data: proofs })
})

export const POST = withRlsAuth("social", "write", async (request: NextRequest, auth) => {
  if (!new Set(["admin", "superadmin"]).has(auth.role)) return NextResponse.json({ error: "admin_required" }, { status: 403 })
  const parsed = capabilitySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  let endpointHost: string | null
  try { endpointHost = normalizedEndpointHost(parsed.data.endpointHost) } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "endpoint_host_invalid" }, { status: 400 })
  }
  const scopes = Array.from(new Set(parsed.data.contentScopes)).sort()
  const proofKey = [parsed.data.providerKey, parsed.data.adapterKey, parsed.data.platform, parsed.data.capability, scopes.join("+"), parsed.data.policyVersion, parsed.data.schemaVersion].join(":").toLowerCase()
  try {
    const proof = await prisma.socialProviderCapabilityProof.create({
      data: {
        organizationId: auth.orgId,
        proofKey,
        providerKey: parsed.data.providerKey,
        adapterKey: parsed.data.adapterKey,
        platform: parsed.data.platform,
        capability: parsed.data.capability,
        contentScopeKey: scopes.join("+"),
        contentScopes: scopes,
        policyVersion: parsed.data.policyVersion,
        schemaVersion: parsed.data.schemaVersion,
        endpointHost,
        retentionDays: parsed.data.retentionDays ?? null,
        attributionRequired: parsed.data.attributionRequired ?? false,
        status: "DRAFT",
        evidence: {},
      },
    })
    logAudit(auth.orgId, "create", "social_provider_capability_proof", proof.id, proofKey)
    return NextResponse.json({ success: true, data: proof }, { status: 201 })
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "capability_proof_exists" }, { status: 409 })
    throw error
  }
})
