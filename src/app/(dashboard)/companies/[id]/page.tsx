"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ArrowLeft, Building2, Globe, Mail, Phone, MapPin, Users, Pencil,
  DollarSign, Loader2, ChevronDown, ChevronRight, Clock, Briefcase,
  TicketCheck, TrendingUp, Activity, Handshake, MessageSquare
} from "lucide-react"
import { ColorStatCard } from "@/components/color-stat-card"
import { InfoHint } from "@/components/info-hint"
import { CompanyForm } from "@/components/company-form"
import { useFieldPermissions } from "@/hooks/use-field-permissions"
import { ClickToCallButton } from "@/components/call-widget"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"
import { CompanyMonitoringLink } from "@/components/social/company-monitoring-link"

interface CompanyDetail {
  id: string
  name: string
  industry: string | null
  website: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  country: string | null
  status: string
  employeeCount: number | null
  annualRevenue: number | null
  description: string | null
  createdAt: string
  contacts: Array<{ id: string; fullName: string; position: string | null; email: string | null; phone: string | null }>
  deals: Array<{ id: string; name: string; stage: string; valueAmount: number; currency: string; createdAt: string }>
  activities: Array<{ id: string; type: string; subject: string | null; createdAt: string }>
}

interface TimelineEntry {
  id: string
  type: "activity" | "deal" | "ticket" | "call" | "email" | "message"
  title: string
  subtitle?: string
  date: string
  meta?: Record<string, any>
}

const STAGE_COLORS: Record<string, string> = {
  LEAD: "bg-indigo-100 text-indigo-700",
  QUALIFIED: "bg-blue-100 text-blue-700",
  PROPOSAL: "bg-amber-100 text-amber-700",
  NEGOTIATION: "bg-orange-100 text-orange-700",
  WON: "bg-green-100 text-green-700",
  LOST: "bg-red-100 text-red-700",
}

const ACTIVITY_ICONS: Record<string, string> = {
  meeting: "🤝", email: "📧", call: "📞", note: "📝", task: "✅",
}

