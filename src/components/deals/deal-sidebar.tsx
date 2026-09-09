"use client"

import { useState, useEffect } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AccordionItem } from "@/components/ui/accordion"
import { MotionCard } from "@/components/ui/motion"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  Mail, MessageSquare, Building2, User, Calendar, DollarSign,
  Clock, Target, FileText, Receipt, Users, Swords, Package, Plus, X,
  Pencil, Loader2, Check, Search,
} from "lucide-react"
import { fmtAmount } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { getCurrencySymbol } from "@/lib/constants"
import { useFieldPermissions } from "@/hooks/use-field-permissions"
import { ClickToCallButton } from "@/components/call-widget"

interface Deal {
  id: string
  name: string
  stage: string
  valueAmount: number
  currency: string
  probability: number
  confidenceLevel: number
  assignedTo: string | null
  notes: string | null
  expectedClose: string | null
  stageChangedAt: string | null
  createdAt: string
  updatedAt: string
  lostReason: string | null
  tags: string[]
  contactId: string | null
  customerNeed: string | null
  salesChannel: string | null
  company: { id: string; name: string } | null
  campaign: { id: string; name: string } | null
  contact: { id: string; fullName: string; position: string | null; email: string | null; phone: string | null; avatar: string | null } | null
  teamMembers: Array<{
    id: string; userId: string; role: string
    user: { id: string; name: string | null; email: string; avatar: string | null; role: string | null }
  }>
  contactRoles: Array<{
    id: string; contactId: string; role: string; influence: string; loyalty: string; isPrimary: boolean
    cashbackType?: string | null; cashbackValue?: number | null
    contact: { id: string; fullName: string; position: string | null; email: string | null; phone: string | null }
  }>
}

interface DealSidebarProps {
  deal: Deal
  orgId?: string
  offersCount: number
  invoicesCount: number
  onEdit: () => void
  fetchDeal: () => void
}

