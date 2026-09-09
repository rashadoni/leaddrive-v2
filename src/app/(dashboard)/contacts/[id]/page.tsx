"use client"

import { useRouter, useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ArrowLeft, Mail, Phone, Building2, Pencil, Calendar, MessageSquare, Plus, X, Loader2, Sparkles, Star, DollarSign, Activity, Tag, CheckCircle2, Clock, Zap } from "lucide-react"
import { EnrollInSequenceDialog } from "@/components/sequences/enroll-in-sequence-dialog"
import { ColorStatCard } from "@/components/color-stat-card"
import { InfoHint } from "@/components/info-hint"
import { InteractionTimeline } from "@/components/interaction-timeline"
import { useFieldPermissions } from "@/hooks/use-field-permissions"
import { ClickToCallButton } from "@/components/call-widget"
import { ContactWebActivity } from "@/components/contacts/contact-web-activity"
import { Textarea } from "@/components/ui/textarea"
import { useCategoryLabel, useDavinciReason } from "@/lib/status-labels"
import { toast } from "sonner"

interface Activity {
  id: string
  type: string
  subject?: string
  description?: string
  createdAt: string
}

interface Contact {
  id: string
  fullName: string
  email?: string
  phone?: string
  phones: string[]
  position?: string
  department?: string
  dateOfBirth?: string
  source?: string
  brand?: string
  category?: string
  tags: string[]
  isActive: boolean
  lastContactAt?: string
  companyId?: string
  company?: { id: string; name: string }
  activities?: Activity[]
}

const activityIcons: Record<string, string> = {
  email: "📧", call: "📞", meeting: "🤝", note: "📝", task: "✅",
}

// Lazy import engagement tab — same component as deal engagement but with contact API
function ContactEngagement({ contactId, orgId }: { contactId: string; orgId?: string }) {
  const tc = useTranslations("common")
  const [Comp, setComp] = useState<any>(null)
  useEffect(() => {
    import("@/components/deals/engagement-tab").then(m => setComp(() => m.EngagementTab))
  }, [])
  if (!Comp) return <div className="text-center py-8 text-sm text-muted-foreground">{tc("loading")}</div>
  // EngagementTab uses dealId but we pass contactId — we need contact-specific API
  // Instead, fetch directly and render inline
  return <ContactEngagementInner contactId={contactId} orgId={orgId} />
}

