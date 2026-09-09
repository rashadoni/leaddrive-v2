"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Pencil, Trash2, Users, MapPin, X } from "lucide-react"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

// ─── Types ────────────────────────────────────────────────────────────────────

interface TerritoryRules {
  countries?: string[]
  industries?: string[]
  companySizeMin?: number
  companySizeMax?: number
}

interface TerritoryMember {
  id: string
  userId: string
  user: { id: string; name: string; email: string }
}

interface Territory {
  id: string
  name: string
  description: string | null
  isActive: boolean
  rules: TerritoryRules
  members: TerritoryMember[]
}

interface UserOption {
  id: string
  name: string
  email: string
}

// ─── Territory Form ───────────────────────────────────────────────────────────

interface TerritoryFormProps {
  initial?: Territory
  onSave: (data: {
    name: string
    description: string
    isActive: boolean
    rules: TerritoryRules
  }) => Promise<void>
  onClose: () => void
}

function TerritoryForm({ initial, onSave, onClose }: TerritoryFormProps) {
  const t = useTranslations("territoriesPage")
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [countries, setCountries] = useState((initial?.rules.countries ?? []).join(", "))
  const [industries, setIndustries] = useState((initial?.rules.industries ?? []).join(", "))
  const [sizeMin, setSizeMin] = useState(String(initial?.rules.companySizeMin ?? ""))
  const [sizeMax, setSizeMax] = useState(String(initial?.rules.companySizeMax ?? ""))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const parseList = (s: string) =>
    s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)

  const parseListRaw = (s: string) =>
    s.split(",").map((x) => x.trim()).filter(Boolean)

  const handleSave = async () => {
    if (!name.trim()) { setError(t("form.nameRequired")); return }
    setSaving(true)
    setError("")
    try {
      const rules: TerritoryRules = {}
      if (countries.trim()) rules.countries = parseList(countries)
      if (industries.trim()) rules.industries = parseListRaw(industries)
      if (sizeMin.trim()) rules.companySizeMin = Number(sizeMin)
      if (sizeMax.trim()) rules.companySizeMax = Number(sizeMax)
      await onSave({ name: name.trim(), description: description.trim(), isActive, rules })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("form.saveFailed"))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">{initial ? t("form.editTitle") : t("form.newTitle")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid gap-2">
            <label className="text-sm font-medium">{t("form.nameLabel")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("form.namePlaceholder")} />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">{t("form.descriptionLabel")}</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("form.descriptionPlaceholder")} />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
            <label htmlFor="active" className="text-sm">{t("form.activeLabel")}</label>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-semibold">{t("form.rulesTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("form.rulesHint")}</p>

            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("form.countriesLabel")}</label>
              <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder={t("form.countriesPlaceholder")} className="text-sm" />
            </div>

            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("form.industriesLabel")}</label>
              <Input value={industries} onChange={(e) => setIndustries(e.target.value)} placeholder={t("form.industriesPlaceholder")} className="text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("form.minEmployeesLabel")}</label>
                <Input type="number" min={0} value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} placeholder="0" className="text-sm" />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("form.maxEmployeesLabel")}</label>
                <Input type="number" min={0} value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} placeholder="0" className="text-sm" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("actions.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("form.saving") : t("form.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Member Manager ───────────────────────────────────────────────────────────

function MemberManager({ territory, users, onClose, onRefresh }: {
  territory: Territory
  users: UserOption[]
  onClose: () => void
  onRefresh: () => void
}) {
  const t = useTranslations("territoriesPage")
  const [adding, setAdding] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState("")
  const [memberError, setMemberError] = useState("")

  const memberIds = new Set(territory.members.map((m) => m.userId))
  const available = users.filter((u) => !memberIds.has(u.id))

  const addMember = async () => {
    if (!selectedUserId) return
    setAdding(true)
    setMemberError("")
    try {
      const res = await fetch(`/api/v1/territories/${territory.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      })
      if (!res.ok) {
        const err = await res.json()
        setMemberError(err.error ?? t("members.addFailed"))
        return
      }
      setSelectedUserId("")
      onRefresh()
    } finally {
      setAdding(false)
    }
  }

  const removeMember = async (userId: string) => {
    const res = await fetch(`/api/v1/territories/${territory.id}/members/${userId}`, { method: "DELETE" })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setMemberError(err.error ?? t("members.removeFailed"))
      return
    }
    onRefresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold">{t("members.title", { name: territory.name })}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {memberError && <p className="text-sm text-destructive">{memberError}</p>}
          {/* Current members */}
          <div className="space-y-2">
            {territory.members.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("members.empty")}</p>
            )}
            {territory.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium">{m.user.name}</p>
                  <p className="text-xs text-muted-foreground">{m.user.email}</p>
                </div>
                <button onClick={() => removeMember(m.userId)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add member */}
          {available.length > 0 && (
            <div className="flex gap-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="flex-1 text-sm border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1.5 bg-background"
              >
                <option value="">{t("members.selectUser")}</option>
                {available.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
              <Button size="sm" onClick={addMember} disabled={!selectedUserId || adding}>
                {t("actions.add")}
              </Button>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end">
          <Button variant="outline" onClick={onClose}>{t("actions.done")}</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TerritoriesPage() {
  const t = useTranslations("territoriesPage")
  useAutoTour("territoriesSettings")
  // `tr` is an alias for the translator, used inside the territories.map((t) => …)
  // block below where the `t` parameter name shadows the translator.
  const tr = t
  const [territories, setTerritories] = useState<Territory[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Territory | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Territory | null>(null)
  const [membersTarget, setMembersTarget] = useState<Territory | null>(null)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [tRes, uRes] = await Promise.all([
        fetch("/api/v1/territories").then((r) => r.json()),
        fetch("/api/v1/users?limit=200").then((r) => r.json()),
      ])
      if (tRes.success) setTerritories(tRes.data)
      if (uRes.success) {
        const raw = uRes.data?.users || uRes.data || []
        setUsers(raw.map((u: UserOption) => ({ id: u.id, name: u.name, email: u.email })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const handleSave = async (data: Parameters<TerritoryFormProps["onSave"]>[0]) => {
    const url = editTarget ? `/api/v1/territories/${editTarget.id}` : "/api/v1/territories"
    const method = editTarget ? "PATCH" : "POST"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? t("form.saveFailed"))
    }
    setShowForm(false)
    setEditTarget(null)
    await fetchAll()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await fetch(`/api/v1/territories/${deleteTarget.id}`, { method: "DELETE" })
    setDeleteTarget(null)
    await fetchAll()
  }

  const refreshMembers = async () => {
    const tRes = await fetch("/api/v1/territories").then((r) => r.json())
    if (tRes.success) {
      setTerritories(tRes.data)
      if (membersTarget) {
        const fresh = (tRes.data as Territory[]).find((t) => t.id === membersTarget.id)
        if (fresh) setMembersTarget(fresh)
      }
    }
  }

  const toggleActive = async (t: Territory) => {
    const res = await fetch(`/api/v1/territories/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !t.isActive }),
    })
    if (res.ok) await fetchAll()
  }

  const formatRules = (rules: TerritoryRules) => {
    const parts: string[] = []
    if (rules.countries?.length) parts.push(t("rules.countries", { value: rules.countries.join(", ") }))
    if (rules.industries?.length) parts.push(t("rules.industries", { value: rules.industries.join(", ") }))
    if (rules.companySizeMin) parts.push(t("rules.minSize", { value: rules.companySizeMin }))
    if (rules.companySizeMax) parts.push(t("rules.maxSize", { value: rules.companySizeMax }))
    return parts.length ? parts.join(" · ") : t("rules.matchesAll")
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between" data-tour-id="territories-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            {t("title")}
            <HelpButton slug="territories" variant="label" />
            <TourReplayButton tourId="territoriesSettings" />
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        <Button onClick={() => { setEditTarget(null); setShowForm(true) }} data-tour-id="territories-new">
          <Plus className="h-4 w-4 mr-2" /> {t("actions.newTerritory")}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4" data-tour-id="territories-stats">
        {[
          { key: "total", label: t("stats.total"), value: territories.length },
          { key: "active", label: t("stats.active"), value: territories.filter((t) => t.isActive).length },
          { key: "totalMembers", label: t("stats.totalMembers"), value: territories.reduce((s, t) => s + t.members.length, 0) },
        ].map((s) => (
          <div key={s.key} className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-muted-foreground text-sm" data-tour-id="territories-list">{t("loading")}</p>
      ) : territories.length === 0 ? (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-12 text-center space-y-3" data-tour-id="territories-list">
          <MapPin className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="font-medium">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" /> {t("actions.newTerritory")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3" data-tour-id="territories-list">
          {territories.map((t) => (
            <div key={t.id} className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{t.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                      {t.isActive ? tr("status.active") : tr("status.inactive")}
                    </span>
                  </div>
                  {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                  <p className="text-xs text-muted-foreground">{formatRules(t.rules)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setMembersTarget(t)} title={tr("actions.manageMembers")}>
                    <Users className="h-3.5 w-3.5" />
                    <span className="ml-1 text-xs">{t.members.length}</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditTarget(t); setShowForm(true) }} title={tr("actions.edit")}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(t)} title={t.isActive ? tr("actions.deactivate") : tr("actions.activate")}>
                    {t.isActive ? tr("actions.pause") : tr("actions.resume")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(t)} title={tr("actions.delete")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Members preview */}
              {t.members.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                  {t.members.slice(0, 6).map((m) => (
                    <span key={m.id} className="text-xs bg-muted px-2 py-0.5 rounded-full">{m.user.name}</span>
                  ))}
                  {t.members.length > 6 && (
                    <span className="text-xs text-muted-foreground px-2 py-0.5">{tr("members.more", { count: t.members.length - 6 })}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <TerritoryForm
          initial={editTarget ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(null) }}
        />
      )}

      {membersTarget && (
        <MemberManager
          territory={membersTarget}
          users={users}
          onClose={() => setMembersTarget(null)}
          onRefresh={refreshMembers}
        />
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={t("delete.title")}
        description={t("delete.description", { name: deleteTarget?.name ?? "" })}
        onConfirm={handleDelete}
      />
    </div>
  )
}