// ── Inline Add Team Member Form ──
function AddTeamMemberForm({ dealId, orgId, onDone }: { dealId: string; orgId?: string; onDone: () => void }) {
  const tc = useTranslations("common")
  const [users, setUsers] = useState<Array<{ id: string; name: string | null; email: string }>>([])
  const [search, setSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [role, setRole] = useState("member")
  const [saving, setSaving] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(true)

  useEffect(() => {
    fetch("/api/v1/users?limit=100", {
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
    })
      .then(r => r.json())
      .then(j => {
        if (j.success) setUsers(j.data?.users || j.data || [])
      })
      .catch(() => {})
      .finally(() => setLoadingUsers(false))
  }, [orgId])

  const filteredUsers = users.filter(u => {
    if (!search) return true
    const s = search.toLowerCase()
    return (u.name || "").toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
  })

  const [error, setError] = useState("")

  const handleSave = async () => {
    if (!selectedUserId) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify({ userId: selectedUserId, role }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || `Error ${res.status}`); return }
      onDone()
    } catch { setError(tc("errorNetwork")) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-2 pt-1">
      {loadingUsers ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> {tc("loading")}
        </div>
      ) : (
        <>
          <Input
            placeholder={tc("search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="max-h-28 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y">
            {filteredUsers.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">{tc("noResults")}</p>
            ) : (
              filteredUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors ${selectedUserId === u.id ? "bg-primary/10" : ""}`}
                >
                  <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold flex-shrink-0">
                    {(u.name || u.email || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs truncate block">{u.name || u.email}</span>
                  </div>
                  {selectedUserId === u.id && <Check className="h-3 w-3 text-primary flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
          <Select value={role} onChange={e => setRole(e.target.value)} className="h-7 text-xs">
            <option value="member">{tc("member")}</option>
            <option value="owner">{tc("owner")}</option>
            <option value="support">{tc("support")}</option>
          </Select>
          <div className="flex gap-1.5">
            {error && <p className="text-xs text-red-500 col-span-full">{error}</p>}
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave} disabled={!selectedUserId || saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : tc("save")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Inline Add Contact Role Form ──
function AddContactRoleForm({ dealId, orgId, onDone }: { dealId: string; orgId?: string; onDone: () => void }) {
  const tc = useTranslations("common")
  const [contacts, setContacts] = useState<Array<{ id: string; fullName: string; position: string | null; email: string | null }>>([])
  const [search, setSearch] = useState("")
  const [selectedContactId, setSelectedContactId] = useState("")
  const [role, setRole] = useState("contact_person")
  const [influence, setInfluence] = useState("Medium")
  const [loyalty, setLoyalty] = useState("Neutral")
  const [cashbackType, setCashbackType] = useState<string>("")
  const [cashbackValue, setCashbackValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadingContacts, setLoadingContacts] = useState(true)

  useEffect(() => {
    fetch("/api/v1/contacts?limit=200", {
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
    })
      .then(r => r.json())
      .then(j => {
        if (j.success) setContacts(j.data?.contacts || j.data || [])
      })
      .catch(() => {})
      .finally(() => setLoadingContacts(false))
  }, [orgId])

  const filteredContacts = contacts.filter(c => {
    if (!search) return true
    const s = search.toLowerCase()
    return c.fullName.toLowerCase().includes(s) || (c.email || "").toLowerCase().includes(s)
  })

  const [error, setError] = useState("")

  const handleSave = async () => {
    if (!selectedContactId) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/contact-roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify({
          contactId: selectedContactId,
          role,
          influence,
          loyalty,
          isPrimary: false,
          cashbackType: cashbackType || null,
          cashbackValue: cashbackValue ? Number(cashbackValue) : null,
        }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || `Error ${res.status}`); return }
      onDone()
    } catch { setError(tc("errorNetwork")) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-2 pt-1">
      {loadingContacts ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> {tc("loading")}
        </div>
      ) : (
        <>
          <Input
            placeholder={tc("searchContacts")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="max-h-28 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y">
            {filteredContacts.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">{tc("noResults")}</p>
            ) : (
              filteredContacts.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContactId(c.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors ${selectedContactId === c.id ? "bg-primary/10" : ""}`}
                >
                  <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold flex-shrink-0">
                    {(c.fullName || "?")[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block">{c.fullName}</span>
                    {c.position && <span className="text-xs text-muted-foreground truncate block">{c.position}</span>}
                  </div>
                  {selectedContactId === c.id && <Check className="h-3 w-3 text-primary flex-shrink-0" />}
                </button>
              ))
            )}
          </div>

          {/* Role */}
          <Select value={role} onChange={e => setRole(e.target.value)} className="h-7 text-xs">
            <option value="contact_person">{tc("roleContactPerson")}</option>
            <option value="decision_maker">{tc("roleDecisionMaker")}</option>
            <option value="influencer">{tc("roleInfluencer")}</option>
            <option value="champion">{tc("roleChampion")}</option>
            <option value="evaluator">{tc("roleEvaluator")}</option>
            <option value="user">{tc("roleUser")}</option>
            <option value="blocker">{tc("roleBlocker")}</option>
          </Select>

          {/* Influence */}
          <Select value={influence} onChange={e => setInfluence(e.target.value)} className="h-7 text-xs">
            <option value="High">{tc("influenceHigh")}</option>
            <option value="Medium">{tc("influenceMedium")}</option>
            <option value="Low">{tc("influenceLow")}</option>
          </Select>

          {/* Loyalty */}
          <Select value={loyalty} onChange={e => setLoyalty(e.target.value)} className="h-7 text-xs">
            <option value="Supportive">{tc("loyaltySupportive")}</option>
            <option value="Neutral">{tc("loyaltyNeutral")}</option>
            <option value="Opponent">{tc("loyaltyOpponent")}</option>
          </Select>

          {/* Cashback */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{tc("cashback")}</p>
            <div className="flex gap-1.5">
              <Select value={cashbackType} onChange={e => setCashbackType(e.target.value)} className="h-7 text-xs flex-1">
                <option value="">{tc("noCashback")}</option>
                <option value="percent">%</option>
                <option value="fixed">{tc("fixedAmount")}</option>
              </Select>
              {cashbackType && (
                <Input
                  type="number"
                  placeholder={cashbackType === "percent" ? "%" : tc("amount")}
                  value={cashbackValue}
                  onChange={e => setCashbackValue(e.target.value)}
                  className="h-7 text-xs w-20"
                />
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave} disabled={!selectedContactId || saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : tc("save")}
          </Button>
        </>
      )}
    </div>
  )
}

// ── Inline Add Competitor Form ──
function AddCompetitorForm({ dealId, orgId, onDone }: { dealId: string; orgId?: string; onDone: () => void }) {
  const tc = useTranslations("common")
  const [name, setName] = useState("")
  const [product, setProduct] = useState("")
  const [strengths, setStrengths] = useState("")
  const [weaknesses, setWeaknesses] = useState("")
  const [price, setPrice] = useState("")
  const [threat, setThreat] = useState("Medium")
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState("")

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify({
          name: name.trim(),
          product: product || undefined,
          strengths: strengths || undefined,
          weaknesses: weaknesses || undefined,
          price: price || undefined,
          threat,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || `Error ${res.status}`)
        return
      }
      onDone()
    } catch { setError(tc("errorNetwork")) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-2 pt-1">
      <Input placeholder={tc("competitorName")} value={name} onChange={e => setName(e.target.value)} className="h-7 text-xs" />
      <Input placeholder={tc("theirProduct")} value={product} onChange={e => setProduct(e.target.value)} className="h-7 text-xs" />
      <div className="grid grid-cols-2 gap-1.5">
        <Input placeholder={tc("theirStrengths")} value={strengths} onChange={e => setStrengths(e.target.value)} className="h-7 text-xs" />
        <Input placeholder={tc("theirWeaknesses")} value={weaknesses} onChange={e => setWeaknesses(e.target.value)} className="h-7 text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input placeholder={tc("theirPrice")} value={price} onChange={e => setPrice(e.target.value)} className="h-7 text-xs" />
        <Select value={threat} onChange={e => setThreat(e.target.value)} className="h-7 text-xs">
          <option value="High">{tc("high")}</option>
          <option value="Medium">{tc("medium")}</option>
          <option value="Low">{tc("low")}</option>
        </Select>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave} disabled={!name.trim() || saving}>
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : tc("save")}
      </Button>
    </div>
  )
}

