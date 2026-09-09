"use client"

import { useEffect, useState, use } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Flame, ChevronLeft, Loader2,
  MapPin, Hash, Calendar, Gauge, PhoneCall, Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface UtilityCustomer {
  id: string
  accountNumber: string
  accountHolderName: string
  serviceAddressLine1: string
  serviceAddressLine2: string | null
  serviceCity: string
  servicePostalCode: string | null
  serviceCountry: string | null
  customerClass: string
  status: string
  activatedAt: string | null
  suspendedAt: string | null
  terminatedAt: string | null
  createdAt: string
}

interface MeteringPoint {
  id: string
  meterNumber: string
  commodityType: string
  status: string
  installedAt: string | null
  createdAt: string
}

interface ServiceCall {
  id: string
  callNumber: string
  callType: string
  status: string
  scheduledAt: string | null
  resolvedAt: string | null
  createdAt: string
}

const CUSTOMER_STATUS_COLORS: Record<string, string> = {
  prospect:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  suspended:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  terminated: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const METER_STATUS_COLORS: Record<string, string> = {
  pending_install: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  active:          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  disconnected:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  retired:         "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const CALL_STATUS_COLORS: Record<string, string> = {
  received:    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  dispatched:  "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  resolved:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

type Tab = "overview" | "meters" | "service-calls"

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-muted-foreground flex-shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  )
}

