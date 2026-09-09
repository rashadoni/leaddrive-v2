import { headers } from "next/headers"
import { tenantPrisma } from "./prisma"

/**
 * Get the current organization ID from the request context.
 * In server components/API routes, reads from header injected by middleware.
 */
export async function getCurrentOrgId(): Promise<string> {
  const headersList = await headers()
  const orgId = headersList.get("x-organization-id")
  if (!orgId) {
    throw new Error("Organization context not found. Are you authenticated?")
  }
  return orgId
}

/**
 * Get a tenant-scoped Prisma client for the current request.
 * Use this in API routes and server components.
 */
export async function getTenantDb() {
  const orgId = await getCurrentOrgId()
  return tenantPrisma(orgId)
}