const THREAT_COLORS: Record<string, string> = {
  High: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20",
  Medium: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
  Low: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20",
}

export function DealSidebar({ deal, orgId, offersCount, invoicesCount, onEdit, fetchDeal }: DealSidebarProps) {
  const t = useTranslations("deals")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { isVisible } = useFieldPermissions("deal")
  const [showAddMember, setShowAddMember] = useState(false)
  const [showAddRole, setShowAddRole] = useState(false)
  const [showAddCompetitor, setShowAddCompetitor] = useState(false)
  const [competitors, setCompetitors] = useState<Array<{ id: string; name: string; product?: string; strengths?: string; weaknesses?: string; price?: string; threat: string }>>([])

  const fetchCompetitors = () => {
    fetch(`/api/v1/deals/${deal.id}/competitors`, {
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
    })
      .then(r => r.json())
      .then(j => { if (j.success) setCompetitors(j.data) })
      .catch(() => {})
  }

  useEffect(() => { fetchCompetitors() }, [deal.id])

  return (
    <MotionCard className="space-y-0">
      {/* ── Contact Hero ── */}
      {deal.contact && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-base font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0">
              {deal.contact.fullName.split(" ").map(n => n[0]).join("").slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{deal.contact.fullName}</p>
              {deal.contact.position && (
                <p className="text-xs text-muted-foreground truncate">{deal.contact.position}</p>
              )}
            </div>
          </div>
          {/* Communication actions */}
          <div className="flex items-center gap-2 mt-3">
            {deal.contact.phone && (
              <ClickToCallButton
                phone={deal.contact.phone}
                contactId={deal.contact.id}
                companyId={deal.company?.id}
                dealId={deal.id}
                contactName={deal.contact.fullName}
                showLabel
                label={tc("call")}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-50 px-2 text-xs font-medium text-green-600 transition-colors hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              />
            )}
            {deal.contact.email && (
              <a href={`mailto:${deal.contact.email}`} className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium transition-colors">
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            )}
            {deal.contact.phone && (
              <a href={`https://wa.me/${deal.contact.phone.replace(/[^0-9]/g, "")}`} target="_blank" className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium transition-colors">
                <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Deal Value + Stage (hero) ── */}
      {isVisible("valueAmount") && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="text-2xl font-bold tabular-nums tracking-tight">
            {deal.valueAmount.toLocaleString()} {deal.currency}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isVisible("probability") && <span className="text-xs text-muted-foreground">{t("winProbability")}: {deal.probability}%</span>}
            {isVisible("probability") && <span className="text-xs text-muted-foreground">·</span>}
            <span className="text-xs text-muted-foreground">{t("confidenceLevel")}: {deal.confidenceLevel ?? 50}%</span>
          </div>
        </div>
      )}

      {/* ── Key Info ── */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 space-y-2.5">
        {[
          { icon: Building2, label: t("company"), value: deal.company?.name, field: "name" },
          { icon: User, label: t("assignedTo"), value: deal.assignedTo, field: "assignedTo" },
          { icon: Calendar, label: t("expectedClose"), value: deal.expectedClose ? formatDate(deal.expectedClose, locale) : null, field: "expectedClose" },
          { icon: Clock, label: tc("created"), value: formatDate(deal.createdAt, locale), field: "createdAt" },
          { icon: Target, label: t("campaign"), value: deal.campaign?.name, field: "campaign" },
          { icon: Target, label: t("customerNeed"), value: deal.customerNeed, field: "customerNeed" },
          { icon: Target, label: t("salesChannel"), value: deal.salesChannel, field: "salesChannel" },
        ].filter(item => item.value && isVisible(item.field)).map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{label}</span>
            <span className="text-xs font-medium truncate">{value}</span>
          </div>
        ))}
      </div>

      {/* ── Notes ── */}
      {deal.notes && isVisible("notes") && (
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("notes")}</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{deal.notes}</p>
          {deal.lostReason && (
            <div className="flex items-start gap-1.5 mt-2 p-2 bg-red-50 dark:bg-red-900/10 rounded-lg">
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">{tc("lostReason")}:</span>
              <span className="text-xs text-red-600 dark:text-red-400">{deal.lostReason}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Collapsible Sections ── */}
      <div className="px-3 py-1">
        {/* Offers */}
        <AccordionItem
          title={t("offers")}
          icon={<FileText className="h-3.5 w-3.5" />}
          count={offersCount}
          defaultOpen={offersCount > 0}
        >
          <div className="space-y-1.5">
            {offersCount > 0 && <p className="text-xs text-muted-foreground">{offersCount} {t("offers").toLowerCase()}</p>}
            <a href={`/offers?dealId=${deal.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <FileText className="h-3 w-3" /> {tc("viewAll")}
            </a>
          </div>
        </AccordionItem>

        {/* Invoices */}
        <AccordionItem
          title={tc("invoicesTitle")}
          icon={<Receipt className="h-3.5 w-3.5" />}
          count={invoicesCount}
          defaultOpen={invoicesCount > 0}
        >
          <div className="space-y-1.5">
            {invoicesCount > 0 && <p className="text-xs text-muted-foreground">{invoicesCount}</p>}
            <a href={`/invoices?dealId=${deal.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Receipt className="h-3 w-3" /> {tc("viewAll")}
            </a>
          </div>
        </AccordionItem>

        {/* Team */}
        <AccordionItem
          title={t("team")}
          icon={<Users className="h-3.5 w-3.5" />}
          count={deal.teamMembers?.length || 0}
          defaultOpen={(deal.teamMembers?.length || 0) > 0}
        >
          <div className="space-y-1.5">
            {deal.teamMembers?.length > 0 ? (
              deal.teamMembers.map(m => (
                <div key={m.id} className="flex items-center gap-2.5 py-1.5 group">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {(m.user.name || m.user.email || "?")[0].toUpperCase()}
                  </div>
                  <span className="text-sm truncate flex-1">{m.user.name || m.user.email}</span>
                  <Badge variant="outline" className="text-xs h-5 px-2">{m.role}</Badge>
                  <button
                    className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={async () => {
                      await fetch(`/api/v1/deals/${deal.id}/team`, {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
                        body: JSON.stringify({ userId: m.userId }),
                      })
                      fetchDeal()
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{tc("noTeamMembers")}</p>
            )}

            {showAddMember ? (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-muted/30">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold">{tc("addMember")}</span>
                  <button onClick={() => setShowAddMember(false)} className="p-0.5 rounded hover:bg-muted">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <AddTeamMemberForm dealId={deal.id} orgId={orgId} onDone={() => { setShowAddMember(false); fetchDeal() }} />
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full gap-1 h-7 text-xs" onClick={() => setShowAddMember(true)}>
                <Plus className="h-3 w-3" /> {tc("addMember")}
              </Button>
            )}
          </div>
        </AccordionItem>

        {/* Contact Roles */}
        <AccordionItem
          title={t("contactRoles")}
          icon={<Users className="h-3.5 w-3.5" />}
          count={deal.contactRoles?.length || 0}
          defaultOpen={(deal.contactRoles?.length || 0) > 0}
        >
          <div className="space-y-1.5">
            {deal.contactRoles?.length > 0 ? (
              deal.contactRoles.map(cr => (
                <div key={cr.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30 p-3 group">
                  <div className="flex items-start gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">
                      {(cr.contact.fullName || "?")[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{cr.contact.fullName}</span>
                        <Badge variant="outline" className="text-xs h-5 px-1.5 font-medium">{cr.role}</Badge>
                      </div>
                      {cr.contact.position && <p className="text-sm text-muted-foreground">{cr.contact.position}</p>}
                    </div>
                    <button
                      className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={async () => {
                        await fetch(`/api/v1/deals/${deal.id}/contact-roles`, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
                          body: JSON.stringify({ contactId: cr.contactId }),
                        })
                        fetchDeal()
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-2 ml-10 space-y-1 text-sm">
                    {(cr as any).influence && (
                      <div className="flex"><span className="text-muted-foreground w-20">{tc("influence")}</span><span className="font-medium">{(cr as any).influence}</span></div>
                    )}
                    {(cr as any).loyalty && (
                      <div className="flex"><span className="text-muted-foreground w-20">{tc("loyalty")}</span><span className="font-medium">{(cr as any).loyalty}</span></div>
                    )}
                    {cr.cashbackType && cr.cashbackValue != null && (
                      <div className="flex"><span className="text-muted-foreground w-20">{tc("cashback")}</span><span className="font-semibold text-green-600 dark:text-green-400">{cr.cashbackType === "percent" ? `${cr.cashbackValue}%` : fmtAmount(cr.cashbackValue)}</span></div>
                    )}
                    {cr.contact.email && (
                      <div className="flex overflow-hidden"><span className="text-muted-foreground w-20 shrink-0">Email</span><a href={`mailto:${cr.contact.email}`} className="font-medium text-primary hover:underline truncate">{cr.contact.email}</a></div>
                    )}
                    {cr.contact.phone && (
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="w-20 shrink-0 text-muted-foreground">{tc("phone")}</span>
                        <span className="font-medium whitespace-nowrap">{cr.contact.phone}</span>
                        <ClickToCallButton
                          phone={cr.contact.phone}
                          contactId={cr.contactId}
                          companyId={deal.company?.id}
                          dealId={deal.id}
                          contactName={cr.contact.fullName}
                          className="ml-auto h-7 w-7"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{tc("noContactRoles")}</p>
            )}

            {showAddRole ? (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-muted/30">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold">{tc("addContactRole")}</span>
                  <button onClick={() => setShowAddRole(false)} className="p-0.5 rounded hover:bg-muted">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <AddContactRoleForm dealId={deal.id} orgId={orgId} onDone={() => { setShowAddRole(false); fetchDeal() }} />
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full gap-1 h-7 text-xs" onClick={() => setShowAddRole(true)}>
                <Plus className="h-3 w-3" /> {tc("addContactRole")}
              </Button>
            )}
          </div>
        </AccordionItem>

        {/* Competitors */}
        <AccordionItem
          title={t("competitors")}
          icon={<Swords className="h-3.5 w-3.5" />}
          count={competitors.length}
          defaultOpen={competitors.length > 0}
        >
          <div className="space-y-1.5">
            {competitors.length > 0 ? (
              competitors.map(comp => (
                <div key={comp.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30 p-3 group">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center text-xs font-semibold text-orange-600 dark:text-orange-400 flex-shrink-0">
                      {comp.name[0]}
                    </div>
                    <span className="text-sm font-medium truncate flex-1">{comp.name}</span>
                    <Badge variant="outline" className={`text-xs h-5 px-1.5 border-0 ${THREAT_COLORS[comp.threat] || ""}`}>
                      {comp.threat}
                    </Badge>
                    <button
                      className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={async () => {
                        await fetch(`/api/v1/deals/${deal.id}/competitors`, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
                          body: JSON.stringify({ competitorId: comp.id }),
                        })
                        fetchCompetitors()
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-2 ml-9 space-y-1 text-sm">
                    {comp.product && (
                      <div className="flex"><span className="text-muted-foreground w-24 flex-shrink-0">{tc("theirProduct")}</span><span className="font-medium">{comp.product}</span></div>
                    )}
                    {comp.price && (
                      <div className="flex"><span className="text-muted-foreground w-24 flex-shrink-0">{tc("theirPrice")}</span><span className="font-medium">{comp.price}</span></div>
                    )}
                    {comp.strengths && (
                      <div className="flex"><span className="text-muted-foreground w-24 flex-shrink-0">{tc("theirStrengths")}</span><span className="font-medium text-green-600 dark:text-green-400">{comp.strengths}</span></div>
                    )}
                    {comp.weaknesses && (
                      <div className="flex"><span className="text-muted-foreground w-24 flex-shrink-0">{tc("theirWeaknesses")}</span><span className="font-medium text-red-600 dark:text-red-400">{comp.weaknesses}</span></div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{tc("noCompetitors")}</p>
            )}

            {showAddCompetitor ? (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-muted/30">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold">{tc("addCompetitor")}</span>
                  <button onClick={() => setShowAddCompetitor(false)} className="p-0.5 rounded hover:bg-muted">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <AddCompetitorForm dealId={deal.id} orgId={orgId} onDone={() => { setShowAddCompetitor(false); fetchCompetitors() }} />
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full gap-1 h-7 text-xs" onClick={() => setShowAddCompetitor(true)}>
                <Plus className="h-3 w-3" /> {tc("addCompetitor")}
              </Button>
            )}
          </div>
        </AccordionItem>
      </div>
    </MotionCard>
  )
}
