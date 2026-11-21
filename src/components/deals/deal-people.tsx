"use client"

/**
 * The people of a deal — its team, the customer's contacts with their roles,
 * and the competitors — as three sections of the deal page («Клиент»).
 * They were three accordions of the old left column (DealSidebar); the forms
 * that add a person are the same ones, the lists got the room of a section.
 */

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { User, Users, Swords, Plus, X, Loader2, Check } from "lucide-react"
import { fmtAmount } from "@/lib/utils"
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
  /** The owner's name, when the API could resolve `assignedTo` to a person of the organization. */
  assignedToName?: string | null
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
          <div className="max-h-28 overflow-y-auto border border-border rounded-lg divide-y">
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
          <div className="max-h-28 overflow-y-auto border border-border rounded-lg divide-y">
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

export type TeamMember = Deal["teamMembers"][number]
export type ContactRole = Deal["contactRoles"][number]
export interface DealCompetitor { id: string; name: string; product?: string; strengths?: string; weaknesses?: string; price?: string; threat: string }

const jsonHeaders = (orgId?: string): Record<string, string> => ({ "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) })

function EmptyLine({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-input p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

/** The add form of a section: a button until it is asked for, then the form in a soft frame. */
function AddBlock({ label, open, onOpen, onClose, children }: { label: string; open: boolean; onOpen: () => void; onClose: () => void; children: React.ReactNode }) {
  const tc = useTranslations("common")
  if (!open) {
    return <Button variant="outline" size="sm" className="gap-1.5" onClick={onOpen}><Plus className="h-4 w-4" /> {label}</Button>
  }
  return (
    <div className="max-w-xl rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={onClose}><X className="h-3.5 w-3.5" /> {tc("close")}</Button>
      </div>
      {children}
    </div>
  )
}

export function DealTeamSection({ dealId, orgId, members, canWrite, emptyHint, onChanged }: {
  dealId: string; orgId?: string; members: TeamMember[]; canWrite: boolean; emptyHint: string; onChanged: () => void
}) {
  const tc = useTranslations("common")
  const [adding, setAdding] = useState(false)
  const remove = async (userId: string) => {
    await fetch(`/api/v1/deals/${dealId}/team`, { method: "DELETE", headers: jsonHeaders(orgId), body: JSON.stringify({ userId }) })
    onChanged()
  }
  return (
    <div className="space-y-3">
      {members.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{(m.user.name || m.user.email || "?")[0].toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.user.name || m.user.email}</span>
              <Badge variant="outline">{m.role}</Badge>
              {canWrite && (
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={tc("delete")} onClick={() => void remove(m.userId)}><X className="h-4 w-4" /></Button>
              )}
            </li>
          ))}
        </ul>
      ) : <EmptyLine icon={<Users />} title={tc("noTeamMembers")} hint={emptyHint} />}
      {canWrite && (
        <AddBlock label={tc("addMember")} open={adding} onOpen={() => setAdding(true)} onClose={() => setAdding(false)}>
          <AddTeamMemberForm dealId={dealId} orgId={orgId} onDone={() => { setAdding(false); onChanged() }} />
        </AddBlock>
      )}
    </div>
  )
}