export default function UtilityCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("energy")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [customer, setCustomer] = useState<UtilityCustomer | null>(null)
  const [meters, setMeters] = useState<MeteringPoint[]>([])
  const [serviceCalls, setServiceCalls] = useState<ServiceCall[]>([])
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tabError, setTabError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  // Load customer
  useEffect(() => {
    if (!orgId || !id) return
    setLoading(true)
    fetch(`/api/v1/utility-customers/${id}`, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(json => {
        if (json.customer) setCustomer(json.customer)
        else setError(t("loadCustomerError"))
      })
      .catch(() => setError(t("loadCustomerError")))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId])

  // Load tab data on demand
  useEffect(() => {
    if (!orgId || !id || activeTab === "overview") return
    setTabLoading(true)
    setTabError(null)

    const url = activeTab === "meters"
      ? `/api/v1/metering-points?utilityCustomerId=${id}&limit=50`
      : `/api/v1/service-calls?utilityCustomerId=${id}&limit=50`

    fetch(url, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(json => {
        if (activeTab === "meters" && json.meters) setMeters(json.meters)
        else if (activeTab === "service-calls" && json.calls) setServiceCalls(json.calls)
        else setTabError(t("loadTabError"))
      })
      .catch(() => setTabError(t("loadTabError")))
      .finally(() => setTabLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, orgId])

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString() : "—"

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !customer) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 mb-4">
          <ChevronLeft className="h-4 w-4" />
          {t("backToCustomers")}
        </Button>
        <p className="text-red-500">{error || t("loadCustomerError")}</p>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview",      label: t("tabOverview"),      icon: Activity },
    { key: "meters",        label: t("tabMeters"),        icon: Gauge },
    { key: "service-calls", label: t("tabServiceCalls"),  icon: PhoneCall },
  ]

  const serviceAddress = [
    customer.serviceAddressLine1,
    customer.serviceAddressLine2,
    customer.serviceCity,
    customer.servicePostalCode,
    customer.serviceCountry,
  ].filter(Boolean).join(", ")

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => router.push("/energy")} className="gap-2 -ml-2">
          <ChevronLeft className="h-4 w-4" />
          {t("backToCustomers")}
        </Button>

        {/* Header Card */}
        <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-yellow-500/10 rounded-full">
              <Flame className="h-7 w-7 text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold flex items-center gap-2 min-w-0"><span className="truncate">{customer.accountHolderName}</span> <HelpButton slug="energy-customer-detail" variant="label" className="shrink-0" /></h1>
                <Badge className={cn("text-xs", CUSTOMER_STATUS_COLORS[customer.status] || CUSTOMER_STATUS_COLORS.prospect)}>
                  {t(`customerStatus_${customer.status}` as Parameters<typeof t>[0])}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="font-mono">{customer.accountNumber}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground col-span-2">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{serviceAddress}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === tab.key
                  ? "border-yellow-500 text-yellow-600 dark:text-yellow-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tabLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tabError ? (
          <p className="text-center text-red-500 py-12">{tabError}</p>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    {t("detailAccount")}
                  </h3>
                  <dl className="space-y-3">
                    <InfoRow label={t("colAccountNumber")} value={customer.accountNumber} />
                    <InfoRow label={t("colClass")} value={customer.customerClass.replace(/_/g, " ")} />
                    <InfoRow
                      label={t("colStatus")}
                      value={t(`customerStatus_${customer.status}` as Parameters<typeof t>[0])}
                    />
                    {customer.activatedAt && <InfoRow label={t("detailActivated")} value={fmt(customer.activatedAt)} />}
                    {customer.suspendedAt && <InfoRow label={t("detailSuspended")} value={fmt(customer.suspendedAt)} />}
                    {customer.terminatedAt && <InfoRow label={t("detailTerminated")} value={fmt(customer.terminatedAt)} />}
                  </dl>
                </div>

                <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {t("detailServiceAddress")}
                  </h3>
                  <dl className="space-y-3">
                    <InfoRow label={t("colCity")} value={customer.serviceCity} />
                    {customer.serviceAddressLine1 && <InfoRow label={t("detailAddressLine1")} value={customer.serviceAddressLine1} />}
                    {customer.serviceAddressLine2 && <InfoRow label={t("detailAddressLine2")} value={customer.serviceAddressLine2} />}
                    {customer.servicePostalCode && <InfoRow label={t("detailPostalCode")} value={customer.servicePostalCode} />}
                    {customer.serviceCountry && <InfoRow label={t("detailCountry")} value={customer.serviceCountry} />}
                  </dl>
                  <div className="pt-2 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-2" onClick={() => setActiveTab("meters")}>
                      <Gauge className="h-4 w-4" />
                      {t("tabMeters")}
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 gap-2" onClick={() => setActiveTab("service-calls")}>
                      <PhoneCall className="h-4 w-4" />
                      {t("tabServiceCalls")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Meters Tab */}
            {activeTab === "meters" && (
              <div className="space-y-3">
                {meters.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">{t("noMeters")}</p>
                ) : (
                  meters.map(m => (
                    <div key={m.id} className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <Gauge className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div>
                            <span className="font-mono text-xs text-muted-foreground mr-2">{m.meterNumber}</span>
                            <span className="font-medium text-sm capitalize">{m.commodityType.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                        <Badge className={cn("text-xs", METER_STATUS_COLORS[m.status] || METER_STATUS_COLORS.pending_install)}>
                          {t(`meterStatus_${m.status}` as Parameters<typeof t>[0])}
                        </Badge>
                      </div>
                      {m.installedAt && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3 inline mr-1" />
                          {t("colInstalled")}: {fmt(m.installedAt)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Service Calls Tab */}
            {activeTab === "service-calls" && (
              <div className="space-y-3">
                {serviceCalls.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">{t("noServiceCalls")}</p>
                ) : (
                  serviceCalls.map(call => (
                    <div key={call.id} className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <PhoneCall className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div>
                            <span className="font-mono text-xs text-muted-foreground mr-2">{call.callNumber}</span>
                            <span className="font-medium text-sm capitalize">{call.callType.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                        <Badge className={cn("text-xs", CALL_STATUS_COLORS[call.status] || CALL_STATUS_COLORS.received)}>
                          {t(`callStatus_${call.status}` as Parameters<typeof t>[0])}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        {call.scheduledAt && <span>{t("colScheduled")}: {fmt(call.scheduledAt)}</span>}
                        {call.resolvedAt && <span>{t("detailResolved")}: {fmt(call.resolvedAt)}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </MotionPage>
  )
}
