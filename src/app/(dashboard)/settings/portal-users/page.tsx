"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type Ref } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Key,
  KeyRound,
  MessageSquareX,
  Minus,
  MoreHorizontal,
  Pencil,
  Search,
  Shield,
  ShieldOff,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react"

import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  portalAccessState,
  selectAllVisible,
  togglePortalSelection,
  type PortalContactRecord,
} from "@/lib/portal-users/presentation"

interface Stats {
  totalWithEmail: number
  enabled: number
  registered: number
  recentLogins: number
}

interface ResultScope {
  shown: number
  limit: number
  truncated: boolean
}

interface PortalProfileForm {
  fullName: string
  email: string
  phone: string
  portalAccessEnabled: boolean
}

type FilterType = "all" | "enabled" | "registered" | "pending" | "disabled"
type Notice = { kind: "success" | "error"; text: string }

interface SelectionCheckboxProps {
  checked: boolean
  onChange: () => void
  ariaLabel: string
  testId: string
  id?: string
  inputRef?: Ref<HTMLInputElement>
}

function SelectionCheckbox({ checked, onChange, ariaLabel, testId, id, inputRef }: SelectionCheckboxProps) {
  return (
    <label className="relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md">
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        className="peer absolute inset-0 h-11 w-11 cursor-pointer opacity-0"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        data-testid={testId}
      />
      <span aria-hidden="true" className="pointer-events-none h-5 w-5 rounded border border-input bg-background peer-checked:border-primary peer-checked:bg-primary peer-indeterminate:border-primary peer-indeterminate:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
      <Check aria-hidden="true" className="pointer-events-none absolute h-4 w-4 text-primary-foreground opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0" />
      <Minus aria-hidden="true" className="pointer-events-none absolute h-4 w-4 text-primary-foreground opacity-0 peer-indeterminate:opacity-100" />
    </label>
  )
}

class PortalRequestError extends Error {
  constructor(readonly code?: string, readonly status?: number) {
    super(code || "PORTAL_ACTION_FAILED")
  }
}

async function checkedResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { code?: string }
  if (!response.ok) throw new PortalRequestError(body.code, response.status)
  return body as T
}

