import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isSuperAdminSession } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import { notFound, redirect } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ExternalLink, Users, Contact, Briefcase, Building2, Pencil } from "lucide-react"
import Link from "next/link"
import { TenantActions } from "./tenant-actions"
import { TenantCapabilitiesPanel } from "./tenant-capabilities-panel"
import { TenantProvisioningPanel } from "./tenant-provisioning-panel"
import { TenantAdminPasswordReset } from "./tenant-admin-password-reset"
import { getTranslations } from "next-intl/server"
import { usesLegacyInboxScope, isLegacyInboxScope } from "@/lib/admin/api-key-scopes"

type TenantUserRow = Prisma.UserGetPayload<{
  select: {
    id: true
    name: true
    email: true
    role: true
    isActive: true
    lastLogin: true
    createdAt: true
  }
}>

type TenantApiKeyRow = Prisma.ApiKeyGetPayload<{
  select: {
    id: true
    name: true
    keyPrefix: true
    scopes: true
    isActive: true
    lastUsedAt: true
    expiresAt: true
    createdAt: true
  }
}>

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Page-level superadmin gate: the admin layout gate does not re-run on
  // soft/partial RSC navigations, and the gate MUST precede the cross-tenant
  // bypass scope below.
  if (!(await isSuperAdminSession())) redirect("/dashboard")

  const { id } = await params
  const t = await getTranslations("admin")

  // RLS: cross-tenant inspection (users relation + _count hit tenant tables
  // under any org) → bypass scope (server component → .run() form).
  const tenant = await runWithRlsBypass(() =>
    prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, isActive: true, lastLogin: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { users: true, contacts: true, deals: true, companies: true, leads: true },
        },
        // API-ключи тенанта: суперадмину нужно видеть их scope'ы, не заходя в
        // CRM клиента под его админом. keyHash НЕ выбираем — секрет наружу не
        // выходит даже в суперадминской панели (в UI живёт только keyPrefix).
        apiKeys: {
          select: {
            id: true, name: true, keyPrefix: true, scopes: true,
            isActive: true, lastUsedAt: true, expiresAt: true, createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    })
  )

  if (!tenant) notFound()

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
  const tenantUrl = `https://${tenant.slug}.${baseDomain}`

  const stats = [
    { label: t("users"), value: tenant._count.users, icon: Users },
    { label: t("contacts"), value: tenant._count.contacts, icon: Contact },
    { label: t("companies"), value: tenant._count.companies, icon: Building2 },
    { label: t("deals"), value: tenant._count.deals, icon: Briefcase },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/tenants">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              {t("back")}
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{tenant.name}</h1>
              <Badge variant={tenant.isActive ? "default" : "destructive"}>
                {tenant.isActive ? t("active") : t("inactive")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground font-mono">{tenant.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/tenants/${tenant.id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="w-4 h-4 mr-1" />
              {t("edit")}
            </Button>
          </Link>
          <a href={tenantUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="w-4 h-4 mr-1" />
              {t("openCrm")}
            </Button>
          </a>
        </div>
      </div>

      {/* Tenant actions (deletion, export, deactivation) */}
      <TenantActions
        tenantId={tenant.id}
        isActive={tenant.isActive}
        tenantName={tenant.name}
        tenantSlug={tenant.slug}
        deletionScheduledAt={tenant.deletionScheduledAt?.toISOString() || null}
      />

      <TenantProvisioningPanel tenantId={tenant.id} />

      <TenantCapabilitiesPanel tenantId={tenant.id} />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                  <p className="text-xl font-bold mt-0.5">{stat.value}</p>
                </div>
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
            </Card>
          )
        })}
      </div>

      {/* Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">{t("details")}</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("plan")}</dt>
              <dd><Badge variant="outline" className="capitalize">{tenant.plan}</Badge></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("maxUsers")}</dt>
              <dd>{tenant.maxUsers === -1 ? t("unlimited") : tenant.maxUsers}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("maxContacts")}</dt>
              <dd>{tenant.maxContacts === -1 ? t("unlimited") : tenant.maxContacts.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("serverType")}</dt>
              <dd className="capitalize">{tenant.serverType}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("url")}</dt>
              <dd className="font-mono text-xs">{tenantUrl}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("created")}</dt>
              <dd>{new Date(tenant.createdAt).toLocaleString()}</dd>
            </div>
            {tenant.provisionedAt && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("provisioned")}</dt>
                <dd>{new Date(tenant.provisionedAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        </Card>

        {/* API-ключи тенанта */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-1">{t("apiKeys.title")} ({tenant.apiKeys.length})</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("apiKeys.subtitle")}</p>
          <div className="space-y-3">
            {tenant.apiKeys.map((key: TenantApiKeyRow) => {
              const expired = !!key.expiresAt && key.expiresAt.getTime() < Date.now()
              return (
                <div key={key.id} className="text-sm py-2 border-b last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{key.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{key.keyPrefix}…</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {usesLegacyInboxScope(key.scopes) && (
                        <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">
                          {t("apiKeys.legacyInboxScope")}
                        </Badge>
                      )}
                      {expired ? (
                        <Badge variant="destructive" className="text-xs">{t("apiKeys.expired")}</Badge>
                      ) : (
                        <Badge variant={key.isActive ? "default" : "destructive"} className="text-xs">
                          {key.isActive ? t("active") : t("apiKeys.revoked")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {key.scopes.map((scope: string) => (
                      <span
                        key={scope}
                        className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${
                          isLegacyInboxScope(scope)
                            ? "bg-amber-100 text-amber-800"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {t("apiKeys.lastUsed")}:{" "}
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : t("apiKeys.never")}
                  </p>
                </div>
              )
            })}
            {tenant.apiKeys.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("apiKeys.none")}</p>
            )}
          </div>
        </Card>

        {/* Users */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">{t("users")} ({tenant.users.length})</h3>
          <div className="space-y-2">
            {tenant.users.map((user: TenantUserRow) => (
              <div key={user.id} className="flex flex-col gap-2 border-b py-2 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize">{user.role}</Badge>
                  {!user.isActive && <Badge variant="destructive" className="text-xs">{t("disabled")}</Badge>}
                  {user.role === "admin" && (
                    <TenantAdminPasswordReset
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                      tenantSlug={tenant.slug}
                      user={{
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        isActive: user.isActive,
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
            {tenant.users.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noUsers")}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
