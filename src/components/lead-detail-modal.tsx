"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogHeader, DialogTitle, DialogContent } from "@/components/ui/dialog"
import { FileText, Trash2, Ban, Plus, Pencil, Ticket, Loader2 } from "lucide-react"
import { cn, fmtAmount } from "@/lib/utils"
import { getCurrencySymbol } from "@/lib/constants"
import { useTranslations } from "next-intl"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { toast } from "sonner"

interface LeadCompany {
  id: string
  name: string
  website?: string
  industry?: string
  email?: string
  phone?: string
  description?: string
  category: string
  leadStatus: string
  leadScore: number
  leadTemperature?: string
  userCount: number
  annualRevenue?: number
  createdAt?: string
  contacts?: Array<{ id: string; fullName: string; email?: string; phone?: string; position?: string }>
  deals?: Array<{ id: string; title: string; stage: string; valueAmount?: number }>
  _count?: { contacts: number; deals: number }
}

interface LeadDetailModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  company: LeadCompany | null
  orgId?: string
  onSaved?: () => void
}

// statusLabels defined inside component with translations

const statusColors: Record<string, string> = {
  new: "bg-blue-500", contacted: "bg-yellow-500", qualified: "bg-purple-500",
  converted: "bg-green-500", rejected: "bg-muted-foreground/40", cancelled: "bg-red-500",
}

function getGrade(score: number): { letter: string; color: string } {
  const s = Math.min(100, Math.max(0, score))
  if (s >= 80) return { letter: "A", color: "bg-emerald-500 text-white" }
  if (s >= 60) return { letter: "B", color: "bg-blue-500 text-white" }
  if (s >= 40) return { letter: "C", color: "bg-amber-500 text-white" }
  if (s >= 20) return { letter: "D", color: "bg-orange-500 text-white" }
  return { letter: "F", color: "bg-red-500 text-white" }
}

function getTemperature(score: number): { label: string; color: string } {
  const s = Math.min(100, Math.max(0, score))
  if (s >= 70) return { label: "HOT", color: "text-emerald-600" }
  if (s >= 40) return { label: "WARM", color: "text-amber-600" }
  return { label: "COLD", color: "text-blue-500" }
}