export function DealContactRolesSection({ dealId, orgId, companyId, roles, canWrite, emptyHint, onChanged }: {
  dealId: string; orgId?: string; companyId?: string; roles: ContactRole[]; canWrite: boolean; emptyHint: string; onChanged: () => void
}) {
  const tc = useTranslations("common")
  const [adding, setAdding] = useState(false)
  const remove = async (contactId: string) => {
    await fetch(`/api/v1/deals/${dealId}/contact-roles`, { method: "DELETE", headers: jsonHeaders(orgId), body: JSON.stringify({ contactId }) })
    onChanged()
  }
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-2 text-sm"><span className="w-24 shrink-0 text-muted-foreground">{label}</span><span className="min-w-0 truncate font-medium">{value}</span></div>
  )
  return (
    <div className="space-y-3">
      {roles.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((cr) => (
            <div key={cr.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{(cr.contact.fullName || "?")[0]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{cr.contact.fullName}</span>
                    <Badge variant="outline">{cr.role}</Badge>
                  </div>
                  {cr.contact.position && <p className="text-sm text-muted-foreground">{cr.contact.position}</p>}
                </div>
                {canWrite && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label={tc("delete")} onClick={() => void remove(cr.contactId)}><X className="h-4 w-4" /></Button>
                )}
              </div>
              <div className="mt-3 space-y-1.5">
                {cr.influence && row(tc("influence"), cr.influence)}
                {cr.loyalty && row(tc("loyalty"), cr.loyalty)}
                {cr.cashbackType && cr.cashbackValue != null && row(tc("cashback"), cr.cashbackType === "percent" ? `${cr.cashbackValue}%` : fmtAmount(cr.cashbackValue))}
                {cr.contact.email && row("Email", <a href={`mailto:${cr.contact.email}`} className="text-primary hover:underline">{cr.contact.email}</a>)}
                {cr.contact.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">{tc("phone")}</span>
                    <span className="whitespace-nowrap font-medium">{cr.contact.phone}</span>
                    <ClickToCallButton phone={cr.contact.phone} contactId={cr.contactId} companyId={companyId} dealId={dealId} contactName={cr.contact.fullName} className="ml-auto h-8 w-8" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyLine icon={<User />} title={tc("noContactRoles")} hint={emptyHint} />}
      {canWrite && (
        <AddBlock label={tc("addContactRole")} open={adding} onOpen={() => setAdding(true)} onClose={() => setAdding(false)}>
          <AddContactRoleForm dealId={dealId} orgId={orgId} onDone={() => { setAdding(false); onChanged() }} />
        </AddBlock>
      )}
    </div>
  )
}

export function DealCompetitorsSection({ dealId, orgId, competitors, canWrite, emptyHint, onChanged }: {
  dealId: string; orgId?: string; competitors: DealCompetitor[]; canWrite: boolean; emptyHint: string; onChanged: () => void
}) {
  const tc = useTranslations("common")
  const [adding, setAdding] = useState(false)
  const remove = async (competitorId: string) => {
    await fetch(`/api/v1/deals/${dealId}/competitors`, { method: "DELETE", headers: jsonHeaders(orgId), body: JSON.stringify({ competitorId }) })
    onChanged()
  }
  const row = (label: string, value: string, tone = "") => (
    <div className="flex gap-2 text-sm"><span className="w-28 shrink-0 text-muted-foreground">{label}</span><span className={`min-w-0 font-medium ${tone}`}>{value}</span></div>
  )
  return (
    <div className="space-y-3">
      {competitors.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {competitors.map((comp) => (
            <div key={comp.id} className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{comp.name[0]}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{comp.name}</span>
                <Badge variant="outline" className={`border-0 ${THREAT_COLORS[comp.threat] || ""}`}>{comp.threat}</Badge>
                {canWrite && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={tc("delete")} onClick={() => void remove(comp.id)}><X className="h-4 w-4" /></Button>
                )}
              </div>
              {(comp.product || comp.price || comp.strengths || comp.weaknesses) && (
                <div className="mt-3 space-y-1.5">
                  {comp.product && row(tc("theirProduct"), comp.product)}
                  {comp.price && row(tc("theirPrice"), comp.price)}
                  {comp.strengths && row(tc("theirStrengths"), comp.strengths, "text-green-700 dark:text-green-400")}
                  {comp.weaknesses && row(tc("theirWeaknesses"), comp.weaknesses, "text-red-700 dark:text-red-400")}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <EmptyLine icon={<Swords />} title={tc("noCompetitors")} hint={emptyHint} />}
      {canWrite && (
        <AddBlock label={tc("addCompetitor")} open={adding} onOpen={() => setAdding(true)} onClose={() => setAdding(false)}>
          <AddCompetitorForm dealId={dealId} orgId={orgId} onDone={() => { setAdding(false); onChanged() }} />
        </AddBlock>
      )}
    </div>
  )
}
