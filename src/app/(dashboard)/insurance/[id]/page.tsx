"use client"

import { useEffect, useState, use } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Umbrella, ChevronLeft, Loader2,
  User, Phone, Mail, Calendar, Hash, FileText, MapPin, Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface PolicyHolder {
  id: string
  holderNumber: string
  fullName: string
  email: string | null
  phone: string | null
  dateOfBirth: string | null
  taxId: string | null
  mailingAddressLine1: string | null
  mailingCity: string | null
  mailingPostalCode: string | null
  mailingCountry: string | null
  occupationSlug: string | null
  status: string
  activatedAt: string | null
  deactivatedAt: string | null
  deceasedAt: string | null
  createdAt: string
}

interface Policy {
  id: string
  policyNumber: string
  lineOfBusiness: string
  status: string
  coverageLimit: number | string
  annualPremium: number | string
  billingFrequency: string
  effectiveDate: string | null
  expirationDate: string | null
  createdAt: string
}

const HOLDER_STATUS_COLORS: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  deceased: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const POLICY_STATUS_COLORS: Record<string, string> = {
  quote:     "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  bound:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  expired:   "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  lapsed:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

type Tab = "overview" | "policies"

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-muted-foreground flex-shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  )
}

export default function PolicyHolderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("insurance")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [holder, setHolder] = useState<PolicyHolder | null>(null)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [policiesError, setPoliciesError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("overview")

  // Load holder
  useEffect(() => {
    if (!orgId || !id) return
    setLoading(true)
    fetch(`/api/v1/policy-holders/${id}`, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(json => {
        if (json.holder) setHolder(json.holder)
        else setError(t("loadHolderError"))
      })
      .catch(() => setError(t("loadHolderError")))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId])

  // Load policies on demand
  useEffect(() => {
    if (!orgId || !id || activeTab !== "policies") return
    setTabLoading(true)
    setPoliciesError(null)
    fetch(`/api/v1/policies?policyHolderId=${id}&limit=50`, { headers })
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(json => {
        if (json.policies) setPolicies(json.policies)
        else setPoliciesError(t("loadPoliciesError"))
      })
      .catch(() => setPoliciesError(t("loadPoliciesError")))
      .finally(() => setTabLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, orgId])

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString() : "—"
  const fmtMoney = (v: number | string | null | undefined) => {
    if (v == null) return "—"
    const n = typeof v === "string" ? parseFloat(v) : v
    if (isNaN(n)) return "—"
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !holder) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 mb-4">
          <ChevronLeft className="h-4 w-4" />
          {t("backToHolders")}
        </Button>
        <p className="text-red-500">{error || t("loadHolderError")}</p>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: t("tabOverview"), icon: Activity },
    { key: "policies", label: t("tabPolicies"), icon: FileText },
  ]

  const mailingAddress = [
    holder.mailingAddressLine1,
    holder.mailingCity,
    holder.mailingPostalCode,
    holder.mailingCountry,
  ].filter(Boolean).join(", ")

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => router.push("/insurance")} className="gap-2 -ml-2">
          <ChevronLeft className="h-4 w-4" />
          {t("backToHolders")}
        </Button>

        {/* Header Card */}
        <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-violet-500/10 rounded-full">
              <Umbrella className="h-7 w-7 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold flex items-center gap-2 min-w-0"><span className="truncate">{holder.fullName}</span> <HelpButton slug="insurance-holder-detail" variant="label" className="shrink-0" /></h1>
                <Badge className={cn("text-xs", HOLDER_STATUS_COLORS[holder.status] || HOLDER_STATUS_COLORS.inactive)}>
                  {t(`holderStatus_${holder.status}` as Parameters<typeof t>[0]) ?? holder.status}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Hash className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="font-mono">{holder.holderNumber}</span>
                </div>
                {holder.dateOfBirth && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{fmt(holder.dateOfBirth)}</span>
                  </div>
                )}
                {holder.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{holder.email}</span>
                  </div>
                )}
                {holder.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{holder.phone}</span>
                  </div>
                )}
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
                  ? "border-violet-500 text-violet-600 dark:text-violet-400"
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
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {t("detailPersonal")}
                  </h3>
                  <dl className="space-y-3">
                    <InfoRow label={t("colHolderNumber")} value={holder.holderNumber} />
                    <InfoRow
                      label={t("colStatus")}
                      value={t(`holderStatus_${holder.status}` as Parameters<typeof t>[0]) ?? holder.status}
                    />
                    {holder.dateOfBirth && <InfoRow label={t("detailDob")} value={fmt(holder.dateOfBirth)} />}
                    {holder.occupationSlug && (
                      <InfoRow label={t("detailOccupation")} value={holder.occupationSlug.replace(/_/g, " ")} />
                    )}
                    {holder.activatedAt && <InfoRow label={t("detailActivated")} value={fmt(holder.activatedAt)} />}
                    {holder.deactivatedAt && <InfoRow label={t("detailDeactivated")} value={fmt(holder.deactivatedAt)} />}
                    {holder.deceasedAt && <InfoRow label={t("detailDeceased")} value={fmt(holder.deceasedAt)} />}
                  </dl>
                </div>

                <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-4">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {t("detailContact")}
                  </h3>
                  <dl className="space-y-3">
                    {holder.email && <InfoRow label={t("colEmail")} value={holder.email} />}
                    {holder.phone && <InfoRow label={t("colPhone")} value={holder.phone} />}
                    {mailingAddress && <InfoRow label={t("detailAddress")} value={mailingAddress} />}
                  </dl>

                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setActiveTab("policies")}
                    >
                      <FileText className="h-4 w-4" />
                      {t("tabPolicies")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Policies Tab */}
            {activeTab === "policies" && (
              <div className="space-y-3">
                {policiesError ? (
                  <p className="text-center text-red-500 py-12">{policiesError}</p>
                ) : policies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">{t("noPolicies")}</p>
                ) : (
                  policies.map(policy => (
                    <div key={policy.id} className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div>
                            <span className="font-mono text-xs text-muted-foreground mr-2">{policy.policyNumber}</span>
                            <span className="font-medium text-sm">
                              {t(`lob_${policy.lineOfBusiness}` as Parameters<typeof t>[0]) ?? policy.lineOfBusiness}
                            </span>
                          </div>
                        </div>
                        <Badge className={cn("text-xs", POLICY_STATUS_COLORS[policy.status] || POLICY_STATUS_COLORS.quote)}>
                          {t(`policyStatus_${policy.status}` as Parameters<typeof t>[0]) ?? policy.status}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                        <span>{t("colPremium")}: {fmtMoney(policy.annualPremium)}</span>
                        {policy.effectiveDate && <span>{t("colEffectiveDate")}: {fmt(policy.effectiveDate)}</span>}
                        {policy.expirationDate && <span>{t("colExpirationDate")}: {fmt(policy.expirationDate)}</span>}
                        <span>{policy.billingFrequency.replace(/_/g, " ")}</span>
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