export function LeadDetailModal({ open, onOpenChange, company, orgId, onSaved }: LeadDetailModalProps) {
  const router = useRouter()
  const t = useTranslations("leads")

  const statusLabels: Record<string, string> = {
    new: t("ldmStatusNew"), contacted: t("ldmStatusContacted"), qualified: t("ldmStatusQualified"),
    converted: t("ldmStatusConverted"), rejected: t("ldmStatusRejected"), cancelled: t("ldmStatusCancelled"),
  }

  const [activeTab, setActiveTab] = useState("details")

  // Activity state
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [activityType, setActivityType] = useState("note")
  const [activitySubject, setActivitySubject] = useState("")
  const [activityDesc, setActivityDesc] = useState("")
  const [activitySaving, setActivitySaving] = useState(false)

  // About state
  const [editingAbout, setEditingAbout] = useState(false)
  const [aboutText, setAboutText] = useState("")

  // Activities & Tickets
  const [activities, setActivities] = useState<any[]>([])
  const [tickets, setTickets] = useState<any[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)

  // Full company data loaded from API
  const [fullData, setFullData] = useState<any>(null)

  useEffect(() => {
    if (open && company) {
      setActiveTab("details")
      setAboutText(company.description || "")
      setFullData(null)
      setTickets([])
      // Load full company data with contacts and deals
      fetch(`/api/v1/companies/${company.id}`, {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      }).then(r => r.json()).then(json => {
        if (json.success && json.data) {
          setFullData(json.data)
          if (json.data.description) setAboutText(json.data.description)
        }
      }).catch(() => {})
    }
  }, [open, company])

  if (!company) return null

  // Universal field update + reload
  const updateField = async (fields: Record<string, any>) => {
    await fetch(`/api/v1/companies/${company.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
      body: JSON.stringify(fields),
    })
    // Reload full data
    const res = await fetch(`/api/v1/companies/${company.id}`, { headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string> })
    const json = await res.json()
    if (json.success && json.data) setFullData(json.data)
    onSaved?.()
  }

  const saveAbout = async () => {
    await updateField({ description: aboutText })
    setEditingAbout(false)
  }

  const changeStatus = async (newStatus: string) => {
    await updateField({ leadStatus: newStatus, ...(newStatus === "converted" ? { category: "client" } : {}) })
  }

  const editField = (label: string, field: string, currentValue: any, isNumber = false) => {
    const val = prompt(`${label}:`, String(currentValue || ""))
    if (val === null) return
    updateField({ [field]: isNumber ? (parseInt(val) || 0) : val })
  }

  const loadActivities = async () => {
    try {
      const res = await fetch(`/api/v1/activities?companyId=${company.id}`, {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setActivities(json.data.activities || [])
    } catch (err) { console.error(err) }
  }

  const saveActivity = async () => {
    if (!activitySubject.trim()) return
    setActivitySaving(true)
    try {
      const res = await fetch("/api/v1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify({
          type: activityType,
          subject: activitySubject,
          description: activityDesc,
          companyId: company.id,
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setShowActivityForm(false)
        setActivitySubject("")
        setActivityDesc("")
        loadActivities()
      } else {
        toast.error(t("ldmSaveError") + ": " + (json.error || ""))
      }
    } catch (e) {
      toast.error(t("ldmNetworkError"))
    } finally { setActivitySaving(false) }
  }

  const loadTickets = async () => {
    setTicketsLoading(true)
    try {
      const res = await fetch(`/api/v1/tickets?companyId=${company.id}`, {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setTickets(json.data?.tickets || [])
    } catch (err) { console.error(err) } finally { setTicketsLoading(false) }
  }

  const currentScore = fullData?.leadScore ?? company.leadScore ?? 0
  const temp = fullData?.leadTemperature || company.leadTemperature || "cold"
  const grade = getGrade(currentScore)

  const tabs = [
    { id: "details", label: t("modalDetails") },
    { id: "contacts", label: t("modalContacts") },
    { id: "deals", label: t("modalDeals") },
    { id: "activity", label: t("modalActivity") },
    { id: "contracts", label: t("modalContracts") },
    { id: "tickets", label: t("modalTickets") },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xl font-bold">{company.name}</span>
              <div className="flex items-center gap-2 mt-1">
                {company.website && <span className="text-sm text-primary">{company.website}</span>}
                <Badge variant="outline">{statusLabels[company.leadStatus] || company.leadStatus}</Badge>
              </div>
            </div>
          </div>
        </DialogTitle>
      </DialogHeader>
      <DialogContent className="max-h-[70vh] overflow-y-auto">
        {/* Tabs */}
        <div className="flex gap-1 border-b mb-4 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); if (tab.id === "activity" && !activities.length) loadActivities(); if (tab.id === "tickets" && !tickets.length) loadTickets() }}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Details */}
        {activeTab === "details" && (
          <div className="space-y-4">
            {/* Compact funnel status pills */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5">{t("ldmFunnelStatus")}</p>
              <div className="flex flex-wrap gap-1">
                {(["new", "contacted", "qualified", "converted", "rejected", "cancelled"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => changeStatus(s)}
                    className={`text-[10px] py-1 px-2.5 rounded-full border border-zinc-200 dark:border-zinc-700 transition-all ${
                      (fullData?.leadStatus || company.leadStatus) === s
                        ? `${statusColors[s]} text-white border-transparent font-medium`
                        : "bg-background hover:bg-muted border-zinc-200 dark:border-zinc-700 text-muted-foreground"
                    }`}
                  >
                    {statusLabels[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Sectioned info — hide empty fields */}
            {(() => {
              const d = fullData || company
              const email = d?.email || company.email
              const phone = d?.phone || company.phone
              const website = d?.website || company.website
              const industry = d?.industry || company.industry
              const revenue = d?.annualRevenue || company.annualRevenue
              const users = d?.userCount ?? company.userCount
              const created = d?.createdAt || company.createdAt
              const sla = (d as any)?.slaPolicy
              const score = Math.min(100, Math.max(0, d?.leadScore ?? company.leadScore ?? 0))
              const temp = getTemperature(score)
              const hasContact = email || phone || website
              const hasBusiness = industry || revenue || users

              return (
                <div className="space-y-3">
                  {/* Score bar */}
                  <div className="flex items-center justify-between p-2.5 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 group" onClick={() => editField("Score", "leadScore", score, true)}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${grade.color}`}>{grade.letter}</span>
                      <span className={`text-sm font-semibold ${temp.color}`}>{temp.label}</span>
                      <span className="text-xs text-muted-foreground">{score}/100</span>
                      <Pencil className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </div>
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${score}%` }} />
                    </div>
                  </div>

                  {/* Contact Info — only filled fields */}
                  {hasContact && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("ldmContactInfo") || "Contact"}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {email && (
                          <div className="p-2 bg-muted/30 rounded cursor-pointer hover:bg-muted/50 group" onClick={() => editField(t("ldmEmail"), "email", email)}>
                            <span className="text-[10px] text-muted-foreground">{t("ldmEmail")} <Pencil className="h-2 w-2 inline opacity-0 group-hover:opacity-100" /></span>
                            <p className="text-xs truncate">{email}</p>
                          </div>
                        )}
                        {phone && (
                          <div className="p-2 bg-muted/30 rounded cursor-pointer hover:bg-muted/50 group" onClick={() => editField(t("ldmPhone"), "phone", phone)}>
                            <span className="text-[10px] text-muted-foreground">{t("ldmPhone")} <Pencil className="h-2 w-2 inline opacity-0 group-hover:opacity-100" /></span>
                            <p className="text-xs">{phone}</p>
                          </div>
                        )}
                        {website && (
                          <div className="p-2 bg-muted/30 rounded cursor-pointer hover:bg-muted/50 group col-span-2" onClick={() => editField(t("ldmWebsite"), "website", website)}>
                            <span className="text-[10px] text-muted-foreground">{t("ldmWebsite")} <Pencil className="h-2 w-2 inline opacity-0 group-hover:opacity-100" /></span>
                            <p className="text-xs truncate">{website}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Business Info — only filled fields */}
                  {hasBusiness && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("ldmBusinessInfo") || "Business"}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {industry && (
                          <div className="p-2 bg-muted/30 rounded cursor-pointer hover:bg-muted/50 group" onClick={() => editField(t("ldmIndustry"), "industry", industry)}>
                            <span className="text-[10px] text-muted-foreground">{t("ldmIndustry")} <Pencil className="h-2 w-2 inline opacity-0 group-hover:opacity-100" /></span>
                            <p className="text-xs">{industry}</p>
                          </div>
                        )}
                        {revenue && (
                          <div className="p-2 bg-muted/30 rounded cursor-pointer hover:bg-muted/50 group" onClick={() => editField(t("ldmEstimatedValue"), "annualRevenue", revenue, true)}>
                            <span className="text-[10px] text-muted-foreground">{t("ldmEstimatedValue")} <Pencil className="h-2 w-2 inline opacity-0 group-hover:opacity-100" /></span>
                            <p className="text-xs">{fmtAmount(revenue)}</p>
                          </div>
                        )}
                        {(users != null && users > 0) && (
                          <div className="p-2 bg-muted/30 rounded cursor-pointer hover:bg-muted/50 group" onClick={() => editField(t("ldmUsers"), "userCount", users, true)}>
                            <span className="text-[10px] text-muted-foreground">{t("ldmUsers")} <Pencil className="h-2 w-2 inline opacity-0 group-hover:opacity-100" /></span>
                            <p className="text-xs">{users}</p>
                          </div>
                        )}
                        {sla && (
                          <div className="p-2 bg-muted/30 rounded">
                            <span className="text-[10px] text-muted-foreground">SLA</span>
                            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">{sla.name}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Metrics row */}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t("ldmMetrics") || "Metrics"}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {created && (
                        <div className="p-2 bg-muted/30 rounded">
                          <span className="text-[10px] text-muted-foreground">{t("ldmCreated")}</span>
                          <p className="text-xs">{new Date(created).toLocaleDateString()}</p>
                        </div>
                      )}
                      {created && (
                        <div className="p-2 bg-muted/30 rounded">
                          <span className="text-[10px] text-muted-foreground">{t("ldmDaysInBase")}</span>
                          <p className="text-xs">{Math.floor((Date.now() - new Date(created).getTime()) / 86400000)} {t("ldmDays")}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Add missing info link */}
                  {!hasContact && (
                    <button onClick={() => editField(t("ldmEmail"), "email", "")} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                      <Plus className="h-3 w-3" /> {t("ldmAddContactInfo") || "Add contact info"}
                    </button>
                  )}
                </div>
              )
            })()}

            {/* FIX #2: About section */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-medium text-sm">{t("ldmAboutCompany")}</h4>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditingAbout(!editingAbout)}>
                  <Pencil className="h-3 w-3 mr-1" /> {editingAbout ? t("ldmEditCancel") : t("ldmEdit")}
                </Button>
              </div>
              {editingAbout ? (
                <div className="space-y-2">
                  <Textarea value={aboutText} onChange={e => setAboutText(e.target.value)} rows={3} />
                  <Button size="sm" onClick={saveAbout}>{t("ldmSave")}</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground bg-muted/30 p-2 rounded min-h-[40px]">
                  {company.description || aboutText || t("ldmNoDescription")}
                </p>
              )}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center p-2 bg-muted/30 rounded">
                <p className="text-lg font-bold">{fullData?.contacts?.length || company._count?.contacts || 0}</p>
                <p className="text-[10px] text-muted-foreground">{t("ldmKeyPeople")}</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded">
                <p className="text-lg font-bold">{(fullData?.deals || company.deals)?.length || 0}</p>
                <p className="text-[10px] text-muted-foreground">{t("ldmDeals")}</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded">
                <p className="text-lg font-bold">{fullData?.contracts?.length || 0}</p>
                <p className="text-[10px] text-muted-foreground">{t("ldmContracts")}</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded">
                <p className={cn("text-lg font-bold", grade.color.replace("bg-", "text-").replace(" text-white", ""))}>{grade.letter}</p>
                <p className="text-[10px] text-muted-foreground">{currentScore}/100</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab: Contacts */}
        {activeTab === "contacts" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm">{t("ldmKeyPeople")} ({fullData?.contacts?.length || company._count?.contacts || 0})</h4>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => { onOpenChange(false); router.push(`/contacts?new=1&companyId=${company.id}`) }}>
                <Plus className="h-3 w-3" /> {t("ldmAdd")}
              </Button>
            </div>
            {(fullData?.contacts || company.contacts) && (fullData?.contacts || company.contacts).length > 0 ? (
              <div className="space-y-1.5">
                {(fullData?.contacts || company.contacts).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                          {c.fullName?.charAt(0) || "?"}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{c.fullName}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{c.position || ""} {c.email ? `· ${c.email}` : ""}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-0.5 ml-2 flex-shrink-0">
                      <button onClick={() => { onOpenChange(false); router.push(`/contacts/${c.id}`) }} className="p-1 rounded hover:bg-muted" title={t("ldmEdit")}>
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button onClick={async () => {
                        if (!confirm(t("ldmConfirmDeleteContact", { name: c.fullName }))) return
                        await fetch(`/api/v1/contacts/${c.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string> })
                        const res = await fetch(`/api/v1/companies/${company.id}`, { headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string> })
                        const json = await res.json()
                        if (json.success) setFullData(json.data)
                        onSaved?.()
                      }} className="p-1 rounded hover:bg-red-50" title={t("ldmDelete")}>
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground py-4 text-center">{t("ldmNoContacts")}</p>}
          </div>
        )}

        {/* Tab: Deals */}
        {activeTab === "deals" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm">{t("ldmDeals")} ({(fullData?.deals || company.deals)?.length || 0})</h4>
              {(fullData?.deals || company.deals)?.length > 0 && (
                <p className="text-xs font-medium text-primary">
                  Pipeline: {fmtAmount((fullData?.deals || company.deals).reduce((sum: number, d: any) => sum + (d.valueAmount || 0), 0))}
                </p>
              )}
            </div>
            {(fullData?.deals || company.deals) && (fullData?.deals || company.deals).length > 0 ? (
              (fullData?.deals || company.deals).map((d: any) => (
                <div key={d.id} className="flex justify-between items-center text-xs p-2.5 bg-muted/30 rounded border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                  onClick={() => { onOpenChange(false); router.push(`/deals/${d.id}`) }}>
                  <span className="font-medium">{d.name || d.title}</span>
                  <div className="flex gap-1.5 items-center">
                    {d.valueAmount ? <span className="font-medium">{fmtAmount(d.valueAmount)}</span> : null}
                    <Badge variant="outline" className="text-[10px]">{d.stage}</Badge>
                  </div>
                </div>
              ))
            ) : <p className="text-xs text-muted-foreground py-4 text-center">{t("ldmNoDeals")}</p>}
          </div>
        )}

        {/* Tab: Activity */}
        {activeTab === "activity" && (
          <div className="space-y-4">
            <Button size="sm" className="gap-1" onClick={() => { setShowActivityForm(!showActivityForm); if (!activities.length) loadActivities() }}>
              <Plus className="h-3 w-3" /> {t("ldmRecord")}
            </Button>

            {showActivityForm && (
              <Card>
                <CardContent className="pt-3 pb-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">{t("ldmActType")}</Label>
                      <Select value={activityType} onChange={e => setActivityType(e.target.value)}>
                        <option value="note">📝 {t("ldmActNote")}</option>
                        <option value="call">📞 {t("ldmActCall")}</option>
                        <option value="email">📧 {t("ldmActEmail")}</option>
                        <option value="meeting">🤝 {t("ldmActMeeting")}</option>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{t("ldmActSubject")}</Label>
                      <Input value={activitySubject} onChange={e => setActivitySubject(e.target.value)} placeholder={t("ldmActSubjectPlaceholder")} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">{t("ldmActDescription")}</Label>
                    <Textarea value={activityDesc} onChange={e => setActivityDesc(e.target.value)} rows={2} placeholder={t("ldmActDetailsPlaceholder")} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveActivity} disabled={activitySaving || !activitySubject.trim()}>
                      {activitySaving ? t("ldmActSaving") : t("ldmSave")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowActivityForm(false)}>{t("ldmEditCancel")}</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Activities list */}
            {activities.length > 0 ? (
              <div className="space-y-2">
                {activities.map((a: any) => (
                  <div key={a.id} className="flex items-start gap-2 p-2 bg-muted/30 rounded text-xs">
                    <span>{a.type === "call" ? "📞" : a.type === "email" ? "📧" : a.type === "meeting" ? "🤝" : "📝"}</span>
                    <div className="flex-1">
                      <p className="font-medium">{a.subject}</p>
                      {a.description && <p className="text-muted-foreground">{a.description}</p>}
                      <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(a.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : !showActivityForm ? (
              <div className="text-center py-6 text-muted-foreground">
                <p className="text-sm">{t("ldmNoActivities")}</p>
                <p className="text-xs mt-1">{t("ldmNoActivitiesHint")}</p>
                <Button size="sm" variant="link" className="mt-2" onClick={loadActivities}>{t("ldmRefresh")}</Button>
              </div>
            ) : null}
          </div>
        )}

        {/* Tab: Contracts */}
        {activeTab === "contracts" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm">{t("ldmContracts")} ({fullData?.contracts?.length || 0})</h4>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => { onOpenChange(false); router.push(`/contracts?new=1&companyId=${company.id}`) }}>
                <Plus className="h-3 w-3" /> {t("ldmAdd")}
              </Button>
            </div>
            {fullData?.contracts && fullData.contracts.length > 0 ? (
              fullData.contracts.map((c: any) => (
                <div key={c.id} className="flex justify-between items-center text-xs p-2.5 bg-muted/30 rounded border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                  onClick={() => { onOpenChange(false); router.push(`/contracts/${c.id}`) }}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{c.title || c.contractNumber || "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{c.startDate ? new Date(c.startDate).toLocaleDateString() : ""} {c.endDate ? `— ${new Date(c.endDate).toLocaleDateString()}` : ""}</p>
                  </div>
                  <div className="flex gap-1.5 items-center ml-2">
                    {c.totalValue ? <span className="font-medium">{fmtAmount(c.totalValue)}</span> : null}
                    <Badge variant={c.status === "active" ? "default" : "outline"} className="text-[10px]">{c.status || "draft"}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t("ldmNoContracts")}</p>
                <p className="text-xs mt-1">{t("ldmNoContractsHint")}</p>
              </div>
            )}
          </div>
        )}

        {/* Tab: Tickets */}
        {activeTab === "tickets" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm">{t("ldmTickets")} ({tickets.length})</h4>
              <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => { onOpenChange(false); router.push(`/tickets?new=1&companyId=${company.id}`) }}>
                <Plus className="h-3 w-3" /> {t("ldmAdd")}
              </Button>
            </div>
            {ticketsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : tickets.length > 0 ? (
              tickets.map((tk: any) => (
                <div key={tk.id} className="flex justify-between items-center text-xs p-2.5 bg-muted/30 rounded border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                  onClick={() => { onOpenChange(false); router.push(`/tickets/${tk.id}`) }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-mono">{tk.ticketNumber}</span>
                      <p className="font-medium truncate">{tk.subject}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {tk.createdAt ? new Date(tk.createdAt).toLocaleDateString() : ""}
                      {tk.assigneeName ? ` · ${tk.assigneeName}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1.5 items-center ml-2">
                    <Badge variant={tk.priority === "critical" ? "destructive" : tk.priority === "high" ? "default" : "outline"} className="text-[10px]">
                      {tk.priority || "medium"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{tk.status || "new"}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Ticket className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t("ldmNoTickets")}</p>
                <p className="text-xs mt-1">{t("ldmNoTicketsHint")}</p>
              </div>
            )}
          </div>
        )}

        {/* Action buttons — FIX #7: contracts filtered by company */}
        <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" size="sm" className="gap-1 text-green-700 border-green-200 hover:bg-green-50"
            onClick={() => { onOpenChange(false); router.push(`/contracts?search=${encodeURIComponent(company.name)}`) }}>
            <FileText className="h-3 w-3" /> {t("ldmContractsBtn")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
            onClick={() => { onOpenChange(false); router.push(`/companies/${company.id}`) }}>
            <Pencil className="h-3 w-3" /> {t("ldmEditBtn")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-orange-700 border-orange-200 hover:bg-orange-50"
            onClick={async () => {
              if (!confirm(t("ldmConfirmDeactivate", { name: company.name }))) return
              await changeStatus("cancelled")
              onOpenChange(false)
            }}>
            <Ban className="h-3 w-3" /> {t("ldmDeactivate")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-red-700 border-red-200 hover:bg-red-50"
            onClick={async () => {
              if (!confirm(t("ldmConfirmDelete", { name: company.name }))) return
              await fetch(`/api/v1/companies/${company.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string> })
              onOpenChange(false)
              onSaved?.()
            }}>
            <Trash2 className="h-3 w-3" /> {t("ldmDelete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
