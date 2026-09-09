import { Prisma } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { isSuperAdminSession } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import Link from "next/link"
import { TenantFilters } from "./tenant-filters"
import { getTranslations } from "next-intl/server"

type TenantRow = Prisma.OrganizationGetPayload<{
  include: {
    _count: { select: { users: true; contacts: true; deals: true; companies: true; apiKeys: true } }
  }
}>

export default async function TenantsListPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; status?: string }>
}) {
  // Page-level superadmin gate: the admin layout gate does not re-run on
  // soft/partial RSC navigations, and the gate MUST precede the cross-tenant
  // bypass scope below.
  if (!(await isSuperAdminSession())) redirect("/dashboard")

  const params = await searchParams
  const planFilter = params.plan
  const statusFilter = params.status

  const where: any = {}
  if (planFilter && planFilter !== "all") {
    where.plan = planFilter
  }
  if (statusFilter === "active") {
    where.isActive = true
  } else if (statusFilter === "inactive") {
    where.isActive = false
  } else if (statusFilter === "pending_deletion") {
    where.deletionScheduledAt = { not: null }
  }

  // RLS: tenant directory spans ALL orgs (and the _count include hits tenant
  // tables: users/contacts/deals/companies) → bypass scope (.run() form).
  const tenants = await runWithRlsBypass(() =>
    prisma.organization.findMany({
      where,
      include: {
        _count: {
          // apiKeys — чтобы из списка было видно, у каких тенантов вообще есть
          // внешние интеграции (и стоит ли открывать карточку тенанта).
          select: { users: true, contacts: true, deals: true, companies: true, apiKeys: true },
        },
      },
      orderBy: { createdAt: "desc" },
    })
  )

  const totalCount = await runWithRlsBypass(() => prisma.organization.count())
  const t = await getTranslations("admin")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("tenants.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {tenants.length === totalCount
              ? t("tenants.totalCount", { count: totalCount })
              : t("tenants.filteredCount", { filtered: tenants.length, total: totalCount })}
          </p>
        </div>
        <Link href="/admin/tenants/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            {t("tenants.newClient")}
          </Button>
        </Link>
      </div>

      <TenantFilters currentPlan={planFilter} currentStatus={statusFilter} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("name")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("slug")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("plan")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("users")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("contacts")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("companies")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("deals")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("apiKeys.short")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("status")}</th>
                <th className="py-3 px-4 font-medium text-muted-foreground">{t("created")}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant: TenantRow) => (
                <tr key={tenant.id} className="border-b hover:bg-accent/50 transition-colors">
                  <td className="py-3 px-4 font-medium">
                    <Link href={`/admin/tenants/${tenant.id}`} className="hover:text-primary hover:underline">
                      {tenant.name}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{tenant.slug}</td>
                  <td className="py-3 px-4">
                    <Badge variant="outline" className="text-xs capitalize">{tenant.plan}</Badge>
                  </td>
                  <td className="py-3 px-4">{tenant._count.users}</td>
                  <td className="py-3 px-4">{tenant._count.contacts}</td>
                  <td className="py-3 px-4">{tenant._count.companies}</td>
                  <td className="py-3 px-4">{tenant._count.deals}</td>
                  <td className="py-3 px-4">
                    {tenant._count.apiKeys > 0
                      ? tenant._count.apiKeys
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    {tenant.deletionScheduledAt ? (
                      <Badge variant="destructive" className="text-xs">{t("pendingDeletion")}</Badge>
                    ) : (
                      <Badge variant={tenant.isActive ? "default" : "destructive"} className="text-xs">
                        {tenant.isActive ? t("active") : t("inactive")}
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted-foreground">
                    {t("tenants.noTenants")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