function TimelineIcon({ type, activityType }: { type: string; activityType?: string }) {
  if (type === "deal") return <Handshake className="h-4 w-4 text-indigo-500" />
  if (type === "ticket") return <TicketCheck className="h-4 w-4 text-amber-500" />
  if (type === "call") return <Phone className="h-4 w-4 text-emerald-500" />
  if (type === "email") return <Mail className="h-4 w-4 text-blue-500" />
  if (type === "message") return <MessageSquare className="h-4 w-4 text-sky-500" />
  const emoji = ACTIVITY_ICONS[activityType || ""] || "📌"
  return <span className="text-base leading-none">{emoji}</span>
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

export default function CompanyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const t = useTranslations("companies")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  useAutoTour("companyDetail")
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [pricingProfile, setPricingProfile] = useState<any>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingSales, setPricingSales] = useState<any[]>([])
  const [expandedPricingCats, setExpandedPricingCats] = useState<Set<string>>(new Set())
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [callHistory, setCallHistory] = useState<any[]>([])
  const [callsLoading, setCallsLoading] = useState(false)
  const orgId = session?.user?.organizationId
  const { isVisible, isEditable } = useFieldPermissions("company")

  const fetchCompany = async () => {
    try {
      const res = await fetch(`/api/v1/companies/${params.id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success && json.data) setCompany(json.data)
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  const fetchPricing = async () => {
    if (!orgId) return
    setPricingLoading(true)
    try {
      const headers = { "x-organization-id": String(orgId) }
      const res = await fetch(`/api/v1/pricing/profiles?companyId=${params.id}&all=true`, { headers })
      const json = await res.json()
      if (json.success && json.data.profiles?.length > 0) {
        const profile = json.data.profiles[0]
        setPricingProfile(profile)
        const salesRes = await fetch(`/api/v1/pricing/additional-sales?profileId=${profile.id}`, { headers })
        const salesJson = await salesRes.json()
        if (salesJson.success) setPricingSales(salesJson.data.sales || [])
      }
    } catch (err) { console.error(err) } finally { setPricingLoading(false) }
  }

  const fetchTimeline = async () => {
    if (!orgId || !params.id) return
    setTimelineLoading(true)
    try {
      const res = await fetch(`/api/v1/companies/${params.id}/timeline`, {
        headers: { "x-organization-id": String(orgId) },
      })
      const json = await res.json()
      if (json.success) setTimeline(json.data.timeline)
    } catch (err) { console.error(err) } finally { setTimelineLoading(false) }
  }

  const loadCallHistory = async () => {
    setCallsLoading(true)
    try {
      const res = await fetch(`/api/v1/calls?companyId=${params.id}&limit=20`)
      const json = await res.json()
      if (json.success) setCallHistory(json.data || [])
    } catch { /* ignore */ }
    finally { setCallsLoading(false) }
  }

  useEffect(() => { if (params.id) fetchCompany() }, [params.id, session])
  useEffect(() => { if (params.id && orgId) { fetchPricing(); fetchTimeline() } }, [params.id, orgId])

  if (loading) {
    return <div className="space-y-6"><div className="animate-pulse"><div className="h-64 bg-muted rounded-lg" /></div></div>
  }

  if (!company) {
    return <div className="text-center py-12 text-muted-foreground">{t("companyNotFound")}</div>
  }

  // Закрытая сделка не активна ни под каким написанием: иначе KPI «Активные
  // сделки» и «Воронка» на карточке компании завышены на уже закрытые деньги.
  const activeDeals = company.deals?.filter(
    d => !["WON", "LOST"].includes(canonicalDealStage(d.stage)),
  ) || []
  const pipelineValue = activeDeals.reduce((s, d) => s + d.valueAmount, 0)
  const daysAsClient = Math.floor((Date.now() - new Date(company.createdAt).getTime()) / 86400000)

  const kpiCards = [
    { label: t("kpiContacts"), value: company.contacts?.length || 0, bg: "bg-primary", icon: <Users className="h-4 w-4 opacity-80" /> },
    { label: t("kpiActiveDeals"), value: activeDeals.length, bg: "bg-[hsl(var(--ai-from))]", icon: <Handshake className="h-4 w-4 opacity-80" /> },
    { label: t("kpiPipeline"), value: `${pipelineValue.toLocaleString()} ₼`, bg: "bg-green-500", icon: <TrendingUp className="h-4 w-4 opacity-80" /> },
    { label: t("kpiDaysAsClient"), value: daysAsClient, bg: "bg-[hsl(var(--ai-to))]", icon: <Clock className="h-4 w-4 opacity-80" /> },
  ]

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/companies")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-lg flex-shrink-0">
              {company.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold flex items-center gap-2 min-w-0"><span className="truncate">{company.name}</span> <TourReplayButton tourId="companyDetail" /><HelpButton slug="company-detail" variant="label" className="shrink-0" /></h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {company.industry && <span>{company.industry}</span>}
                <Badge variant={company.status === "active" ? "default" : "secondary"} className="text-xs">{company.status}</Badge>
              </div>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" /> {tc("edit")}
        </Button>
      </div>

      {/* Мониторинг бренда: один и тот же клиент больше не заводится дважды. */}
      <CompanyMonitoringLink companyId={String(company.id)} companyName={company.name} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tour-id="company-kpi">
        <ColorStatCard label={t("kpiContacts")} value={company.contacts?.length || 0} icon={<Users className="h-4 w-4" />} hint={t("hintKpiContacts")} />
        <ColorStatCard label={t("kpiActiveDeals")} value={activeDeals.length} icon={<Handshake className="h-4 w-4" />} hint={t("hintKpiActiveDeals")} />
        <ColorStatCard label={t("kpiPipeline")} value={`${pipelineValue.toLocaleString()} ₼`} icon={<TrendingUp className="h-4 w-4" />} hint={t("hintKpiPipeline")} />
        <ColorStatCard label={t("kpiDaysAsClient")} value={daysAsClient} icon={<Clock className="h-4 w-4" />} hint={t("hintKpiDaysAsClient")} />
      </div>

      <AdvisorRecordWidget entityType="company" entityId={company.id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

      {/* Contact info row */}
      <div className="grid gap-3 sm:grid-cols-4">
        {isVisible("website") && (
          <Card className="border-none shadow-sm bg-card"><CardContent className="flex items-center gap-2.5 pt-4 pb-4">
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            {company.website
              ? <a href={company.website} className="text-sm text-primary hover:underline truncate" target="_blank">{company.website.replace(/^https?:\/\//, "")}</a>
              : <span className="text-sm text-muted-foreground">—</span>}
          </CardContent></Card>
        )}
        {isVisible("phone") && (
          <Card className="border-none shadow-sm bg-card"><CardContent className="flex items-center gap-2.5 pt-4 pb-4">
            <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="text-sm truncate">{company.phone || "—"}</span>
            {company.phone && <ClickToCallButton phone={company.phone} companyId={company.id} contactName={company.name} />}
          </CardContent></Card>
        )}
        {isVisible("email") && (
          <Card className="border-none shadow-sm bg-card"><CardContent className="flex items-center gap-2.5 pt-4 pb-4">
            <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="text-sm truncate">{company.email || "—"}</span>
          </CardContent></Card>
        )}
        {isVisible("address") && (
          <Card className="border-none shadow-sm bg-card"><CardContent className="flex items-center gap-2.5 pt-4 pb-4">
            <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm truncate">{[company.city, company.country].filter(Boolean).join(", ") || "—"}</span>
          </CardContent></Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-muted/60 p-1 h-auto flex-wrap" data-tour-id="company-tabs">
          <TabsTrigger value="overview" className="rounded-md text-sm">{t("tabOverview")} <InfoHint text={t("hintTabOverview")} size={12} className="ml-1" /></TabsTrigger>
          <TabsTrigger value="contacts" className="rounded-md text-sm">{t("tabContacts")} ({company.contacts?.length || 0}) <InfoHint text={t("hintTabContacts")} size={12} className="ml-1" /></TabsTrigger>
          <TabsTrigger value="deals" className="rounded-md text-sm">{t("tabDeals")} ({company.deals?.length || 0}) <InfoHint text={t("hintTabDeals")} size={12} className="ml-1" /></TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-md text-sm">{t("tabTimeline")} <InfoHint text={t("hintTabTimeline")} size={12} className="ml-1" /></TabsTrigger>
          <TabsTrigger value="calls" className="rounded-md text-sm" onClick={() => { if (callHistory.length === 0 && !callsLoading) loadCallHistory() }}>
            <Phone className="h-3.5 w-3.5 mr-1" /> Calls
          </TabsTrigger>
          <TabsTrigger value="pricing" className="rounded-md text-sm">
            <DollarSign className="h-3.5 w-3.5 mr-1" />{t("tabPricing")} <InfoHint text={t("hintTabPricing")} size={12} className="ml-1" />
          </TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="border-none shadow-sm bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("about")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {isVisible("description") && (
                  <p className="text-muted-foreground">{company.description || t("noDescription")}</p>
                )}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {[
                    isVisible("industry") ? [tc("industry"), company.industry || "—"] : null,
                    isVisible("employeeCount") ? [tc("employees"), company.employeeCount?.toString() || "—"] : null,
                    isVisible("country") ? [tc("country"), company.country || "—"] : null,
                    isVisible("annualRevenue") ? [tc("annualRevenue"), company.annualRevenue ? `${company.annualRevenue.toLocaleString()} ₼` : "—"] : null,
                  ].filter(Boolean).map(([label, value]: any) => (
                    <div key={label}>
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <p className="font-medium text-sm mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("recentActivity")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(company.activities || []).slice(0, 5).map(activity => (
                  <div key={activity.id} className="flex items-center gap-2.5">
                    <span className="text-base">{ACTIVITY_ICONS[activity.type] || "📌"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{activity.subject || activity.type}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(activity.createdAt, locale)}</p>
                    </div>
                  </div>
                ))}
                {(company.activities || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("noActivities")}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Contacts */}
        <TabsContent value="contacts">
          <Card className="border-none shadow-sm bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("tabContacts")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(company.contacts || []).map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/contacts/${contact.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold flex-shrink-0">
                        {contact.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{contact.fullName}</div>
                        <div className="text-xs text-muted-foreground">{contact.position || "—"}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{contact.email || ""}</div>
                      <div>{contact.phone || ""}</div>
                    </div>
                  </div>
                ))}
                {(company.contacts || []).length === 0 && <p className="text-sm text-muted-foreground">{t("noContacts")}</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deals */}
        <TabsContent value="deals">
          <Card className="border-none shadow-sm bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("tabDeals")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(company.deals || []).map(deal => (
                  <div
                    key={deal.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/deals/${deal.id}`)}
                  >
                    <div>
                      <div className="font-medium text-sm">{deal.name}</div>
                      <Badge className={`mt-1 text-xs ${STAGE_COLORS[deal.stage] || ""}`}>{deal.stage}</Badge>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-primary">
                        {deal.valueAmount > 0 ? `${deal.valueAmount.toLocaleString()} ${deal.currency}` : "—"}
                      </span>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(deal.createdAt, locale)}</p>
                    </div>
                  </div>
                ))}
                {(company.deals || []).length === 0 && <p className="text-sm text-muted-foreground">{t("noDeals")}</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline">
          <Card className="border-none shadow-sm bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Activity className="h-4 w-4" /> {t("unifiedTimeline")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timelineLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : timeline.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">{t("noTimeline")}</p>
                </div>
              ) : (
                <div className="relative">
                  {/* Vertical line */}
                  <div className="absolute left-[18px] top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-700" />
                  <div className="space-y-4 pl-10">
                    {timeline.map(entry => (
                      <div key={`${entry.type}-${entry.id}`} className="relative">
                        {/* Dot */}
                        <div className="absolute -left-[29px] top-1 h-5 w-5 rounded-full bg-background border-2 border-primary/20 flex items-center justify-center">
                          <TimelineIcon type={entry.type} activityType={entry.meta?.activityType} />
                        </div>
                        <div
                          className={`rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 transition-colors ${entry.type === "deal" ? "cursor-pointer hover:bg-muted/50" : ""}`}
                          onClick={() => entry.type === "deal" && router.push(`/deals/${entry.id}`)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{entry.title}</p>
                              {entry.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{entry.subtitle}</p>}
                            </div>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {formatDate(entry.date, locale)}
                            </span>
                          </div>
                          {entry.meta?.stage && (
                            <Badge className={`mt-1.5 text-xs ${STAGE_COLORS[entry.meta.stage] || ""}`}>{entry.meta.stage}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calls */}
        <TabsContent value="calls">
          <Card className="border-none shadow-sm bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Call History</CardTitle>
            </CardHeader>
            <CardContent>
              {callsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : callHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No calls recorded</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-zinc-200 dark:border-zinc-700 text-left">
                      <th className="py-2 px-2 font-medium">Date</th>
                      <th className="py-2 px-2 font-medium">Direction</th>
                      <th className="py-2 px-2 font-medium">Duration</th>
                      <th className="py-2 px-2 font-medium">Status</th>
                      <th className="py-2 px-2 font-medium">Contact</th>
                    </tr></thead>
                    <tbody>
                      {callHistory.map((call: any) => (
                        <tr key={call.id} className="border-b border-zinc-200 dark:border-zinc-700 hover:bg-muted/50">
                          <td className="py-2 px-2 text-muted-foreground">{new Date(call.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="py-2 px-2"><Badge variant={call.direction === "outbound" ? "default" : "secondary"} className="text-xs">{call.direction}</Badge></td>
                          <td className="py-2 px-2">{call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, "0")}` : "—"}</td>
                          <td className="py-2 px-2"><span className={`text-xs font-medium ${call.status === "completed" ? "text-green-600" : call.status === "failed" || call.status === "no-answer" ? "text-red-500" : "text-muted-foreground"}`}>{call.status}</span></td>
                          <td className="py-2 px-2 text-muted-foreground">{call.contact?.fullName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pricing */}
        <TabsContent value="pricing" className="space-y-4">
          {pricingLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !pricingProfile ? (
            <Card className="border-none shadow-sm bg-card">
              <CardContent className="py-12 text-center text-muted-foreground">
                {t("pricingNoData")}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  [t("pricingCode"), pricingProfile.companyCode],
                  [t("pricingGroup"), pricingProfile.group?.name || "—"],
                  [t("pricingMonthly"), `${pricingProfile.monthlyTotal?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ₼`],
                  [t("pricingAnnual"), `${pricingProfile.annualTotal?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ₼`],
                ].map(([label, value]) => (
                  <Card key={label} className="border-none shadow-sm bg-card">
                    <CardContent className="pt-5 pb-5">
                      <div className="text-xs text-muted-foreground mb-1">{label}</div>
                      <div className="text-lg font-bold">{value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="border-none shadow-sm bg-card">
                <CardHeader className="pb-3"><CardTitle className="text-base">{t("pricingServices")}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(pricingProfile.categories || []).map((pc: any) => {
                    const isExpanded = expandedPricingCats.has(pc.id)
                    return (
                      <div key={pc.id} className="border border-zinc-200 dark:border-zinc-700 rounded-lg">
                        <button
                          onClick={() => {
                            const next = new Set(expandedPricingCats)
                            if (next.has(pc.id)) next.delete(pc.id); else next.add(pc.id)
                            setExpandedPricingCats(next)
                          }}
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/50"
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="text-sm font-medium">{pc.category?.name || "—"}</span>
                            <span className="text-xs text-muted-foreground">({pc.services?.length || 0} {t("pricingServices_count")})</span>
                          </div>
                          <span className="text-sm font-mono font-medium text-green-600">{pc.total?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ₼</span>
                        </button>
                        {isExpanded && pc.services?.length > 0 && (
                          <div className="px-3 pb-3">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-muted-foreground text-xs">
                                  <th className="text-left pb-1">{tc("service")}</th>
                                  <th className="text-center pb-1 w-24">{tc("unit")}</th>
                                  <th className="text-center pb-1 w-16">{tc("qty")}</th>
                                  <th className="text-right pb-1 w-24">{tc("price")}</th>
                                  <th className="text-right pb-1 w-24">{tc("total")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pc.services.map((svc: any) => (
                                  <tr key={svc.id} className="border-t border-zinc-200 dark:border-zinc-700">
                                    <td className="py-1.5">{svc.name}</td>
                                    <td className="py-1.5 text-center text-xs text-muted-foreground">{svc.unit}</td>
                                    <td className="py-1.5 text-center font-mono">{svc.qty}</td>
                                    <td className="py-1.5 text-right font-mono">{svc.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ₼</td>
                                    <td className="py-1.5 text-right font-mono font-medium">{svc.total?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ₼</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {(pricingProfile.categories || []).length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">{t("noCategories")}</div>
                  )}
                </CardContent>
              </Card>

              {pricingSales.length > 0 && (
                <Card className="border-none shadow-sm bg-card">
                  <CardHeader className="pb-3"><CardTitle className="text-base">{t("upsells")} ({pricingSales.length})</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-700 text-left text-muted-foreground">
                          <th className="pb-2 pr-4">{tc("type")}</th>
                          <th className="pb-2 pr-4">{tc("name")}</th>
                          <th className="pb-2 pr-4 text-right">{tc("total")}</th>
                          <th className="pb-2 pr-4">{tc("date")}</th>
                          <th className="pb-2">{tc("status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pricingSales.map((sale: any) => (
                          <tr key={sale.id} className="border-b border-zinc-200 dark:border-zinc-700 last:border-0">
                            <td className="py-2 pr-4">
                              <Badge className={sale.type === "recurring" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}>
                                {sale.type === "recurring" ? t("recurring") : t("oneTime")}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4">{sale.name}</td>
                            <td className="py-2 pr-4 text-right font-mono font-medium">{sale.total?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ₼</td>
                            <td className="py-2 pr-4 text-xs">{sale.effectiveDate ? formatDate(sale.effectiveDate, locale) : "—"}</td>
                            <td className="py-2">
                              <Badge variant="outline" className={sale.status === "active" ? "text-green-600 border-green-300" : "text-muted-foreground border-zinc-200 dark:border-zinc-700"}>
                                {sale.status === "active" ? t("saleActive") : sale.status === "cancelled" ? t("saleCancelled") : t("saleCompleted")}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <CompanyForm
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchCompany}
        orgId={orgId}
        initialData={{
          id: company.id, name: company.name, industry: company.industry || "",
          website: company.website || "", phone: company.phone || "", email: company.email || "",
          address: company.address || "", city: company.city || "", country: company.country || "",
          status: company.status, description: company.description || "",
        }}
      />
    </div>
  )
}
