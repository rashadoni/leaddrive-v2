"use client"

import { useEffect, useState, use } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tv, ChevronLeft, Loader2,
  Hash, Mail, Globe, DollarSign, Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface MediaSubscriber {
  id: string
  subscriberNumber: string
  displayName: string
  email: string | null
  tierSlug: string
  billingRegion: string | null
  status: string
  trialStartedAt: string | null
  activatedAt: string | null
  pausedAt: string | null
  churnedAt: string | null
  bannedAt: string | null
  banReason: string | null
  lifetimeRevenueCents: number | string
  createdAt: string
}

const SUBSCRIBER_STATUS_COLORS: Record<string, string> = {
  trial:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  churned: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  banned:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-muted-foreground flex-shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  )
}

export default function MediaSubscriberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("media")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [subscriber, setSubscriber] = useState<MediaSubscriber | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !id) return
    setLoading(true)
    fetch(`/api/v1/media-subscribers/${id}`, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(json => {
        if (json.subscriber) setSubscriber(json.subscriber)
        else setError(t("loadSubscriberError"))
      })
      .catch(() => setError(t("loadSubscriberError")))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId])

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString() : "—"
  const fmtRevenue = (v: number | string | null | undefined) => {
    if (v == null) return "—"
    const cents = typeof v === "string" ? parseInt(v, 10) : Number(v)
    if (isNaN(cents)) return "—"
    return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !subscriber) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 mb-4">
          <ChevronLeft className="h-4 w-4" />
          {t("backToSubscribers")}
        </Button>
        <p className="text-red-500">{error || t("loadSubscriberError")}</p>
      </div>
    )
  }

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => router.push("/media")} className="gap-2 -ml-2">
          <ChevronLeft className="h-4 w-4" />
          {t("backToSubscribers")}
        </Button>

        {/* Header Card */}
        <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/10 rounded-full">
              <Tv className="h-7 w-7 text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold flex items-center gap-2 min-w-0"><span className="truncate">{subscriber.displayName}</span> <HelpButton slug="media-subscriber-detail" variant="label" className="shrink-0" /></h1>
                <Badge className={cn("text-xs", SUBSCRIBER_STATUS_COLORS[subscriber.status] || SUBSCRIBER_STATUS_COLORS.trial)}>
                  {t(`subscriberStatus_${subscriber.status}` as Parameters<typeof t>[0])}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="font-mono">{subscriber.subscriberNumber}</span>
                </div>
                {subscriber.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{subscriber.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="capitalize">{subscriber.tierSlug.replace(/-/g, " ")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Hash className="h-4 w-4" />
              {t("detailSubscription")}
            </h3>
            <dl className="space-y-3">
              <InfoRow label={t("colSubscriberNumber")} value={subscriber.subscriberNumber} />
              <InfoRow label={t("colPlan")} value={subscriber.tierSlug.replace(/-/g, " ")} />
              <InfoRow
                label={t("colStatus")}
                value={t(`subscriberStatus_${subscriber.status}` as Parameters<typeof t>[0])}
              />
              {subscriber.activatedAt && <InfoRow label={t("detailActivated")} value={fmt(subscriber.activatedAt)} />}
              {subscriber.pausedAt && <InfoRow label={t("detailPaused")} value={fmt(subscriber.pausedAt)} />}
              {subscriber.churnedAt && <InfoRow label={t("detailChurned")} value={fmt(subscriber.churnedAt)} />}
              {subscriber.bannedAt && <InfoRow label={t("detailBanned")} value={fmt(subscriber.bannedAt)} />}
            </dl>
          </div>

          <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              {t("detailBilling")}
            </h3>
            <dl className="space-y-3">
              {subscriber.email && <InfoRow label={t("colEmail")} value={subscriber.email} />}
              {subscriber.billingRegion && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <dt className="text-muted-foreground">{t("detailRegion")}</dt>
                  <dd className="ml-auto font-medium">{subscriber.billingRegion}</dd>
                </div>
              )}
              <InfoRow label={t("detailLifetimeRevenue")} value={`$${fmtRevenue(subscriber.lifetimeRevenueCents)}`} />
              {subscriber.banReason && (
                <div className="pt-1 text-sm text-red-500">
                  <span className="font-medium">{t("detailBanReason")}: </span>
                  {subscriber.banReason}
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </MotionPage>
  )
}
