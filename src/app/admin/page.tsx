import { Prisma } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { isSuperAdminSession } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building2, Users, Contact, Briefcase, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { getTranslations } from "next-intl/server"

type RecentOrgRow = Prisma.OrganizationGetPayload<{
  include: { _count: { select: { users: true; contacts: true } } }
}>

export default async function AdminDashboard() {
  // Page-level superadmin gate: the admin layout gate does not re-run on
  // soft/partial RSC navigations, and the gate MUST precede the cross-tenant
  // bypass scope below.
  if (!(await isSuperAdminSession())) redirect("/dashboard")

  const t = await getTranslations("admin")

  // RLS: superadmin dashboard aggregates across ALL tenants → bypass scope
  // (server component, not the HTTP-guard path → .run() form).
  const [orgCount, activeOrgCount, userCount, contactCount, dealCount, recentOrgs] = await runWithRlsBypass(() =>
    Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { isActive: true } }),
      prisma.user.count(),
      prisma.contact.count(),
      prisma.deal.count(),
      prisma.organization.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { users: true, contacts: true } } },
      }),
    ])
  )

  const stats = [
    { label: t("totalTenants"), value: orgCount, sub: `${activeOrgCount} ${t("active").toLowerCase()}`, icon: Building2 },
    { label: t("totalUsers"), value: userCount, icon: Users },
    { label: t("totalContacts"), value: contactCount, icon: Contact },
    { label: t("totalDeals"), value: dealCount, icon: Briefcase },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
        </div>
        <Link href="/admin/tenants/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            {t("tenants.newClient")}
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value.toLocaleString()}</p>
                  {stat.sub && <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>}
                </div>
                <Icon className="w-5 h-5 text-primary" />
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{t("recentTenants")}</h2>
          <Link href="/admin/tenants" className="text-sm text-primary hover:underline">
            {t("view")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 px-3 font-medium text-muted-foreground">{t("name")}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t("slug")}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t("plan")}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t("users")}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t("contacts")}</th>
                <th className="py-2 px-3 font-medium text-muted-foreground">{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {recentOrgs.map((org: RecentOrgRow) => (
                <tr key={org.id} className="border-b hover:bg-accent/50 transition-colors">
                  <td className="py-2.5 px-3 font-medium">
                    <Link href={`/admin/tenants/${org.id}`} className="hover:text-primary">
                      {org.name}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{org.slug}</td>
                  <td className="py-2.5 px-3">
                    <Badge variant="outline" className="text-xs capitalize">{org.plan}</Badge>
                  </td>
                  <td className="py-2.5 px-3">{org._count.users}</td>
                  <td className="py-2.5 px-3">{org._count.contacts}</td>
                  <td className="py-2.5 px-3">
                    <Badge variant={org.isActive ? "default" : "destructive"} className="text-xs">
                      {org.isActive ? t("active") : t("inactive")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
