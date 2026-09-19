import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, Building2, Clock3, Eye, Inbox, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isSuperAdminSession } from "@/lib/superadmin-guard"

const statusStyle: Record<string, string> = {
  SUBMITTED: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  UNDER_REVIEW: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  FULFILLED: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  REJECTED: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
}

const grantLabel: Record<string, string> = {
  SENT: "Link sent",
  OTP_SENT: "OTP sent",
  OTP_VERIFIED: "Verified",
  ACTIVE: "In session",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  DELIVERY_FAILED: "Delivery failed",
  ISSUING: "Preparing",
}

export default async function DemoRequestsPage() {
  if (!(await isSuperAdminSession())) redirect("/dashboard")

  const [requests, submitted, activeSessions, completed] = await runWithRlsBypass(() =>
    Promise.all([
      prisma.demoRequest.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        include: {
          grants: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, moduleIds: true, sentAt: true, sessionStartedAt: true, completedAt: true },
          },
        },
      }),
      prisma.demoRequest.count({ where: { status: "SUBMITTED" } }),
      prisma.demoGrant.count({ where: { status: "ACTIVE" } }),
      prisma.demoGrant.count({ where: { status: "COMPLETED" } }),
    ]),
  )

  const stats = [
    { label: "Awaiting review", value: submitted, icon: Inbox },
    { label: "Active sessions", value: activeSessions, icon: Eye },
    { label: "Completed", value: completed, icon: ShieldCheck },
  ]

  return (
    <div className="space-y-8">
      <header className="grid gap-5 border-b border-zinc-200 pb-7 dark:border-zinc-800 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">Private sales workspace</p>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">Demo Center</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Review corporate requests, choose any of the 19 curated module tours, and issue one protected browser session.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          <ShieldCheck className="h-4 w-4 text-emerald-700" />
          Tenant access is never granted
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Demo request summary">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="flex items-center justify-between border-b border-zinc-300 pb-4 dark:border-zinc-800">
              <div>
                <p className="text-2xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">{stat.value}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{stat.label}</p>
              </div>
              <Icon className="h-5 w-5 text-zinc-400" />
            </div>
          )
        })}
      </section>

      {requests.length === 0 ? (
        <Card className="flex min-h-72 flex-col items-center justify-center border-dashed p-10 text-center shadow-none">
          <Inbox className="h-8 w-8 text-zinc-400" />
          <h2 className="mt-4 text-lg font-semibold">No demo requests yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">New corporate requests from the public demo form will appear here.</p>
          <Button asChild variant="outline" className="mt-5"><Link href="/demo">Open public form</Link></Button>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="hidden grid-cols-[minmax(220px,1.2fr)_minmax(190px,1fr)_150px_150px_48px] gap-4 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400 md:grid">
            <span>Company</span><span>Contact</span><span>Request</span><span>Access</span><span />
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {requests.map((request) => {
              const grant = request.grants[0]
              return (
                <Link
                  key={request.id}
                  href={`/admin/demo-requests/${request.id}`}
                  className="group grid gap-4 px-5 py-5 transition-colors hover:bg-orange-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-600 dark:hover:bg-orange-950/20 md:grid-cols-[minmax(220px,1.2fr)_minmax(190px,1fr)_150px_150px_48px] md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><Building2 className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{request.company}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500"><Clock3 className="h-3 w-3" />{request.createdAt.toLocaleDateString("en-GB")}</p>
                    </div>
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-zinc-800 dark:text-zinc-200">{request.name}</p>
                    <p className="truncate text-zinc-500">{request.email}</p>
                  </div>
                  <div><Badge variant="outline" className={statusStyle[request.status] || ""}>{request.status.replaceAll("_", " ")}</Badge></div>
                  <div className="text-sm text-zinc-600">
                    {grant ? (
                      <><p className="font-medium text-zinc-800 dark:text-zinc-200">{grantLabel[grant.status] || grant.status}</p><p className="mt-0.5 text-xs">{grant.moduleIds.length} modules</p></>
                    ) : <span className="text-zinc-400">Not issued</span>}
                  </div>
                  <ArrowRight className="hidden h-4 w-4 text-zinc-400 transition-transform group-hover:translate-x-1 md:block" />
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
