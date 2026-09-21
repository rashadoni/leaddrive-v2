import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"

/**
 * The only door from the demo into a tenant.
 *
 * A demo request is public; the CRM it feeds is somebody's real data. So demo
 * code never picks an organisation and never receives one from a request: it
 * asks this module to run a piece of work inside *the* sales organisation,
 * which is decided by server configuration alone. The owner chose LeadDrive
 * Inc. (2026-09-21).
 *
 * By default that is the voice agent's organisation, and not for convenience:
 * the demo's live call is placed by the voice agent, which serves exactly one
 * organisation, so a demo lead anywhere else could never be called.
 * `DEMO_LEAD_ORGANIZATION_ID` overrides it if that ever changes.
 *
 * src/__tests__/demo-center-boundary.test.ts holds this: `runWithTenant(`
 * appears once in all of src/lib/demo-center, here.
 */

type DemoSalesEnv = Partial<Record<"DEMO_LEAD_ORGANIZATION_ID" | "VOICE_AGENT_ORGANIZATION_ID", string>>

export function demoSalesOrganizationId(
  env: DemoSalesEnv = {
    DEMO_LEAD_ORGANIZATION_ID: process.env.DEMO_LEAD_ORGANIZATION_ID,
    VOICE_AGENT_ORGANIZATION_ID: process.env.VOICE_AGENT_ORGANIZATION_ID,
  },
): string | null {
  return env.DEMO_LEAD_ORGANIZATION_ID?.trim() || env.VOICE_AGENT_ORGANIZATION_ID?.trim() || null
}

/** The configured sales organisation, if it still exists and is active. */
export async function resolveDemoSalesOrganization(): Promise<string | null> {
  const configured = demoSalesOrganizationId()
  if (!configured) return null
  const organization = await runWithRlsBypass(() =>
    prisma.organization.findFirst({ where: { id: configured, isActive: true }, select: { id: true } }),
  )
  return organization?.id ?? null
}

/**
 * Run `work` inside the sales organisation. Returns null, having done
 * nothing, when no active organisation is configured.
 */
export async function inDemoSalesOrganization<T>(
  work: (organizationId: string) => Promise<T>,
): Promise<{ organizationId: string; value: T } | null> {
  const organizationId = await resolveDemoSalesOrganization()
  if (!organizationId) return null
  const value = await runWithTenant(organizationId, () => work(organizationId))
  return { organizationId, value }
}
