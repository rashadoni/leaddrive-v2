import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { demoSalesOrganizationId } from "./sales-org"

/**
 * A partner's own site whose demo form posts to Demo Center, and the partner
 * who has to hear about each request at once.
 *
 * biznesdoktoru.az is the owner's agency site run with a marketing partner
 * (owner, 2026-11-18). Owner, 2026-11-25: every request from that form goes to
 * the partner immediately, not only after the prospect confirms the address.
 *
 * The address is not in the code: the repository is public, and the owner
 * types it in Demo Center (`/admin/demo-requests`). It lives in the sales
 * organisation's settings (`settings.demoCenter.sitePartnerEmails[site]`),
 * the one organisation Demo Center belongs to (src/lib/demo-center/sales-org.ts).
 * Which site a request came from is the browser's `Origin`: the same exact
 * origins the form's CORS allows (src/lib/demo-request-cors.ts).
 */
export const DEMO_PARTNER_SITES = {
  "biznesdoktoru.az": ["https://biznesdoktoru.az", "https://www.biznesdoktoru.az"],
} as const

export type DemoPartnerSite = keyof typeof DEMO_PARTNER_SITES

export function isDemoPartnerSite(value: unknown): value is DemoPartnerSite {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEMO_PARTNER_SITES, value)
}

export function demoPartnerSiteForOrigin(origin: string | null | undefined): DemoPartnerSite | null {
  if (!origin) return null
  for (const [site, origins] of Object.entries(DEMO_PARTNER_SITES) as Array<[DemoPartnerSite, readonly string[]]>) {
    if (origins.includes(origin)) return site
  }
  return null
}

const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/u

/** A single plain address, lower-cased; anything else is null. */
export function normalizePartnerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return null
  return email
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function readSitePartnerEmail(settings: unknown, site: DemoPartnerSite): string | null {
  const emails = record(record(record(settings).demoCenter).sitePartnerEmails)
  return normalizePartnerEmail(emails[site])
}

export type SitePartnerSetting =
  | { available: false }
  | { available: true; email: string | null }

/** What is set for `site`; unavailable when no sales organisation is configured. */
export async function getSitePartnerSetting(site: DemoPartnerSite): Promise<SitePartnerSetting> {
  const organizationId = demoSalesOrganizationId()
  if (!organizationId) return { available: false }
  const organization = await runWithRlsBypass(() =>
    prisma.organization.findFirst({ where: { id: organizationId, isActive: true }, select: { settings: true } }),
  )
  if (!organization) return { available: false }
  return { available: true, email: readSitePartnerEmail(organization.settings, site) }
}

/**
 * Sets (or with `null` clears) the partner's address for `site`. Only that one
 * key changes: other settings of the organisation, written by other screens at
 * the same moment, stay as they are.
 */
export async function setSitePartnerEmail(
  site: DemoPartnerSite,
  email: string | null,
): Promise<"saved" | "cleared" | "unavailable"> {
  const organizationId = demoSalesOrganizationId()
  if (!organizationId) return "unavailable"
  const partners = Prisma.sql`COALESCE(settings->'demoCenter'->'sitePartnerEmails', '{}'::jsonb)`
  const next = email === null
    ? Prisma.sql`${partners} - ${site}::text`
    : Prisma.sql`${partners} || jsonb_build_object(${site}::text, ${email}::text)`
  const updated = await runWithRlsBypass(() =>
    prisma.$executeRaw`
      UPDATE organizations
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{demoCenter}',
        COALESCE(settings->'demoCenter', '{}'::jsonb) || jsonb_build_object('sitePartnerEmails', ${next}),
        true
      )
      WHERE id = ${organizationId} AND "isActive" = true
    `,
  )
  if (!updated) return "unavailable"
  return email === null ? "cleared" : "saved"
}