function ContactEngagementInner({ contactId, orgId }: { contactId: string; orgId?: string }) {
  const t = useTranslations("contacts")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const headers: any = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
    fetch(`/api/v1/contacts/${contactId}/engagement`, { headers })
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data) })
      .finally(() => setLoading(false))
  }, [contactId, orgId])

  if (loading) return <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
  if (!data) return <p className="text-sm text-muted-foreground text-center py-8">{t("noEngagementData")}</p>

  const items = [
    { label: t("statCalls"), value: data.activities.calls, emoji: "📞" },
    { label: t("statEmails"), value: data.activities.emails, emoji: "📧" },
    { label: t("statMeetings"), value: data.activities.meetings, emoji: "🤝" },
    { label: t("statNotes"), value: data.activities.notes, emoji: "📝" },
    { label: t("statTasks"), value: data.activities.tasks, emoji: "✅" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {items.map(i => (
          <Card key={i.label} className="border-none shadow-sm">
            <CardContent className="p-3 text-center">
              <p className="text-lg">{i.emoji}</p>
              <p className="text-xl font-bold">{i.value}</p>
              <p className="text-[10px] text-muted-foreground">{i.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {data.email.sent > 0 && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm font-semibold mb-2">{t("emailNurturing")}</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-xl font-bold text-primary">{data.email.sent}</p><p className="text-[10px] text-muted-foreground">{tc("sent")}</p></div>
              <div><p className="text-xl font-bold text-green-600">{data.email.openRate}%</p><p className="text-[10px] text-muted-foreground">{t("openRate")}</p></div>
              <div><p className="text-xl font-bold text-orange-600">{data.email.clickRate}%</p><p className="text-[10px] text-muted-foreground">{t("clickRate")}</p></div>
            </div>
          </CardContent>
        </Card>
      )}
      {data.lastActivity && (
        <p className="text-xs text-muted-foreground">
          {t("lastActivity")}: {data.lastActivity.type} — {data.lastActivity.subject} · {formatDate(data.lastActivity.date, locale)}
        </p>
      )}
    </div>
  )
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { HealthScoreBadge, type HealthScoreFactors } from "@/components/proactive/health-score-badge"
import { ActiveAlertsPanel } from "@/components/proactive/active-alerts-panel"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

export default function ContactDetailPage() {
  const t = useTranslations("contacts")
  const tc = useTranslations("common")
  const recReason = useDavinciReason()
  const productCategoryLabel = useCategoryLabel("products", ["service", "product", "addon", "consulting"])
  const contactCategoryLabel = useCategoryLabel("common", ["vip", "regular", "partner", "prospect", "inactive"])
  const router = useRouter()
  const params = useParams()
  const { data: session } = useSession()
  const [contact, setContact] = useState<Contact | null>(null)
  useAutoTour("contactDetail")
  const [loading, setLoading] = useState(true)
  const id = params.id as string
  const orgId = session?.user?.organizationId
  const { isVisible, isEditable } = useFieldPermissions("contact")

  // T9 slice-3: Health score lookup. Null when no score has been
  // computed yet (cron hasn't run for this contact).
  const [healthScore, setHealthScore] = useState<{ score: number; factors: HealthScoreFactors } | null>(null)
  useEffect(() => {
    if (!id) return
    const ac = new AbortController()
    fetch(`/api/v1/health-scores?entityType=contact&entityId=${id}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d.data?.score) {
          setHealthScore({ score: d.data.score.score, factors: d.data.score.factors })
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return // expected on unmount
        /* badge silently hidden on other errors */
      })
    return () => ac.abort()
  }, [id])

  // Da Vinci Recommendations
  const [recommendations, setRecommendations] = useState<any[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)

  // Call History
  const [callHistory, setCallHistory] = useState<any[]>([])
  const [callsLoading, setCallsLoading] = useState(false)

  // Add Activity dialog
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [showEnroll, setShowEnroll] = useState(false)
  const [savingActivity, setSavingActivity] = useState(false)
  const [activityForm, setActivityForm] = useState<{ type: string; subject: string; description: string }>({
    type: "note", subject: "", description: "",
  })

  const handleAddActivity = async () => {
    if (!activityForm.subject.trim()) {
      toast.error(t("activitySubjectRequired"))
      return
    }
    setSavingActivity(true)
    try {
      const res = await fetch("/api/v1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          type: activityForm.type,
          subject: activityForm.subject.trim(),
          description: activityForm.description.trim() || undefined,
          contactId: id,
          relatedType: "contact",
          relatedId: id,
        }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || `Failed (${res.status})`
        toast.error(msg)
        return
      }
      toast.success(t("activityAdded"))
      setShowAddActivity(false)
      setActivityForm({ type: "note", subject: "", description: "" })
      fetchContact()
    } catch {
      toast.error(t("activityNetworkError"))
    } finally {
      setSavingActivity(false)
    }
  }

  const loadCallHistory = async () => {
    setCallsLoading(true)
    try {
      const res = await fetch(`/api/v1/calls?contactId=${id}&limit=20`)
      const json = await res.json()
      if (json.success) setCallHistory(json.data || [])
    } catch { /* ignore */ }
    finally { setCallsLoading(false) }
  }

  // Edit dialog
  const [showEdit, setShowEdit] = useState(false)
  const [editData, setEditData] = useState({
    fullName: "", email: "", phone: "", position: "", department: "", dateOfBirth: "", source: "",
    brand: "", category: "",
    companyId: "", isActive: true, phones: [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])

  const fetchContact = async () => {
    try {
      const res = await fetch(`/api/v1/contacts/${id}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setContact(json.data)
      }
    } catch (err) { console.error(err) } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id && session) fetchContact()
  }, [id, session])

  const openEdit = () => {
    if (!contact) return
    setEditData({
      fullName: contact.fullName || "",
      email: contact.email || "",
      phone: contact.phone || "",
      position: contact.position || "",
      department: contact.department || "",
      dateOfBirth: contact.dateOfBirth ? contact.dateOfBirth.slice(0, 10) : "",
      source: contact.source || "",
      brand: contact.brand || "",
      category: contact.category || "",
      companyId: contact.companyId || "",
      isActive: contact.isActive,
      phones: contact.phones || [],
    })
    setShowEdit(true)
    // Fetch companies for dropdown
    fetch("/api/v1/companies?limit=500", {
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
      .then(r => r.json())
      .then(json => {
        const list = json.data?.companies || json.data || []
        setCompanies(Array.isArray(list) ? list.map((c: any) => ({ id: c.id, name: c.name })) : [])
      })
      .catch(() => {})
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/contacts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          fullName: editData.fullName,
          email: editData.email || undefined,
          phone: editData.phone || undefined,
          position: editData.position || undefined,
          department: editData.department || undefined,
          // send "" → null so the date can be CLEARED (|| undefined would skip it)
          dateOfBirth: editData.dateOfBirth || null,
          source: editData.source || undefined,
          brand: editData.brand || undefined,
          category: editData.category || undefined,
          companyId: editData.companyId || undefined,
          isActive: editData.isActive,
          phones: editData.phones.filter(p => p.trim()),
        }),
      })
      const json = await res.json()
      if (json.success) {
        setShowEdit(false)
        fetchContact()
      }
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const addPhone = () => setEditData(d => ({ ...d, phones: [...d.phones, ""] }))
  const removePhone = (idx: number) => setEditData(d => ({ ...d, phones: d.phones.filter((_, i) => i !== idx) }))
  const updatePhone = (idx: number, val: string) => setEditData(d => ({
    ...d, phones: d.phones.map((p, i) => i === idx ? val : p),
  }))

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-32 bg-muted rounded-lg animate-pulse" />
        <div className="h-96 bg-muted rounded-lg animate-pulse" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="icon" onClick={() => router.push("/contacts/list")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">{t("contactNotFound")}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const initials = contact.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/contacts/list")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xl">
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{contact.fullName} <TourReplayButton tourId="contactDetail" /><HelpButton slug="contact-detail" variant="label" /> <HealthScoreBadge score={healthScore?.score} factors={healthScore?.factors} size="sm" /></h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{contact.position}</span>
                {contact.company && (
                  <>
                    <span>{t("at")}</span>
                    <button
                      onClick={() => router.push(`/companies/${contact.company!.id}`)}
                      className="text-primary hover:underline"
                    >
                      {contact.company!.name}
                    </button>
                  </>
                )}
              </div>
              {isVisible("email") && contact.email && <p className="text-xs text-muted-foreground mt-0.5">{contact.email}</p>}
              {isVisible("phone") && contact.phone && <p className="text-xs text-muted-foreground">{contact.phone}</p>}
              {/* Additional phones */}
              {isVisible("phone") && contact.phones?.filter(p => p.trim()).length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  {contact.phones.filter(p => p.trim()).map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{p}</span>
                      <ClickToCallButton phone={p} contactId={contact.id} contactName={contact.fullName} />
                    </div>
                  ))}
                </div>
              )}
              {/* Communication action buttons */}
              <div className="flex items-center gap-2 mt-2" data-tour-id="contact-comm">
                {isVisible("phone") && contact.phone && (
                  <ClickToCallButton phone={contact.phone!} contactId={contact.id} contactName={contact.fullName} />
                )}
                {isVisible("email") && contact.email && (
                  <a href={`mailto:${contact.email}`} title={tc("email")} className="h-8 w-8 rounded-full bg-orange-500 hover:bg-orange-600 flex items-center justify-center transition-colors shadow-sm">
                    <Mail className="h-3.5 w-3.5 text-white" />
                  </a>
                )}
                {isVisible("phone") && contact.phone && (
                  <a href={`https://wa.me/${contact.phone.replace(/[^0-9]/g, "")}`} target="_blank" title="WhatsApp" className="h-8 w-8 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors shadow-sm">
                    <MessageSquare className="h-3.5 w-3.5 text-white" />
                  </a>
                )}
              </div>
              {isVisible("tags") && (
              <div className="mt-1 flex gap-1">
                {contact.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1.5" onClick={() => setShowEnroll(true)}>
            <Zap className="h-4 w-4" />
            {t("addToSequence")}
          </Button>
          <Button variant="outline" onClick={openEdit}>
            <Pencil className="h-4 w-4" />
            {tc("edit")}
          </Button>
        </div>
      </div>
      <EnrollInSequenceDialog
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        entityType="contact"
        entityIds={[id]}
        entityName={contact.fullName}
      />

      {/* KPI Cards */}
      {/* T9 slice-3: active alerts panel — renders nothing when no
          alerts exist, so no empty-state noise. */}
      <ActiveAlertsPanel entityType="contact" entityId={id} />
      <AdvisorRecordWidget entityType="contact" entityId={id} orgId={orgId ? String(orgId) : undefined} title="Advisor risk" />

      {(() => {
        const daysSince = contact.lastContactAt
          ? Math.floor((Date.now() - new Date(contact.lastContactAt).getTime()) / 86400000)
          : null
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tour-id="contact-kpi">
            <ColorStatCard
              label={t("lastContact")}
              value={daysSince !== null ? `${daysSince} ${tc("days")}` : "—"}
              icon={<Clock className="h-4 w-4" />}
            />
            <ColorStatCard
              label={tc("activities")}
              value={contact.activities?.length ?? 0}
              icon={<Activity className="h-4 w-4" />}
            />
            <ColorStatCard
              label={tc("tags")}
              value={contact.tags?.length ?? 0}
              icon={<Tag className="h-4 w-4" />}
            />
            <ColorStatCard
              label={tc("status")}
              value={contact.isActive ? tc("active") : tc("inactive")}
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
          </div>
        )
      })()}

      <Tabs defaultValue="activities">
        <TabsList>
          <TabsTrigger value="activities">{t("tabActivities")} ({contact.activities?.length || 0})</TabsTrigger>
          <TabsTrigger value="timeline">{tc("timelineTab")}</TabsTrigger>
          <TabsTrigger value="info">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="engagement">{t("tabEngagement")}</TabsTrigger>
          <TabsTrigger value="calls" onClick={() => { if (callHistory.length === 0 && !callsLoading) loadCallHistory() }}>{t("tabCalls")}</TabsTrigger>
          <TabsTrigger value="web">{t("tabWebActivity")}</TabsTrigger>
          <TabsTrigger value="recommendations" onClick={() => {
            if (recommendations.length === 0 && !loadingRecs) {
              setLoadingRecs(true)
              fetch("/api/v1/ai/recommend", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
                body: JSON.stringify({ contactId: id }),
              }).then(r => r.json()).then(json => {
                if (json.success) setRecommendations(json.data.recommendations || [])
              }).finally(() => setLoadingRecs(false))
            }
          }}>
            <Sparkles className="h-3 w-3 mr-1" /> {t("daVinciRecommendations")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activities">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-1.5">{t("activityTimeline")} <InfoHint text={t("activityTimelineHint")} size={12} /></CardTitle>
              <Button size="sm" onClick={() => setShowAddActivity(true)}>
                <MessageSquare className="h-4 w-4" />
                {t("addActivity")}
              </Button>
            </CardHeader>
            <CardContent>
              {contact.activities && contact.activities.length > 0 ? (
                <div className="relative space-y-4 pl-6 before:absolute before:left-[11px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border">
                  {contact.activities.map((activity) => (
                    <div key={activity.id} className="relative">
                      <div className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-zinc-200 dark:border-zinc-700 text-xs">
                        {activityIcons[activity.type] || "📌"}
                      </div>
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{activity.subject || t("activityFallback")}</span>
                          <span className="text-xs text-muted-foreground">
                            {activity.createdAt ? new Date(activity.createdAt).toLocaleDateString() : "—"}
                          </span>
                        </div>
                        {activity.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{activity.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">{t("noActivities")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-6">
              <InteractionTimeline entity="contact" id={id} orgId={orgId ? String(orgId) : undefined} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-muted-foreground">{tc("source")}:</span>
                  <span className="ml-2 font-medium">{contact.source || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tc("department")}:</span>
                  <span className="ml-2 font-medium">{contact.department || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tc("dateOfBirth")}:</span>
                  <span className="ml-2 font-medium">{contact.dateOfBirth ? contact.dateOfBirth.slice(0, 10) : "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tc("brand")}:</span>
                  <span className="ml-2 font-medium">{contact.brand || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tc("category")}:</span>
                  <span className="ml-2 font-medium">{contact.category ? contactCategoryLabel(contact.category) : "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{tc("status")}:</span>
                  <Badge className="ml-2">{contact.isActive ? tc("active") : tc("inactive")}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">{tc("company")}:</span>
                  <span className="ml-2 font-medium">{contact.company?.name || "—"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations">
          <Card>
            <CardContent className="pt-6">
              {loadingRecs ? (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("loadingRecommendations")}
                </div>
              ) : recommendations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t("noProductsForRecommendation")}</p>
                  <p className="text-xs">{t("addProductsHint")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recommendations.map((rec: any, i: number) => (
                    <div key={rec.productId} className="flex items-start gap-3 p-3 rounded-lg border hover:shadow-sm transition-shadow">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        i === 0 ? "bg-yellow-100 text-yellow-600" :
                        i === 1 ? "bg-blue-100 text-blue-600" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        <Star className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{rec.name}</span>
                          <Badge variant="outline" className="text-[10px]">{productCategoryLabel(rec.category)}</Badge>
                          <Badge className={`text-[10px] ${
                            rec.score > 70 ? "bg-green-100 text-green-700" :
                            rec.score > 50 ? "bg-blue-100 text-blue-700" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {t("matchScore", { score: rec.score })}
                          </Badge>
                        </div>
                        {rec.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rec.description}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">{recReason(rec.reasonKey, rec.company, rec.reason)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-1 text-sm font-bold">
                          <DollarSign className="h-3.5 w-3.5" />
                          {rec.price?.toLocaleString()} {rec.currency}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Engagement */}
        <TabsContent value="engagement">
          <ContactEngagement contactId={id} orgId={orgId ? String(orgId) : undefined} />
        </TabsContent>

        {/* C3 — website activity (C2-stitched web sessions); mounts on tab open */}
        <TabsContent value="web">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                {t("webActivityTitle")} <InfoHint text={t("webActivityHint")} size={12} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ContactWebActivity contactId={id} orgId={orgId ? String(orgId) : undefined} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Call History */}
        <TabsContent value="calls">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("callHistory")}</CardTitle>
            </CardHeader>
            <CardContent>
              {callsLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : callHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t("noCalls")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 px-2 font-medium">{tc("date")}</th>
                        <th className="py-2 px-2 font-medium">{tc("direction")}</th>
                        <th className="py-2 px-2 font-medium">{tc("duration")}</th>
                        <th className="py-2 px-2 font-medium">{tc("status")}</th>
                        <th className="py-2 px-2 font-medium">{tc("number")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {callHistory.map((call: any) => (
                        <tr key={call.id} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 text-muted-foreground">
                            {new Date(call.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="py-2 px-2">
                            <Badge variant={call.direction === "outbound" ? "default" : "secondary"} className="text-xs">
                              {call.direction === "outbound" ? t("outbound") : t("inbound")}
                            </Badge>
                          </td>
                          <td className="py-2 px-2">
                            {call.duration ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, "0")}` : "—"}
                          </td>
                          <td className="py-2 px-2">
                            <span className={`text-xs font-medium ${call.status === "completed" ? "text-green-600" : call.status === "failed" || call.status === "no-answer" ? "text-red-500" : "text-muted-foreground"}`}>
                              {call.status}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">{call.direction === "outbound" ? call.toNumber : call.fromNumber}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Edit Dialog ── */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogHeader>
          <DialogTitle>{tc("edit")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-sm font-medium">{tc("fullName")} *</Label>
              <Input value={editData.fullName} onChange={e => setEditData(d => ({ ...d, fullName: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("email")}</Label>
              <Input value={editData.email} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} disabled={!isEditable("email")} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("phone")}</Label>
              <Input value={editData.phone} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} disabled={!isEditable("phone")} placeholder="+994..." className="mt-1" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-sm font-medium">{tc("phone")}</Label>
                <Button type="button" size="sm" variant="outline" onClick={addPhone} className="h-7 text-xs gap-1">
                  <Plus className="h-3 w-3" /> {tc("create")}
                </Button>
              </div>
              {editData.phones.map((p, i) => (
                <div key={i} className="flex items-center gap-2 mt-1.5">
                  <Input value={p} onChange={e => updatePhone(i, e.target.value)} placeholder="+994..." className="flex-1" />
                  <Button type="button" size="icon" variant="ghost" onClick={() => removePhone(i)} className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("position")}</Label>
              <Input value={editData.position} onChange={e => setEditData(d => ({ ...d, position: e.target.value }))} disabled={!isEditable("position")} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("department")}</Label>
              <Input value={editData.department} onChange={e => setEditData(d => ({ ...d, department: e.target.value }))} disabled={!isEditable("department")} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("dateOfBirth")}</Label>
              <Input type="date" value={editData.dateOfBirth} onChange={e => setEditData(d => ({ ...d, dateOfBirth: e.target.value }))} disabled={!isEditable("dateOfBirth")} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("company")}</Label>
              <Select value={editData.companyId} onChange={e => setEditData(d => ({ ...d, companyId: e.target.value }))} className="mt-1">
                <option value="">{tc("noCompany")}</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("source")}</Label>
              <Input value={editData.source} onChange={e => setEditData(d => ({ ...d, source: e.target.value }))} disabled={!isEditable("source")} className="mt-1" />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("brand")}</Label>
              <Input value={editData.brand} onChange={e => setEditData(d => ({ ...d, brand: e.target.value }))} className="mt-1" placeholder={tc("brand")} />
            </div>
            <div>
              <Label className="text-sm font-medium">{tc("category")}</Label>
              <Select value={editData.category} onChange={e => setEditData(d => ({ ...d, category: e.target.value }))} className="mt-1">
                <option value="">—</option>
                <option value="vip">{tc("categoryVip")}</option>
                <option value="regular">{tc("categoryRegular")}</option>
                <option value="partner">{tc("categoryPartner")}</option>
                <option value="prospect">{tc("categoryProspect")}</option>
                <option value="inactive">{tc("categoryInactive")}</option>
              </Select>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowEdit(false)}>{tc("cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || !editData.fullName.trim()} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
            {saving ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Add Activity Dialog */}
      <Dialog open={showAddActivity} onOpenChange={setShowAddActivity}>
        <DialogHeader><DialogTitle>{t("addActivity")}</DialogTitle></DialogHeader>
        <DialogContent>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="activity-type">{tc("type")}</Label>
              <Select
                id="activity-type"
                value={activityForm.type}
                onChange={(e) => setActivityForm(f => ({ ...f, type: e.target.value }))}
              >
                <option value="note">📝 {t("note")}</option>
                <option value="call">📞 {t("call")}</option>
                <option value="email">📧 {tc("email")}</option>
                <option value="meeting">🤝 {t("meeting")}</option>
                <option value="task">✅ {t("task")}</option>
                <option value="other">📌 {tc("other")}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="activity-subject">{t("activitySubject")} <span className="text-red-500">*</span></Label>
              <Input
                id="activity-subject"
                value={activityForm.subject}
                onChange={(e) => setActivityForm(f => ({ ...f, subject: e.target.value }))}
                placeholder={t("activitySubjectPlaceholder")}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="activity-description">{tc("description") || "Description"}</Label>
              <Textarea
                id="activity-description"
                value={activityForm.description}
                onChange={(e) => setActivityForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder={t("activityDescriptionPlaceholder")}
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddActivity(false)} disabled={savingActivity}>{tc("cancel")}</Button>
          <Button onClick={handleAddActivity} disabled={savingActivity || !activityForm.subject.trim()} className="gap-1.5">
            {savingActivity ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {savingActivity ? tc("saving") : (tc("create") || "Create")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
