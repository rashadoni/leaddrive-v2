/**
 * Zapier-specific API key authentication.
 *
 * Mirrors getApiKeyAuth() in api-auth.ts but is exported so /api/v1/zapier/*
 * routes can verify the bearer token and surface scopes back to Zapier's
 * Platform UI (which uses /me to validate credentials).
 *
 * Part of L6 Native Zapier Connector (Phase 1 Week 3-4 roadmap).
 */
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import crypto from "crypto"

export interface ZapierAuthResult {
  orgId: string
  organizationName: string
  organizationSlug: string
  apiKeyId: string
  apiKeyName: string
  scopes: string[]
}

/**
 * Resolve a Zapier request to org context via Authorization: Bearer ld_xxx.
 * Returns null when header is missing/malformed or key is inactive/expired/unknown.
 * Updates `lastUsedAt` on success (fire-and-forget).
 */
export async function getZapierAuth(req: NextRequest): Promise<ZapierAuthResult | null> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ld_")) return null

  const rawKey = authHeader.slice("Bearer ".length)
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")

  try {
    const apiKey = await runWithRlsBypass(() => prisma.apiKey.findFirst({
      where: { keyHash, isActive: true },
      include: { organization: { select: { name: true, slug: true, isActive: true } } },
    }))
    if (!apiKey) return null
    if (apiKey.organization.isActive !== true) return null
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null

    // Update lastUsedAt — fire-and-forget, don't block on it
    runWithRlsBypass(() => prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })).catch(() => { /* ignore */ })

    return {
      orgId: apiKey.organizationId,
      organizationName: apiKey.organization.name,
      organizationSlug: apiKey.organization.slug,
      apiKeyId: apiKey.id,
      apiKeyName: apiKey.name,
      scopes: apiKey.scopes,
    }
  } catch {
    return null
  }
}

/**
 * Scope check helper — Zapier triggers/actions declare required scope; routes
 * verify the API key carries it. Returns true if any of the required scopes
 * is present (OR semantics — e.g. ["read:deals", "write:deals"] passes if
 * either is granted).
 */
export function hasAnyScope(auth: ZapierAuthResult, required: string[]): boolean {
  return required.some(s => auth.scopes.includes(s))
}

/**
 * Mapping from event entity prefix → scope plural form. Naive `${entity}s`
 * mapping fails on entities like `company → companys` (should be `companies`).
 * Keep this table aligned with the `read:*`/`write:*` scopes declared in
 * `src/lib/permissions.ts` and the API key scopes UI.
 */
const ENTITY_PLURAL_MAP: Record<string, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  lead: "leads",
  ticket: "tickets",
  task: "tasks",
  campaign: "campaigns",
}

/**
 * Resolve required scopes for a webhook event key. Returns the read+write
 * pair so callers can accept either (OR semantics via `hasAnyScope`).
 *
 * Centralised here so subscribe POST and samples GET share a single source
 * of truth — earlier two-copy version drifted (company → "companys" bug).
 */
export function requiredScopesForEvent(event: string): string[] {
  const entity = event.split(".")[0]
  const plural = ENTITY_PLURAL_MAP[entity] ?? `${entity}s`
  return [`read:${plural}`, `write:${plural}`]
}
