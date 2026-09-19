import Link from "next/link"
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

  const moduleOptions = DEMO_MODULE_CATALOG.map(({ id: moduleId, title, summary }) => ({ id: moduleId, title, summary }))
  const moduleTitle = new Map(moduleOptions.map((module) => [module.id, module.title]))

  return (
    <div className="space-y-8">
      <header className="border-b border-zinc-200 pb-7 dark:border-zinc-800">
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-4">
          <Link href="/admin/demo-requests"><ArrowLeft className="h-4 w-4" />Demo requests</Link>
        </Button>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{request.status.replaceAll("_", " ")}</Badge>
              <span className="text-xs text-zinc-500">Request {request.id.slice(-8)}</span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{request.company}</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Choose and order the exact demos this prospect may open.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <CalendarClock className="h-4 w-4" /> Requested {request.createdAt.toLocaleString("en-GB")}
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
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Prospect</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <ContactRow icon={Building2} label="Company" value={request.company} />
              <ContactRow icon={UserRound} label="Contact" value={`${request.name}${request.jobTitle ? ` · ${request.jobTitle}` : ""}`} />
              <ContactRow icon={Mail} label="Corporate email" value={request.email} href={`mailto:${request.email}`} />
              <ContactRow icon={Phone} label="Phone" value={request.phone || "Not provided"} href={request.phone ? `tel:${request.phone}` : undefined} />
            </dl>
          </section>
          {request.message ? (
            <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Request note</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{request.message}</p>
            </section>
          ) : null}
          <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Starting a demo never creates a tenant account. Only the selected static manifests are returned after OTP verification.
              </p>
            </div>
          </section>
        </aside>
      </section>

      {request.grants.length ? (
        <section className="border-t border-zinc-200 pt-7 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Access history</h2>
          <div className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {request.grants.flatMap((grant) => grant.events.map((event) => ({ event, grant }))).sort((a, b) => b.event.occurredAt.getTime() - a.event.occurredAt.getTime()).slice(0, 60).map(({ event, grant }) => (
              <div key={event.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[150px_1fr_auto] sm:items-center">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{event.eventType.replaceAll("_", " ")}</span>
                <span className="text-zinc-500">{event.moduleId ? moduleTitle.get(event.moduleId) || event.moduleId : `Grant ···${grant.tokenHint}`}{event.stepId ? ` · ${event.stepId}` : ""}</span>
                <time className="text-xs tabular-nums text-zinc-400">{event.occurredAt.toLocaleString("en-GB")}</time>
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
