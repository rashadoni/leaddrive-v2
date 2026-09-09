/**
 * resolveOrgPptxBranding — read a tenant's branding (companyName + accent color)
 * for the PPTX export. v1 brands with the company name + accent only; the logo is
 * a deliberate fast-follow (fetching Organization.logo means either a network
 * fetch — SSRF surface — or resolving the standalone uploads path, neither of
 * which is worth blocking the first cut). The engine renders cleanly without it.
 */
import { prisma } from "@/lib/prisma"
import type { ReportPptxBranding } from "./report-pptx"

export async function resolveOrgPptxBranding(orgId: string): Promise<ReportPptxBranding> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, branding: true },
  })
  const b =
    org?.branding && typeof org.branding === "object" && !Array.isArray(org.branding)
      ? (org.branding as Record<string, unknown>)
      : {}
  const companyName = (typeof b.companyName === "string" && b.companyName.trim()) || org?.name || "LeadDrive"
  const primaryColor = typeof b.primaryColor === "string" ? b.primaryColor : null
  return { companyName, primaryColor, logoData: null }
}
