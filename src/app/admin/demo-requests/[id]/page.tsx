import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, Building2, CalendarClock, Mail, Phone, ShieldCheck, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DemoRequestEditor } from "@/components/admin/demo-request-editor"
import { DEMO_MODULE_CATALOG } from "@/lib/demo-center/catalog"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isSuperAdminSession } from "@/lib/superadmin-guard"

export default async function DemoRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isSuperAdminSession())) redirect("/dashboard")
  const t = await getTranslations("admin.demoCenter")
  const locale = await getLocale()
  const { id } = await params
  const request = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({
      where: { id },
      include: {
        grants: {
          orderBy: { createdAt: "desc" },
          include: { events: { take: 50, orderBy: { occurredAt: "desc" } } },
        },
      },
    }),
  )
  if (!request) notFound()

  // Named and typed rather than inlined: the chain was long enough that
  // TypeScript lost the element type and every callback silently became any.
  type GrantWithEvents = (typeof request.grants)[number]
  type TrailRow = { event: GrantWithEvents["events"][number]; grant: GrantWithEvents }
  const accessTrail: TrailRow[] = request.grants
    .flatMap((grant: GrantWithEvents) => grant.events.map((event) => ({ event, grant })))
    .sort((a: TrailRow, b: TrailRow) => b.event.occurredAt.getTime() - a.event.occurredAt.getTime())
    .slice(0, 60)

  // Which CRM the verified prospect landed in. Superadmin-only page; the same
  // ids are never selected by any public route.
  const leadOrganization = request.internalLeadOrganizationId
    ? await runWithRlsBypass(() =>
        prisma.organization.findUnique({ where: { id: request.internalLeadOrganizationId! }, select: { name: true } }),
      )
    : null
  const leadLinkLabel =
    request.leadLinkStatus === "LINKED" ? t("leadLinkLinked")
    : request.leadLinkStatus === "PENDING" ? t("leadLinkPending")
    : request.leadLinkStatus === "FAILED" ? t("leadLinkFailed")
    : request.leadLinkStatus === "UNCONFIGURED" ? t("leadLinkUnconfigured")
    : t("leadLinkNone")

  const moduleOptions = DEMO_MODULE_CATALOG.map(({ id: moduleId, title, summary }) => ({ id: moduleId, title, summary }))
  const moduleTitle = new Map(moduleOptions.map((module) => [module.id, module.title]))

  return (
    <div className="space-y-8">
      <header className="border-b border-zinc-200 pb-7 dark:border-zinc-800">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4">
          <Link href="/admin/demo-requests"><ArrowLeft className="h-4 w-4" />{t("backToRequests")}</Link>
        </Button>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{request.status.replaceAll("_", " ")}</Badge>
              <span className="text-xs text-zinc-500">Request {request.id.slice(-8)}</span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{request.company}</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t("detailSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <CalendarClock className="h-4 w-4" /> {t("requested")} {request.createdAt.toLocaleString(locale)}
          </div>
        </div>
      </header>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.7fr)]">
        <DemoRequestEditor
          requestId={request.id}
          requestStatus={request.status}
          requestedModuleIds={request.requestedModules}
          modules={moduleOptions}
          grants={request.grants.map((grant) => ({
            id: grant.id,
            status: grant.status,
            moduleIds: grant.moduleIds,
            sentAt: grant.sentAt?.toISOString() || null,
            openedAt: grant.openedAt?.toISOString() || null,
            sessionStartedAt: grant.sessionStartedAt?.toISOString() || null,
            completedAt: grant.completedAt?.toISOString() || null,
            expiresAt: grant.linkExpiresAt.toISOString(),
          }))}
        />

        <aside className="space-y-7">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{t("prospect")}</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <ContactRow icon={Building2} label={t("company")} value={request.company} />
              <ContactRow icon={UserRound} label={t("contact")} value={`${request.name}${request.jobTitle ? ` · ${request.jobTitle}` : ""}`} />
              <ContactRow icon={Mail} label={t("corporateEmail")} value={request.email} href={`mailto:${request.email}`} />
              <ContactRow icon={Phone} label={t("phone")} value={request.phone || t("notProvided")} href={request.phone ? `tel:${request.phone}` : undefined} />
            </dl>
          </section>
          <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{t("leadLink")}</h2>
            <p className="mt-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">{leadLinkLabel}</p>
            {request.leadLinkStatus === "LINKED" && request.internalLeadId ? (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {leadOrganization?.name ?? request.internalLeadOrganizationId} ·{" "}
                <Link className="text-orange-700 hover:underline" href={`/leads/${request.internalLeadId}`}>{t("openLead")}</Link>
              </p>
            ) : null}
            {request.leadLinkStatus === "FAILED" && request.leadLinkError ? (
              <p className="mt-1 break-words text-xs text-zinc-500">{request.leadLinkError}</p>
            ) : null}
          </section>
          {request.message ? (
            <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{t("requestNote")}</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{request.message}</p>
            </section>
          ) : null}
          <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {t("noTenantNote")}
              </p>
            </div>
          </section>
        </aside>
      </section>

      {request.grants.length ? (
        <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("accessHistory")}</h2>
          <div className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {accessTrail.map(({ event, grant }) => (
              <div key={event.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[150px_1fr_auto] sm:items-center">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{event.eventType.replaceAll("_", " ")}</span>
                <span className="text-zinc-500">{event.moduleId ? moduleTitle.get(event.moduleId) || event.moduleId : `Grant ···${grant.tokenHint}`}{event.stepId ? ` · ${event.stepId}` : ""}</span>
                <time className="text-xs tabular-nums text-zinc-400">{event.occurredAt.toLocaleString(locale)}</time>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function ContactRow({ icon: Icon, label, value, href }: { icon: typeof Building2; label: string; value: string; href?: string }) {
  return (
    <div className="grid grid-cols-[24px_1fr] gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-zinc-400" />
      <div><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">{href ? <a className="hover:text-orange-700 hover:underline" href={href}>{value}</a> : value}</dd></div>
    </div>
  )
}
