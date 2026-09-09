import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { deepNormalizeDecimals } from "@/lib/prisma-decimal"

interface ExportResult {
  data: Record<string, any>
  filename: string
  orgName: string
  exportedAt: string
}

/**
 * Export all tenant data as a JSON object.
 * Excludes sensitive fields (passwordHash, tokens).
 */
export async function exportTenantData(orgId: string): Promise<ExportResult> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) throw new Error("Organization not found")

  // Parallel fetch all tenant data
  const [
    users,
    companies,
    contacts,
    deals,
    leads,
    tasks,
    tickets,
    contracts,
    offers,
    invoices,
    bills,
    billPayments,
    bankAccounts,
    campaigns,
    events,
    kbArticles,
    kbCategories,
    channels,
    messages,
    pipelineStages,
    currencies,
    slaPolicies,
    customFields,
    workflows,
    journeys,
    products,
    projects,
    auditLogs,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        phone: true, position: true, department: true, createdAt: true, lastLogin: true,
        // Exclude: passwordHash, totpSecret
      },
    }),
    prisma.company.findMany({ where: { organizationId: orgId } }),
    prisma.contact.findMany({ where: { organizationId: orgId } }),
    prisma.deal.findMany({ where: { organizationId: orgId } }),
    prisma.lead.findMany({ where: { organizationId: orgId } }),
    prisma.task.findMany({ where: { organizationId: orgId } }),
    prisma.ticket.findMany({ where: { organizationId: orgId } }),
    prisma.contract.findMany({ where: { organizationId: orgId } }),
    prisma.offer.findMany({
      where: { organizationId: orgId },
      include: { items: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId: orgId },
      include: { items: true, payments: true },
    }),
    prisma.bill.findMany({ where: { organizationId: orgId } }),
    prisma.billPayment.findMany({ where: { organizationId: orgId } }),
    prisma.bankAccount.findMany({ where: { organizationId: orgId } }),
    prisma.campaign.findMany({ where: { organizationId: orgId } }),
    prisma.event.findMany({ where: { organizationId: orgId } }),
    prisma.kbArticle.findMany({ where: { organizationId: orgId } }),
    prisma.kbCategory.findMany({ where: { organizationId: orgId } }),
    prisma.channelConfig.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, channelType: true, configName: true, phoneNumber: true,
        isActive: true, createdAt: true,
        // Exclude: apiKey, botToken, appSecret (sensitive)
      },
    }),
    prisma.channelMessage.findMany({ where: { organizationId: orgId } }),
    prisma.pipelineStage.findMany({ where: { organizationId: orgId } }),
    prisma.currency.findMany({ where: { organizationId: orgId } }),
    prisma.slaPolicy.findMany({ where: { organizationId: orgId } }),
    prisma.customField.findMany({ where: { organizationId: orgId } }),
    prisma.workflowRule.findMany({
      where: { organizationId: orgId },
      include: { actions: true },
    }),
    prisma.journey.findMany({ where: { organizationId: orgId } }),
    prisma.product.findMany({ where: { organizationId: orgId } }),
    prisma.project.findMany({
      where: { organizationId: orgId },
      include: { members: true, milestones: true },
    }),
    prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        // Internal clean-slate budget carry is intentionally excluded from the
        // tenant-facing export. Other tenant audit history remains available.
        NOT: {
          entityType: "social_paid_run_authorization",
          action: "reset_boundary",
        },
      },
      take: PAGE_SIZE.AUDIT_LOG,
      orderBy: { createdAt: "desc" },
    }),
  ])

  const exportedAt = new Date().toISOString()
  const slug = org.slug || org.id

  return {
    data: deepNormalizeDecimals({
      _meta: {
        exportedAt,
        organizationId: orgId,
        organizationName: org.name,
        slug: org.slug,
        plan: org.plan,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        features: org.features,
        branding: org.branding,
        settings: org.settings,
        maxUsers: org.maxUsers,
        maxContacts: org.maxContacts,
        createdAt: org.createdAt,
      },
      users,
      companies,
      contacts,
      deals,
      leads,
      tasks,
      tickets,
      contracts,
      offers,
      invoices,
      bills,
      billPayments,
      bankAccounts,
      campaigns,
      events,
      kbArticles,
      kbCategories,
      channels,
      messages,
      pipelineStages,
      currencies,
      slaPolicies,
      customFields,
      workflows,
      journeys,
      products,
      projects,
      auditLogs,
    }) as Record<string, unknown>,
    filename: `leaddrive-export-${slug}-${exportedAt.replace(/[:.]/g, "-")}.json`,
    orgName: org.name,
    exportedAt,
  }
}
