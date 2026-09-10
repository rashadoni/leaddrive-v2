"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Users, UserCheck, Clock, Search, Shield, ShieldOff, KeyRound, Key, MessageSquareX, UserMinus, Pencil } from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface PortalContact {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  companyName: string | null
  isActive: boolean
  portalAccessEnabled: boolean
  hasPassword: boolean
  portalLastLoginAt: string | null
}

interface Stats {
  totalWithEmail: number
  enabled: number
  registered: number
  recentLogins: number
}

interface PortalProfileForm {
  fullName: string
  email: string
  phone: string
  portalAccessEnabled: boolean
}

type FilterType = "all" | "enabled" | "registered" | "pending" | "disabled"

export default function PortalUsersPage() {
  const t = useTranslations("settings")
  useAutoTour("portalUsers")
  const tc = useTranslations("common")
  const [contacts, setContacts] = useState<PortalContact[]>([])
  const [stats, setStats] = useState<Stats>({ totalWithEmail: 0, enabled: 0, registered: 0, recentLogins: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>("all")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resetDialog, setResetDialog] = useState<PortalContact | null>(null)
  const [clearChatDialog, setClearChatDialog] = useState<PortalContact | null>(null)
  const [removeDialog, setRemoveDialog] = useState<PortalContact | null>(null)
  const [editDialog, setEditDialog] = useState<PortalContact | null>(null)
  const [manualPasswordDialog, setManualPasswordDialog] = useState<PortalContact | null>(null)
  const [editForm, setEditForm] = useState<PortalProfileForm>({ fullName: "", email: "", phone: "", portalAccessEnabled: false })
  const [editError, setEditError] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [manualPassword, setManualPassword] = useState("")
  const [manualPasswordConfirmation, setManualPasswordConfirmation] = useState("")
  const [manualPasswordAcknowledged, setManualPasswordAcknowledged] = useState(false)
  const [manualPasswordError, setManualPasswordError] = useState("")
  const [savingManualPassword, setSavingManualPassword] = useState(false)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter !== "all") params.set("filter", filter)
    if (search) params.set("search", search)
    try {
      const res = await fetch(`/api/v1/portal-users?${params}`)
      const json = await res.json()
      if (json.success) {
        setContacts(json.data.contacts)
        setStats(json.data.stats)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }, [filter, search])

  useEffect(() => { fetchData() }, [fetchData])

  const portalPatch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/v1/portal-users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || t("portalActionFailed"))
    return json
  }

  const handleToggleAccess = async (contact: PortalContact) => {
    try {
      await portalPatch({ contactId: contact.id, portalAccessEnabled: !contact.portalAccessEnabled })
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("portalActionFailed"))
    }
  }

  const handleResetPassword = async () => {
    if (!resetDialog) return
    const json = await portalPatch({ contactId: resetDialog.id, sendPasswordLink: true })
    toast.success(json.data?.mode === "activation" ? t("portalActivationLinkSent") : t("portalPasswordLinkSent"))
    await fetchData()
  }

  const handleClearChat = async () => {
    if (!clearChatDialog) return
    await portalPatch({ contactId: clearChatDialog.id, clearChatHistory: true })
    await fetchData()
  }

  const handleRemoveFromPortal = async () => {
    if (!removeDialog) return
    await portalPatch({ contactId: removeDialog.id, removeFromPortal: true })
    await fetchData()
  }

  const openEditDialog = (contact: PortalContact) => {
    setEditError("")
    setEditForm({
      fullName: contact.fullName,
      email: contact.email || "",
      phone: contact.phone || "",
      portalAccessEnabled: contact.portalAccessEnabled,
    })
    setEditDialog(contact)
  }

  const openManualPasswordDialog = (contact: PortalContact) => {
    setManualPassword("")
    setManualPasswordConfirmation("")
    setManualPasswordAcknowledged(false)
    setManualPasswordError("")
    setManualPasswordDialog(contact)
  }

  const handleSetManualPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!manualPasswordDialog) return
    if (manualPassword !== manualPasswordConfirmation) {
      setManualPasswordError(t("portalManualPasswordMismatch"))
      return
    }
    if (!manualPasswordAcknowledged) {
      setManualPasswordError(t("portalManualPasswordAcknowledgementRequired"))
      return
    }

    setSavingManualPassword(true)
    setManualPasswordError("")
    try {
      await portalPatch({
        contactId: manualPasswordDialog.id,
        administratorPassword: {
          password: manualPassword,
          confirmPassword: manualPasswordConfirmation,
          acknowledged: true,
        },
      })
      setManualPasswordDialog(null)
      setManualPassword("")
      setManualPasswordConfirmation("")
      await fetchData()
      toast.success(t("portalManualPasswordSet"))
    } catch (error) {
      setManualPasswordError(error instanceof Error ? error.message : t("portalActionFailed"))
    } finally {
      setSavingManualPassword(false)
    }
  }

  const handleSavePortalUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editDialog) return
    const contactId = editDialog.id
    setSavingEdit(true)
    setEditError("")
    const email = editForm.email.trim().toLowerCase()
    try {
      const updated = await portalPatch({
        contactId,
        profile: {
          fullName: editForm.fullName.trim(),
          email: email || null,
          phone: editForm.phone.trim() || null,
          portalAccessEnabled: editForm.portalAccessEnabled,
        },
      })
      setEditDialog(null)
      await fetchData()

      if (updated.data?.credentialsRevoked && editForm.portalAccessEnabled && email) {
        try {
          await portalPatch({ contactId, sendPasswordLink: true })
          toast.success(t("portalEditSavedAndLinkSent"))
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("portalEditSavedLinkFailed"))
        }
      } else {
        toast.success(t("portalEditSaved"))
      }
    } catch (error) {
      setEditError(error instanceof Error ? error.message : t("portalActionFailed"))
    } finally {
      setSavingEdit(false)
    }
  }

  const handleBulkEnable = async () => {
    if (selected.size === 0) return
    try {
      await portalPatch({ contactIds: Array.from(selected), action: "enable" })
      setSelected(new Set())
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("portalActionFailed"))
    }
  }

  const handleBulkDisable = async () => {
    if (selected.size === 0) return
    try {
      await portalPatch({ contactIds: Array.from(selected), action: "disable" })
      setSelected(new Set())
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("portalActionFailed"))
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set())
    else setSelected(new Set(contacts.map(c => c.id)))
  }

  const formatDate = (d: string | null) => {
    if (!d) return "—"
    return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  const getStatusBadge = (c: PortalContact) => {
    if (!c.portalAccessEnabled) return <Badge variant="outline" className="text-xs">{tc("inactive")}</Badge>
    if (c.hasPassword) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">{tc("active")}</Badge>
    return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">{tc("pending")}</Badge>
  }

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: tc("all") },
    { key: "enabled", label: t("portalFilterEnabled") },
    { key: "registered", label: t("portalFilterRegistered") },
    { key: "pending", label: tc("pending") },
    { key: "disabled", label: t("portalFilterDisabled") },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("portalUsers")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 data-tour-id="portal-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("portalUsers")} <TourReplayButton tourId="portalUsers" /><HelpButton slug="portal-users" variant="label" /></h1>
        <p className="text-sm text-muted-foreground">{t("portalUsersDesc")}</p>
        <p className="text-sm text-muted-foreground mt-1">{t("hintPortalUsers")}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ColorStatCard label={t("portalContactsWithEmail")} value={stats.totalWithEmail} icon={<Users className="h-4 w-4" />} />
        <ColorStatCard label={t("portalAccessEnabled")} value={stats.enabled} icon={<Shield className="h-4 w-4" />} />
        <ColorStatCard label={t("portalRegistered")} value={stats.registered} icon={<UserCheck className="h-4 w-4" />} />
        <ColorStatCard label={t("portalRecentLogins")} value={stats.recentLogins} icon={<Clock className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {filters.map(f => (
                <Button key={f.key} variant={filter === f.key ? "default" : "outline"} size="sm" onClick={() => setFilter(f.key)}>
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={tc("search")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 mb-4 p-2 bg-muted/50 rounded-lg">
              <span className="text-sm text-muted-foreground">{t("portalSelected", { count: selected.size })}</span>
              <Button size="sm" variant="outline" onClick={handleBulkEnable}><Shield className="h-3.5 w-3.5 mr-1" /> {t("portalEnableAccess")}</Button>
              <Button size="sm" variant="outline" onClick={handleBulkDisable}><ShieldOff className="h-3.5 w-3.5 mr-1" /> {t("portalDisableAccess")}</Button>
            </div>
          )}

          {contacts.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Users className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-medium text-foreground">
                {search ? tc("noResults") : t("portalNoContacts")}
              </p>
              {!search && (
                <>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6">{t("portalNoContactsHint")}</p>
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <Link href="/contacts">{t("portalNoContactsAction")}</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 w-8"><input type="checkbox" checked={selected.size === contacts.length && contacts.length > 0} onChange={toggleAll} /></th>
                    <th className="p-2 text-left font-medium">{tc("fullName")}</th>
                    <th className="p-2 text-left font-medium">{tc("email")}</th>
                    <th className="p-2 text-left font-medium">{tc("company")}</th>
                    <th className="p-2 text-left font-medium">{t("portalStatus")}</th>
                    <th className="p-2 text-left font-medium">{t("portalLastLogin")}</th>
                    <th className="p-2 text-right font-medium">{tc("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(c => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="p-2"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} /></td>
                      <td className="p-2 font-medium">{c.fullName}</td>
                      <td className="p-2 text-muted-foreground">{c.email || "—"}</td>
                      <td className="p-2 text-muted-foreground">{c.companyName || "—"}</td>
                      <td className="p-2">{getStatusBadge(c)}</td>
                      <td className="p-2 text-muted-foreground text-xs">{formatDate(c.portalLastLoginAt)}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEditDialog(c)}
                            className="p-1.5 rounded hover:bg-muted"
                            title={t("portalBtnEdit")}
                          >
                            <Pencil className="h-3.5 w-3.5 text-blue-500" />
                          </button>
                          <button
                            onClick={() => handleToggleAccess(c)}
                            className="p-1.5 rounded hover:bg-muted"
                            title={c.portalAccessEnabled ? t("portalBtnDisable") : t("portalBtnEnable")}
                          >
                            {c.portalAccessEnabled
                              ? <ShieldOff className="h-3.5 w-3.5 text-red-500" />
                              : <Shield className="h-3.5 w-3.5 text-green-500" />
                            }
                          </button>
                          {c.portalAccessEnabled && c.email && (
                            <button
                              onClick={() => setResetDialog(c)}
                              className="p-1.5 rounded hover:bg-muted"
                              title={c.hasPassword ? t("portalBtnResetPassword") : t("portalBtnSendAccessLink")}
                            >
                              <KeyRound className="h-3.5 w-3.5 text-orange-500" />
                            </button>
                          )}
                          {c.portalAccessEnabled && c.email && (
                            <button
                              onClick={() => openManualPasswordDialog(c)}
                              className="p-1.5 rounded hover:bg-muted"
                              title={t("portalBtnSetPassword")}
                            >
                              <Key className="h-3.5 w-3.5 text-amber-600" />
                            </button>
                          )}
                          <button
                            onClick={() => setClearChatDialog(c)}
                            className="p-1.5 rounded hover:bg-muted"
                            title={t("portalBtnClearChat")}
                          >
                            <MessageSquareX className="h-3.5 w-3.5 text-purple-500" />
                          </button>
                          {(c.portalAccessEnabled || c.hasPassword) && (
                            <button
                              onClick={() => setRemoveDialog(c)}
                              className="p-1.5 rounded hover:bg-muted"
                              title={t("portalBtnRemove")}
                            >
                              <UserMinus className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={!!resetDialog}
        onOpenChange={() => setResetDialog(null)}
        onConfirm={handleResetPassword}
        title={t("portalResetPasswordTitle")}
        description={t("portalResetPasswordDesc")}
        confirmLabel={t("portalResetPasswordBtn")}
        confirmVariant="default"
        loadingLabel={t("portalResetting")}
      />

      <Dialog open={!!editDialog} onOpenChange={(open) => { if (!open) setEditDialog(null) }}>
        <form onSubmit={handleSavePortalUser} className="flex flex-col min-h-0">
          <DialogHeader>
            <DialogTitle>{t("portalEditUser")}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              {editError && <p className="rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-300">{editError}</p>}
              <div>
                <Label htmlFor="portal-user-name">{tc("fullName")}</Label>
                <Input id="portal-user-name" value={editForm.fullName} onChange={(event) => setEditForm((form) => ({ ...form, fullName: event.target.value }))} required maxLength={200} />
              </div>
              <div>
                <Label htmlFor="portal-user-email">{tc("email")}</Label>
                <Input id="portal-user-email" type="email" autoComplete="email" value={editForm.email} onChange={(event) => setEditForm((form) => ({ ...form, email: event.target.value }))} required={editForm.portalAccessEnabled} maxLength={320} />
              </div>
              <div>
                <Label htmlFor="portal-user-phone">{tc("phone")}</Label>
                <Input id="portal-user-phone" type="tel" autoComplete="tel" value={editForm.phone} onChange={(event) => setEditForm((form) => ({ ...form, phone: event.target.value }))} maxLength={50} />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={editForm.portalAccessEnabled} onChange={(event) => setEditForm((form) => ({ ...form, portalAccessEnabled: event.target.checked }))} />
                {t("portalAccessEnabled")}
              </label>
              {editDialog?.hasPassword && editForm.email.trim().toLowerCase() !== (editDialog.email || "").trim().toLowerCase() && (
                <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                  {t("portalEmailChangeWarning")}
                </p>
              )}
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditDialog(null)} disabled={savingEdit}>{tc("cancel")}</Button>
            <Button type="submit" disabled={savingEdit}>{savingEdit ? t("portalSaving") : t("portalEditSave")}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={!!manualPasswordDialog} onOpenChange={(open) => { if (!open) setManualPasswordDialog(null) }}>
        <form onSubmit={handleSetManualPassword} className="flex flex-col min-h-0">
          <DialogHeader>
            <DialogTitle>{t("portalManualPasswordTitle")}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">{t("portalManualPasswordDesc")}</p>
              {manualPasswordError && <p className="rounded bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-300">{manualPasswordError}</p>}
              <div>
                <Label htmlFor="portal-manual-password">{t("portalManualPasswordNew")}</Label>
                <Input id="portal-manual-password" type="password" autoComplete="new-password" value={manualPassword} onChange={(event) => setManualPassword(event.target.value)} required minLength={12} maxLength={72} />
                <p className="mt-1 text-xs text-muted-foreground">{t("portalManualPasswordHint")}</p>
              </div>
              <div>
                <Label htmlFor="portal-manual-password-confirm">{t("portalManualPasswordConfirm")}</Label>
                <Input id="portal-manual-password-confirm" type="password" autoComplete="new-password" value={manualPasswordConfirmation} onChange={(event) => setManualPasswordConfirmation(event.target.value)} required minLength={12} maxLength={72} />
              </div>
              <label className="flex items-start gap-2 text-sm leading-5">
                <input className="mt-1" type="checkbox" checked={manualPasswordAcknowledged} onChange={(event) => setManualPasswordAcknowledged(event.target.checked)} />
                {t("portalManualPasswordAcknowledgement")}
              </label>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManualPasswordDialog(null)} disabled={savingManualPassword}>{tc("cancel")}</Button>
            <Button type="submit" disabled={savingManualPassword}>{savingManualPassword ? t("portalManualPasswordSaving") : t("portalManualPasswordSave")}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <DeleteConfirmDialog
        open={!!clearChatDialog}
        onOpenChange={() => setClearChatDialog(null)}
        onConfirm={handleClearChat}
        title={t("portalClearChatTitle")}
        description={t("portalClearChatDesc")}
        confirmLabel={t("portalClearChatBtn")}
        loadingLabel={t("portalClearing")}
      />

      <DeleteConfirmDialog
        open={!!removeDialog}
        onOpenChange={() => setRemoveDialog(null)}
        onConfirm={handleRemoveFromPortal}
        title={t("portalRemoveTitle")}
        description={t("portalRemoveDesc")}
        confirmLabel={t("portalRemoveBtn")}
      />
    </div>
  )
}