export default function PortalUsersPage() {
  const t = useTranslations("settings")
  const tc = useTranslations("common")
  const locale = useLocale()
  useAutoTour("portalUsers")

  const [contacts, setContacts] = useState<PortalContactRecord[]>([])
  const [stats, setStats] = useState<Stats>({ totalWithEmail: 0, enabled: 0, registered: 0, recentLogins: 0 })
  const [scope, setScope] = useState<ResultScope>({ shown: 0, limit: 0, truncated: false })
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [loadRetryable, setLoadRetryable] = useState(true)
  const [filter, setFilter] = useState<FilterType>("all")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [reloadToken, setReloadToken] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const desktopSelectAllRef = useRef<HTMLInputElement>(null)
  const mobileSelectAllRef = useRef<HTMLInputElement>(null)
  const actionMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const hasLoadedRef = useRef(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busyAction, setBusyAction] = useState("")
  const [resetDialog, setResetDialog] = useState<PortalContactRecord | null>(null)
  const [disableDialog, setDisableDialog] = useState<PortalContactRecord | null>(null)
  const [bulkDisableOpen, setBulkDisableOpen] = useState(false)
  const [clearChatDialog, setClearChatDialog] = useState<PortalContactRecord | null>(null)
  const [removeDialog, setRemoveDialog] = useState<PortalContactRecord | null>(null)
  const [editDialog, setEditDialog] = useState<PortalContactRecord | null>(null)
  const [manualPasswordDialog, setManualPasswordDialog] = useState<PortalContactRecord | null>(null)
  const [editForm, setEditForm] = useState<PortalProfileForm>({ fullName: "", email: "", phone: "", portalAccessEnabled: false })
  const [editError, setEditError] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [manualPassword, setManualPassword] = useState("")
  const [manualPasswordConfirmation, setManualPasswordConfirmation] = useState("")
  const [manualPasswordAcknowledged, setManualPasswordAcknowledged] = useState(false)
  const [manualPasswordError, setManualPasswordError] = useState("")
  const [savingManualPassword, setSavingManualPassword] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  const loadData = useCallback(async (signal: AbortSignal) => {
    const params = new URLSearchParams()
    if (filter !== "all") params.set("filter", filter)
    if (debouncedSearch) params.set("search", debouncedSearch)
    const firstLoad = !hasLoadedRef.current
    if (firstLoad) setInitialLoading(true)
    else setRefreshing(true)
    setLoadError("")
    setLoadRetryable(true)
    try {
      const result = await checkedResponse<{
        data: { contacts: PortalContactRecord[]; stats: Stats; scope: ResultScope }
      }>(await fetch(`/api/v1/portal-users?${params}`, { signal }))
      if (signal.aborted) return
      setContacts(result.data.contacts)
      setStats(result.data.stats)
      setScope(result.data.scope)
      hasLoadedRef.current = true
    } catch (error) {
      if (signal.aborted) return
      setLoadError(error instanceof PortalRequestError && error.code === "PORTAL_USERS_ADMIN_REQUIRED"
        ? t("portalPermissionDenied")
        : t("portalLoadFailed"))
      setLoadRetryable(!(error instanceof PortalRequestError && (error.status === 403 || error.code === "PORTAL_USERS_ADMIN_REQUIRED")))
    } finally {
      if (!signal.aborted) {
        setInitialLoading(false)
        setRefreshing(false)
      }
    }
  }, [debouncedSearch, filter, t])

  useEffect(() => {
    setSelected(new Set())
    const controller = new AbortController()
    void loadData(controller.signal)
    return () => controller.abort()
  }, [debouncedSearch, filter, loadData, reloadToken])

  useEffect(() => {
    const indeterminate = selected.size > 0 && selected.size < contacts.length
    if (desktopSelectAllRef.current) desktopSelectAllRef.current.indeterminate = indeterminate
    if (mobileSelectAllRef.current) mobileSelectAllRef.current.indeterminate = indeterminate
  }, [contacts.length, selected.size])

  const portalPatch = async <T,>(body: Record<string, unknown>) => checkedResponse<T>(await fetch("/api/v1/portal-users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }))

  const announceSuccess = (text: string, auditRecorded: boolean) => {
    setNotice({ kind: auditRecorded ? "success" : "error", text: `${text} ${t(auditRecorded ? "portalAuditRecorded" : "portalAuditFailed")}` })
    setReloadToken((value) => value + 1)
  }

  const runAccessChange = async (contact: PortalContactRecord, enabled: boolean) => {
    const key = `access:${contact.id}`
    if (busyAction) return
    setBusyAction(key)
    setNotice(null)
    try {
      const result = await portalPatch<{ auditRecorded: boolean }>({ contactId: contact.id, portalAccessEnabled: enabled })
      setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, portalAccessEnabled: enabled, ...(enabled ? {} : { hasPassword: false, recoveryExpiresAt: null, portalLastLoginAt: null }) } : item))
      announceSuccess(t(enabled ? "portalAccessEnabledSuccess" : "portalAccessDisabledSuccess", { name: contact.fullName }), result.auditRecorded)
    } catch {
      setNotice({ kind: "error", text: t("portalActionFailed") })
      throw new Error(t("portalActionFailed"))
    } finally {
      setBusyAction("")
    }
  }

  const handleResetPassword = async () => {
    if (!resetDialog || busyAction) return
    const contact = resetDialog
    setBusyAction(`recovery:${contact.id}`)
    setNotice(null)
    try {
      const result = await portalPatch<{ data: { mode: "reset" | "activation"; expiresAt: string }; auditRecorded: boolean }>({ contactId: contact.id, sendPasswordLink: true })
      setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, recoveryExpiresAt: result.data.expiresAt } : item))
      const expiry = formatDate(result.data.expiresAt)
      announceSuccess(t(result.data.mode === "activation" ? "portalActivationLinkSentWithExpiry" : "portalPasswordLinkSentWithExpiry", { expiry }), result.auditRecorded)
    } catch {
      setNotice({ kind: "error", text: t("portalRecoveryFailed") })
      throw new Error(t("portalRecoveryFailed"))
    } finally {
      setBusyAction("")
    }
  }

  const handleClearChat = async () => {
    if (!clearChatDialog || busyAction) return
    const contact = clearChatDialog
    setBusyAction(`chat:${contact.id}`)
    try {
      const result = await portalPatch<{ auditRecorded: boolean }>({ contactId: contact.id, clearChatHistory: true })
      announceSuccess(t("portalChatCleared", { name: contact.fullName }), result.auditRecorded)
    } catch {
      setNotice({ kind: "error", text: t("portalActionFailed") })
      throw new Error(t("portalActionFailed"))
    } finally { setBusyAction("") }
  }

  const handleRemoveFromPortal = async () => {
    if (!removeDialog || busyAction) return
    const contact = removeDialog
    setBusyAction(`remove:${contact.id}`)
    try {
      const result = await portalPatch<{ auditRecorded: boolean }>({ contactId: contact.id, removeFromPortal: true })
      announceSuccess(t("portalRemovedSuccess", { name: contact.fullName }), result.auditRecorded)
    } catch {
      setNotice({ kind: "error", text: t("portalActionFailed") })
      throw new Error(t("portalActionFailed"))
    } finally { setBusyAction("") }
  }

  const runBulkAction = async (action: "enable" | "disable") => {
    if (selected.size === 0 || busyAction) return
    const ids = Array.from(selected)
    setBusyAction(`bulk:${action}`)
    setNotice(null)
    try {
      const result = await portalPatch<{ updated: number; auditRecorded: boolean }>({ contactIds: ids, action })
      setSelected(new Set())
      announceSuccess(t(action === "enable" ? "portalBulkEnabled" : "portalBulkDisabled", { count: result.updated }), result.auditRecorded)
    } catch {
      setNotice({ kind: "error", text: t(action === "enable" ? "portalBulkEnableFailed" : "portalBulkDisableFailed") })
      throw new Error(t("portalActionFailed"))
    } finally { setBusyAction("") }
  }

  const openEditDialog = (contact: PortalContactRecord) => {
    setEditError("")
    setEditForm({ fullName: contact.fullName, email: contact.email || "", phone: contact.phone || "", portalAccessEnabled: contact.portalAccessEnabled })
    setEditDialog(contact)
  }

  const openManualPasswordDialog = (contact: PortalContactRecord) => {
    setManualPassword("")
    setManualPasswordConfirmation("")
    setManualPasswordAcknowledged(false)
    setManualPasswordError("")
    setManualPasswordDialog(contact)
  }

  const restoreActionMenuFocus = () => {
    const trigger = actionMenuTriggerRef.current
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    })
  }

  const handleSavePortalUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editDialog || savingEdit) return
    const contact = editDialog
    const email = editForm.email.trim().toLowerCase()
    setSavingEdit(true)
    setEditError("")
    try {
      const updated = await portalPatch<{ data: { credentialsRevoked: boolean }; auditRecorded: boolean }>({
        contactId: contact.id,
        profile: { fullName: editForm.fullName.trim(), email: email || null, phone: editForm.phone.trim() || null, portalAccessEnabled: editForm.portalAccessEnabled },
      })
      if (updated.data.credentialsRevoked && editForm.portalAccessEnabled && email) {
        try {
          const recovery = await portalPatch<{ data: { expiresAt: string }; auditRecorded: boolean }>({ contactId: contact.id, sendPasswordLink: true })
          const audited = updated.auditRecorded && recovery.auditRecorded
          setNotice({ kind: audited ? "success" : "error", text: `${t("portalEditSavedAndLinkSentWithExpiry", { expiry: formatDate(recovery.data.expiresAt) })} ${t(audited ? "portalAuditRecorded" : "portalAuditFailed")}` })
        } catch {
          setNotice({ kind: "error", text: t("portalEditSavedLinkFailed") })
        }
      } else setNotice({ kind: updated.auditRecorded ? "success" : "error", text: `${t("portalEditSaved")} ${t(updated.auditRecorded ? "portalAuditRecorded" : "portalAuditFailed")}` })
      setEditDialog(null)
      restoreActionMenuFocus()
      setReloadToken((value) => value + 1)
    } catch {
      setEditError(t("portalActionFailed"))
    } finally { setSavingEdit(false) }
  }

  const handleSetManualPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!manualPasswordDialog || savingManualPassword) return
    if (manualPassword !== manualPasswordConfirmation) return setManualPasswordError(t("portalManualPasswordMismatch"))
    if (!manualPasswordAcknowledged) return setManualPasswordError(t("portalManualPasswordAcknowledgementRequired"))
    setSavingManualPassword(true)
    setManualPasswordError("")
    try {
      const result = await portalPatch<{ auditRecorded: boolean }>({ contactId: manualPasswordDialog.id, administratorPassword: { password: manualPassword, confirmPassword: manualPasswordConfirmation, acknowledged: true } })
      setManualPasswordDialog(null)
      restoreActionMenuFocus()
      setManualPassword("")
      announceSuccess(t("portalManualPasswordSet"), result.auditRecorded)
    } catch {
      setManualPasswordError(t("portalManualPasswordPolicyError"))
    } finally { setSavingManualPassword(false) }
  }

  const formatDate = useCallback((value: string | null) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—", [locale])

  const stateLabel = (contact: PortalContactRecord) => {
    const state = portalAccessState(contact)
    return {
      contact_inactive: t("portalStateContactInactive"),
      disabled: t("portalStateDisabled"),
      setup_pending: t("portalStateSetupPending"),
      registered: t("portalStateRegistered"),
      recovery_active: t("portalStateRecoveryActive"),
      recovery_expired: t("portalStateRecoveryExpired"),
    }[state]
  }

  const recoveryHint = (contact: PortalContactRecord) => {
    const state = portalAccessState(contact)
    if ((state === "recovery_active" || state === "recovery_expired") && contact.recoveryExpiresAt) {
      return t(state === "recovery_active" ? "portalRecoveryExpires" : "portalRecoveryExpired", { expiry: formatDate(contact.recoveryExpiresAt) })
    }
    return null
  }

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: tc("all") },
    { key: "enabled", label: t("portalFilterEnabled") },
    { key: "registered", label: t("portalFilterRegistered") },
    { key: "pending", label: tc("pending") },
    { key: "disabled", label: t("portalFilterDisabled") },
  ]

  const allSelected = contacts.length > 0 && selected.size === contacts.length
  const selectedContacts = useMemo(() => contacts.filter((contact) => selected.has(contact.id)), [contacts, selected])

  const selectCheckbox = (contact: PortalContactRecord) => <SelectionCheckbox checked={selected.has(contact.id)} onChange={() => setSelected((current) => togglePortalSelection(current, contact.id))} ariaLabel={t("portalSelectUser", { name: contact.fullName })} testId="portal-user-select" />

  const accessButton = (contact: PortalContactRecord) => <Button variant="outline" size="sm" className="min-h-11" disabled={Boolean(busyAction) || !contact.isActive} onClick={() => contact.portalAccessEnabled ? setDisableDialog(contact) : void runAccessChange(contact, true).catch(() => {})} data-testid="portal-user-access">{contact.portalAccessEnabled ? <ShieldOff className="mr-2 h-4 w-4" /> : <Shield className="mr-2 h-4 w-4" />}{!contact.isActive ? t("portalCrmInactive") : t(contact.portalAccessEnabled ? "portalBtnDisable" : "portalBtnEnable")}</Button>

  const actionMenu = (contact: PortalContactRecord) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11" disabled={Boolean(busyAction)} aria-label={t("portalActionsFor", { name: contact.fullName })} data-testid="portal-user-menu" onFocus={(event) => { actionMenuTriggerRef.current = event.currentTarget }}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={() => openEditDialog(contact)} data-testid="portal-user-edit"><Pencil />{t("portalBtnEdit")}</DropdownMenuItem>
        {contact.isActive && contact.portalAccessEnabled && contact.email && <DropdownMenuItem className="min-h-11" onSelect={() => setResetDialog(contact)} data-testid="portal-user-recovery"><KeyRound />{t(contact.hasPassword ? "portalBtnResetPassword" : "portalBtnSendAccessLink")}</DropdownMenuItem>}
        {contact.isActive && contact.portalAccessEnabled && contact.email && <DropdownMenuItem className="min-h-11" onSelect={() => openManualPasswordDialog(contact)} data-testid="portal-user-manual-password"><Key />{t("portalBtnSetPassword")}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onSelect={() => setClearChatDialog(contact)} data-testid="portal-user-clear-chat"><MessageSquareX />{t("portalBtnClearChat")}</DropdownMenuItem>
        {(contact.portalAccessEnabled || contact.hasPassword) && <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => setRemoveDialog(contact)} data-testid="portal-user-remove"><UserMinus />{t("portalBtnRemove")}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <SupportPageShell
      data-testid="portal-users-workspace"
      data-state={initialLoading ? "loading" : loadError ? "error" : refreshing ? "refreshing" : "ready"}
      width="fluid"
      title={<span data-tour-id="portal-header">{t("portalUsers")}</span>}
      description={t("portalUsersDesc")}
      utilities={<><TourReplayButton tourId="portalUsers" className="min-h-11 px-2" /><HelpButton slug="portal-users" variant="label" className="min-h-11 shrink-0" /></>}
    >

      {notice && <div role="status" aria-live="polite" className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", notice.kind === "error" && "border-destructive/40 text-destructive")} data-testid="portal-users-notice" data-kind={notice.kind}>{notice.kind === "error" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{notice.text}</div>}

      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span><Users className="mr-1 inline h-3.5 w-3.5" /><strong className="text-foreground">{stats.totalWithEmail}</strong> {t("portalContactsWithEmail")}</span>
        <span><Shield className="mr-1 inline h-3.5 w-3.5" /><strong className="text-foreground">{stats.enabled}</strong> {t("portalAccessEnabled")}</span>
        <span><UserCheck className="mr-1 inline h-3.5 w-3.5" /><strong className="text-foreground">{stats.registered}</strong> {t("portalRegistered")}</span>
        <span><Clock className="mr-1 inline h-3.5 w-3.5" /><strong className="text-foreground">{stats.recentLogins}</strong> {t("portalRecentLogins")}</span>
      </div>

      <section aria-label={t("portalListControls")} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(14rem,1fr)_12rem]" data-testid="portal-users-controls">
        <Label className="relative"><span className="sr-only">{tc("search")}</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("portalSearchPlaceholder")} className="h-11 pl-9" maxLength={120} data-testid="portal-users-search" /></Label>
        <Label><span className="sr-only">{t("portalStatusFilter")}</span><Select value={filter} onChange={(event) => setFilter(event.target.value as FilterType)} className="h-11" data-testid="portal-users-filter">{filters.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</Select></Label>
        <div className="flex items-center justify-between gap-3 border-t pt-2 text-xs text-muted-foreground sm:col-span-2" data-testid="portal-users-scope" data-refreshing={refreshing ? "true" : "false"}><span>{refreshing ? t("portalRefreshing") : scope.truncated ? t("portalShowingFirst", { count: scope.shown }) : t("portalShowing", { count: scope.shown })}</span>{(searchInput || filter !== "all") && <Button variant="ghost" size="sm" className="min-h-10" onClick={() => { setSearchInput(""); setFilter("all") }} data-testid="portal-users-reset-filters">{t("portalResetFilters")}</Button>}</div>
      </section>

      {initialLoading ? <div aria-label={t("portalLoading")} className="space-y-2" data-testid="portal-users-loading">{[1,2,3,4].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg border bg-muted motion-reduce:animate-none" />)}</div>
        : loadError ? <div role="alert" className="rounded-lg border border-destructive/40 p-7 text-center" data-testid="portal-users-error" data-retryable={loadRetryable ? "true" : "false"}><AlertCircle className="mx-auto h-6 w-6 text-destructive" /><p className="mt-2 text-sm">{loadError}</p>{loadRetryable && <Button variant="outline" className="mt-4 min-h-11" onClick={() => setReloadToken((value) => value + 1)} data-testid="portal-users-retry">{t("portalRetry")}</Button>}</div>
        : contacts.length === 0 ? <div className="rounded-lg border p-8 text-center" data-testid="portal-users-empty" data-kind={debouncedSearch || filter !== "all" ? "filtered" : "contacts"}><Users className="mx-auto h-7 w-7 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">{debouncedSearch || filter !== "all" ? tc("noResults") : t("portalNoContacts")}</h2>{!debouncedSearch && filter === "all" && <><p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{t("portalNoContactsHint")}</p><Button asChild variant="outline" className="mt-4 min-h-11"><Link href="/contacts/list">{t("portalNoContactsAction")}</Link></Button></>}</div>
        : <>
          <div className="hidden min-w-0 overflow-hidden rounded-lg border xl:block" aria-busy={refreshing} data-testid="portal-users-desktop-table">
            <table className="w-full text-sm"><thead><tr className="border-b bg-muted/30"><th className="w-14 p-1"><SelectionCheckbox inputRef={desktopSelectAllRef} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : selectAllVisible(contacts))} ariaLabel={t("portalSelectAllVisible", { count: contacts.length })} testId="portal-users-select-all-desktop" /></th><th className="p-3 text-left font-medium">{tc("fullName")}</th><th className="p-3 text-left font-medium">{tc("company")}</th><th className="p-3 text-left font-medium">{t("portalStatus")}</th><th className="p-3 text-left font-medium">{t("portalLastLogin")}</th><th className="p-3 text-right font-medium">{tc("actions")}</th></tr></thead>
              <tbody>{contacts.map((contact) => <tr key={contact.id} className="border-b last:border-b-0" data-testid="portal-user-row" data-contact-id={contact.id} data-access-state={portalAccessState(contact)}><td className="p-3">{selectCheckbox(contact)}</td><td className="p-3"><strong className="block font-medium">{contact.fullName}</strong><span className="text-xs text-muted-foreground">{contact.email || t("portalNoEmail")}</span></td><td className="p-3 text-muted-foreground">{contact.companyName || "—"}</td><td className="p-3"><span className="text-xs font-medium">{stateLabel(contact)}</span>{recoveryHint(contact) && <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{recoveryHint(contact)}</span>}</td><td className="p-3 text-xs text-muted-foreground">{formatDate(contact.portalLastLoginAt)}</td><td className="p-3"><div className="flex items-center justify-end gap-1">{accessButton(contact)}{actionMenu(contact)}</div></td></tr>)}</tbody>
            </table>
          </div>

          <div className="min-w-0 space-y-2 xl:hidden" aria-busy={refreshing} data-testid="portal-users-mobile-list">
            <div className="flex min-h-11 items-center gap-1 rounded-lg border px-1 text-sm font-medium"><SelectionCheckbox inputRef={mobileSelectAllRef} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : selectAllVisible(contacts))} ariaLabel={t("portalSelectAllVisible", { count: contacts.length })} testId="portal-users-select-all-mobile" /><span>{t("portalSelectAllVisible", { count: contacts.length })}</span></div>
            {contacts.map((contact) => <article key={contact.id} className="rounded-lg border p-3" data-testid="portal-user-card" data-contact-id={contact.id} data-access-state={portalAccessState(contact)}><div className="flex items-start gap-3">{selectCheckbox(contact)}<div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{contact.fullName}</h2><p className="truncate text-xs text-muted-foreground">{contact.email || t("portalNoEmail")}</p></div>{actionMenu(contact)}</div><dl className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs"><div><dt className="text-muted-foreground">{tc("company")}</dt><dd className="mt-1 truncate">{contact.companyName || "—"}</dd></div><div><dt className="text-muted-foreground">{t("portalStatus")}</dt><dd className="mt-1 font-medium">{stateLabel(contact)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">{t("portalLastLogin")}</dt><dd className="mt-1">{formatDate(contact.portalLastLoginAt)}</dd></div>{recoveryHint(contact) && <div className="col-span-2 rounded border p-2"><dt className="sr-only">{t("portalRecoveryState")}</dt><dd>{recoveryHint(contact)}</dd></div>}</dl><div className="mt-3 flex justify-end">{accessButton(contact)}</div></article>)}
          </div>
        </>}

      {selected.size > 0 && <div role="region" aria-label={t("portalBulkToolbar")} className="sticky bottom-3 z-20 flex flex-col gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center" data-testid="portal-users-bulk"><div className="min-w-0 flex-1"><strong className="text-sm">{t("portalSelected", { count: selected.size })}</strong><p className="text-xs text-muted-foreground">{t("portalSelectionScope", { count: selectedContacts.length })}</p></div><Button variant="ghost" className="min-h-11" onClick={() => setSelected(new Set())} disabled={Boolean(busyAction)} data-testid="portal-users-clear-selection">{t("portalClearSelection")}</Button><Button variant="outline" className="min-h-11" onClick={() => void runBulkAction("enable").catch(() => {})} disabled={Boolean(busyAction)} data-testid="portal-users-bulk-enable"><Shield className="mr-2 h-4 w-4" />{t("portalEnableAccess")}</Button><Button variant="destructive" className="min-h-11" onClick={() => setBulkDisableOpen(true)} disabled={Boolean(busyAction)} data-testid="portal-users-bulk-disable"><ShieldOff className="mr-2 h-4 w-4" />{t("portalDisableAccess")}</Button></div>}

      <ConfirmDialog open={Boolean(resetDialog)} onOpenChange={(open) => { if (!open) { setResetDialog(null); restoreActionMenuFocus() } }} onConfirm={handleResetPassword} title={t("portalResetPasswordTitle")} description={t("portalResetPasswordDesc")} confirmLabel={t("portalResetPasswordBtn")} confirmVariant="default" loadingLabel={t("portalResetting")} />
      <ConfirmDialog open={Boolean(disableDialog)} onOpenChange={(open) => { if (!open) setDisableDialog(null) }} onConfirm={() => disableDialog ? runAccessChange(disableDialog, false) : Promise.resolve()} title={t("portalDisableTitle")} description={disableDialog ? t("portalDisableImpact", { name: disableDialog.fullName }) : ""} confirmLabel={t("portalBtnDisable")} loadingLabel={t("portalDisabling")} />
      <ConfirmDialog open={bulkDisableOpen} onOpenChange={setBulkDisableOpen} onConfirm={() => runBulkAction("disable")} title={t("portalBulkDisableTitle")} description={t("portalBulkDisableImpact", { count: selected.size })} confirmLabel={t("portalDisableAccess")} loadingLabel={t("portalDisabling")} />
      <ConfirmDialog open={Boolean(clearChatDialog)} onOpenChange={(open) => { if (!open) { setClearChatDialog(null); restoreActionMenuFocus() } }} onConfirm={handleClearChat} title={t("portalClearChatTitle")} description={t("portalClearChatDesc")} confirmLabel={t("portalClearChatBtn")} loadingLabel={t("portalClearing")} />
      <ConfirmDialog open={Boolean(removeDialog)} onOpenChange={(open) => { if (!open) { setRemoveDialog(null); restoreActionMenuFocus() } }} onConfirm={handleRemoveFromPortal} title={t("portalRemoveTitle")} description={t("portalRemoveDesc")} confirmLabel={t("portalRemoveBtn")} />

      <Dialog open={Boolean(editDialog)} onOpenChange={(open) => { if (!open && !savingEdit) { setEditDialog(null); restoreActionMenuFocus() } }}>
        <form onSubmit={handleSavePortalUser} data-testid="portal-user-edit-form"><DialogHeader><DialogTitle>{t("portalEditUser")}</DialogTitle><DialogDescription>{t("portalEditUserHint")}</DialogDescription></DialogHeader><DialogContent className="space-y-4">{editError && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{editError}</p>}<Label htmlFor="portal-user-name">{tc("fullName")}<Input id="portal-user-name" data-dialog-initial-focus value={editForm.fullName} onChange={(event) => setEditForm((form) => ({ ...form, fullName: event.target.value }))} required maxLength={200} className="mt-1 h-11" data-testid="portal-user-edit-name" /></Label><Label htmlFor="portal-user-email">{tc("email")}<Input id="portal-user-email" type="email" autoComplete="email" value={editForm.email} onChange={(event) => setEditForm((form) => ({ ...form, email: event.target.value }))} required={editForm.portalAccessEnabled} maxLength={320} className="mt-1 h-11" /></Label><Label htmlFor="portal-user-phone">{tc("phone")}<Input id="portal-user-phone" type="tel" autoComplete="tel" value={editForm.phone} onChange={(event) => setEditForm((form) => ({ ...form, phone: event.target.value }))} maxLength={50} className="mt-1 h-11" /></Label><div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3"><Label htmlFor="portal-access-switch">{t("portalAccessEnabled")}</Label><Switch id="portal-access-switch" checked={editForm.portalAccessEnabled} onCheckedChange={(checked) => setEditForm((form) => ({ ...form, portalAccessEnabled: checked }))} /></div>{editDialog?.hasPassword && editForm.email.trim().toLowerCase() !== (editDialog.email || "").trim().toLowerCase() && <p className="rounded-lg border p-3 text-xs leading-5">{t("portalEmailChangeWarning")}</p>}</DialogContent><DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => { setEditDialog(null); restoreActionMenuFocus() }} disabled={savingEdit}>{tc("cancel")}</Button><Button type="submit" className="min-h-11" disabled={savingEdit} data-testid="portal-user-edit-save">{savingEdit ? t("portalSaving") : t("portalEditSave")}</Button></DialogFooter></form>
      </Dialog>

      <Dialog open={Boolean(manualPasswordDialog)} onOpenChange={(open) => { if (!open && !savingManualPassword) { setManualPasswordDialog(null); restoreActionMenuFocus() } }}>
        <form onSubmit={handleSetManualPassword} data-testid="portal-user-password-form"><DialogHeader><DialogTitle>{t("portalManualPasswordTitle")}</DialogTitle><DialogDescription>{t("portalManualPasswordDesc")}</DialogDescription></DialogHeader><DialogContent className="space-y-4">{manualPasswordError && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{manualPasswordError}</p>}<Label htmlFor="portal-manual-password">{t("portalManualPasswordNew")}<Input id="portal-manual-password" data-dialog-initial-focus type="password" autoComplete="new-password" value={manualPassword} onChange={(event) => setManualPassword(event.target.value)} required minLength={12} maxLength={72} className="mt-1 h-11" data-testid="portal-user-password" /><span className="mt-1 block text-xs text-muted-foreground">{t("portalManualPasswordHint")}</span></Label><Label htmlFor="portal-manual-password-confirm">{t("portalManualPasswordConfirm")}<Input id="portal-manual-password-confirm" type="password" autoComplete="new-password" value={manualPasswordConfirmation} onChange={(event) => setManualPasswordConfirmation(event.target.value)} required minLength={12} maxLength={72} className="mt-1 h-11" data-testid="portal-user-password-confirm" /></Label><div className="flex min-h-11 items-center gap-1 rounded-lg border px-1 text-sm leading-5"><SelectionCheckbox id="portal-user-password-ack" checked={manualPasswordAcknowledged} onChange={() => setManualPasswordAcknowledged((current) => !current)} ariaLabel={t("portalManualPasswordAcknowledgement")} testId="portal-user-password-ack" /><Label htmlFor="portal-user-password-ack" className="py-3 pr-3">{t("portalManualPasswordAcknowledgement")}</Label></div></DialogContent><DialogFooter><Button type="button" variant="outline" className="min-h-11" onClick={() => { setManualPasswordDialog(null); restoreActionMenuFocus() }} disabled={savingManualPassword}>{tc("cancel")}</Button><Button type="submit" className="min-h-11" disabled={savingManualPassword} data-testid="portal-user-password-save">{savingManualPassword ? t("portalManualPasswordSaving") : t("portalManualPasswordSave")}</Button></DialogFooter></form>
      </Dialog>
    </SupportPageShell>
  )
}
