"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Archive, CircleAlert, Loader2, Search, Send, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export type EditableMtmWorkplace = {
  id: string
  customerId?: string
  jobTitle: string | null
  department: string | null
  room: string | null
  phone: string | null
  isPrimary: boolean
  startedOn: string | null
  endedOn: string | null
  updatedAt: string
  customer: {
    id: string
    code: string | null
    name: string
    address: string | null
    city: string | null
    district: string | null
  }
}

type OrganizationOption = {
  id: string
  code: string | null
  name: string
  address: string | null
  city: string | null
  district: string | null
}

type FormState = {
  customerId: string
  jobTitle: string
  department: string
  room: string
  phone: string
  isPrimary: boolean
  startedOn: string
  endedOn: string
}

function dateValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ""
}

function formFromWorkplace(workplace: EditableMtmWorkplace | null): FormState {
  return {
    customerId: workplace?.customer.id ?? "",
    jobTitle: workplace?.jobTitle ?? "",
    department: workplace?.department ?? "",
    room: workplace?.room ?? "",
    phone: workplace?.phone ?? "",
    isPrimary: workplace?.isPrimary ?? false,
    startedOn: dateValue(workplace?.startedOn),
    endedOn: dateValue(workplace?.endedOn),
  }
}

function operationKey(prefix: string): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === "function") return `${prefix}-${cryptoApi.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function organizationLabel(organization: OrganizationOption): string {
  const place = [organization.city, organization.district].filter(Boolean).join(", ")
  return [organization.name, organization.code, place].filter(Boolean).join(" · ")
}

export function MtmContactWorkplaceDialog({
  open,
  onOpenChange,
  contactId,
  contactUpdatedAt,
  workplace,
  canManage,
  canRequestChanges,
  orgId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  contactUpdatedAt: string
  workplace: EditableMtmWorkplace | null
  canManage: boolean
  canRequestChanges: boolean
  orgId?: string
  onSaved: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactWorkplace")
  const initialForm = useMemo(() => formFromWorkplace(workplace), [workplace])
  const [form, setForm] = useState<FormState>(initialForm)
  const [reason, setReason] = useState("")
  const [search, setSearch] = useState("")
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submission = useRef<{ body: string; key: string } | null>(null)
  const requestMode = !canManage && canRequestChanges

  const headers = useMemo<Record<string, string>>(
    () => orgId ? { "x-organization-id": orgId } : {},
    [orgId],
  )

  const loadOrganizations = useCallback(async (query: string) => {
    setSearching(true)
    setError("")
    try {
      const params = new URLSearchParams({ page: "1", limit: "50", sort: "name", direction: "asc" })
      if (query.trim()) params.set("search", query.trim())
      const response = await fetch(`/api/v1/mtm/organizations?${params}`, { headers })
      const result = await response.json() as {
        success?: boolean
        error?: string
        data?: { organizations?: OrganizationOption[] }
      }
      if (!response.ok || !result.success) throw new Error(result.error || t("organizationSearchError"))
      const found = result.data?.organizations ?? []
      const current = workplace?.customer
      setOrganizations(current && !found.some((item) => item.id === current.id)
        ? [current, ...found]
        : found)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : t("organizationSearchError"))
    } finally {
      setSearching(false)
    }
  }, [headers, t, workplace?.customer])

  useEffect(() => {
    if (!open) return
    setForm(initialForm)
    setReason("")
    setSearch("")
    setError("")
    setSaving(false)
    submission.current = null
    void loadOrganizations("")
  }, [initialForm, loadOrganizations, open])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.customerId) {
      setError(t("organizationRequired"))
      return
    }
    if (form.startedOn && form.endedOn && form.startedOn > form.endedOn) {
      setError(t("dateOrderError"))
      return
    }
    if (requestMode && reason.trim().length < 3) {
      setError(t("reasonRequired"))
      return
    }

    const payload = {
      ...(workplace ? { id: workplace.id, expectedUpdatedAt: workplace.updatedAt } : {}),
      customerId: form.customerId,
      jobTitle: form.jobTitle.trim() || null,
      department: form.department.trim() || null,
      room: form.room.trim() || null,
      phone: form.phone.trim() || null,
      isPrimary: form.endedOn ? false : form.isPrimary,
      startedOn: form.startedOn || null,
      endedOn: form.endedOn || null,
    }

    setSaving(true)
    setError("")
    try {
      let url = `/api/v1/mtm/contacts/${contactId}/workplaces`
      let body: Record<string, unknown> = payload
      let method = "PUT"
      if (requestMode) {
        url = `/api/v1/mtm/contacts/${contactId}/change-requests`
        method = "POST"
        const stableBody = JSON.stringify({
          expectedContactUpdatedAt: contactUpdatedAt,
          kind: "WORKPLACE_UPSERT",
          payload,
          reason: reason.trim(),
        })
        if (!submission.current || submission.current.body !== stableBody) {
          submission.current = { body: stableBody, key: operationKey("workplace") }
        }
        body = {
          idempotencyKey: submission.current.key,
          expectedContactUpdatedAt: contactUpdatedAt,
          kind: "WORKPLACE_UPSERT",
          payload,
          reason: reason.trim(),
        }
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
      const result = await response.json() as { error?: string; code?: string }
      if (!response.ok) {
        if (result.code === "MTM_WORKPLACE_CONFLICT" || result.code === "MTM_CONTACT_CONFLICT") {
          throw new Error(t("conflictError"))
        }
        if (result.code === "MTM_WORKPLACE_DUPLICATE") throw new Error(t("duplicateError"))
        throw new Error(result.error || t("saveError"))
      }

      await onSaved()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  const selectedOrganization = organizations.find((item) => item.id === form.customerId)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }} widthClassName="max-w-3xl" maxHeightClassName="max-h-[92vh]">
      <DialogHeader>
        <DialogTitle>{workplace ? t(requestMode ? "requestEditTitle" : "editTitle") : t(requestMode ? "requestAddTitle" : "addTitle")}</DialogTitle>
        <DialogDescription>{requestMode ? t("requestDescription") : t("manageDescription")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <DialogContent className="space-y-5">
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 flex-none" />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="workplace-organization-search">{t("organizationSearch")}</Label>
              <div className="flex gap-2">
                <Input
                  id="workplace-organization-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("organizationSearchPlaceholder")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void loadOrganizations(search)
                    }
                  }}
                />
                <Button type="button" variant="outline" className="min-h-11" disabled={searching} onClick={() => void loadOrganizations(search)}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="hidden sm:inline">{t("search")}</span>
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="workplace-organization">{t("organization")} <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Select id="workplace-organization" value={form.customerId} onChange={(event) => update("customerId", event.target.value)} required>
                <option value="">{searching ? t("searching") : t("chooseOrganization")}</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>{organizationLabel(organization)}</option>
                ))}
              </Select>
              {selectedOrganization ? (
                <p className="text-xs text-muted-foreground">{selectedOrganization.address || t("organizationAddressMissing")}</p>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="workplace-job-title">{t("jobTitle")}</Label><Input id="workplace-job-title" value={form.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} maxLength={500} /></div>
            <div className="grid gap-1.5"><Label htmlFor="workplace-department">{t("department")}</Label><Input id="workplace-department" value={form.department} onChange={(event) => update("department", event.target.value)} maxLength={500} /></div>
            <div className="grid gap-1.5"><Label htmlFor="workplace-room">{t("room")}</Label><Input id="workplace-room" value={form.room} onChange={(event) => update("room", event.target.value)} maxLength={500} /></div>
            <div className="grid gap-1.5"><Label htmlFor="workplace-phone">{t("phone")}</Label><Input id="workplace-phone" type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} maxLength={500} /></div>
            <div className="grid gap-1.5"><Label htmlFor="workplace-started-on">{t("startedOn")}</Label><Input id="workplace-started-on" type="date" value={form.startedOn} onChange={(event) => update("startedOn", event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="workplace-ended-on">{t("endedOn")}</Label><Input id="workplace-ended-on" type="date" value={form.endedOn} onChange={(event) => { update("endedOn", event.target.value); if (event.target.value) update("isPrimary", false) }} /></div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-3 text-sm font-medium dark:border-zinc-700 sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.isPrimary} disabled={Boolean(form.endedOn)} onChange={(event) => update("isPrimary", event.target.checked)} />
              <span>{t("primary")}</span>
            </label>
          </section>

          {requestMode ? (
            <div className="grid gap-1.5">
              <Label htmlFor="workplace-reason">{t("reason")} <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Textarea id="workplace-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required placeholder={t("reasonPlaceholder")} />
            </div>
          ) : null}
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" disabled={saving || (!canManage && !canRequestChanges)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : requestMode ? <Send className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? t("saving") : requestMode ? t("sendRequest") : t("save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

export function MtmContactWorkplaceEndDialog({
  open,
  onOpenChange,
  contactId,
  contactUpdatedAt,
  workplace,
  endedOn,
  canManage,
  canRequestChanges,
  orgId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactId: string
  contactUpdatedAt: string
  workplace: EditableMtmWorkplace | null
  endedOn: string
  canManage: boolean
  canRequestChanges: boolean
  orgId?: string
  onSaved: () => Promise<void> | void
}) {
  const t = useTranslations("mtmContactWorkplace")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const submission = useRef<{ body: string; key: string } | null>(null)
  const requestMode = !canManage && canRequestChanges

  useEffect(() => {
    if (!open) return
    setReason("")
    setSaving(false)
    setError("")
    submission.current = null
  }, [open])

  const submit = async () => {
    if (!workplace) return
    if (requestMode && reason.trim().length < 3) {
      setError(t("reasonRequired"))
      return
    }
    setSaving(true)
    setError("")
    try {
      let url = `/api/v1/mtm/contacts/${contactId}/workplaces/${workplace.id}`
      let method = "DELETE"
      let body: Record<string, unknown> | undefined
      if (requestMode) {
        url = `/api/v1/mtm/contacts/${contactId}/change-requests`
        method = "POST"
        const stableBody = JSON.stringify({
          expectedContactUpdatedAt: contactUpdatedAt,
          kind: "WORKPLACE_END",
          payload: { workplaceId: workplace.id, endedOn },
          reason: reason.trim(),
        })
        if (!submission.current || submission.current.body !== stableBody) {
          submission.current = { body: stableBody, key: operationKey("workplace-end") }
        }
        body = {
          idempotencyKey: submission.current.key,
          expectedContactUpdatedAt: contactUpdatedAt,
          kind: "WORKPLACE_END",
          payload: { workplaceId: workplace.id, endedOn },
          reason: reason.trim(),
        }
      }
      const response = await fetch(url, {
        method,
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(orgId ? { "x-organization-id": orgId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const result = await response.json() as { error?: string; code?: string }
      if (!response.ok) {
        if (result.code === "MTM_WORKPLACE_CONFLICT" || result.code === "MTM_CONTACT_CONFLICT") throw new Error(t("conflictError"))
        throw new Error(result.error || t("endError"))
      }
      await onSaved()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("endError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogHeader>
        <DialogTitle>{requestMode ? t("requestEndTitle") : t("endTitle")}</DialogTitle>
        <DialogDescription>{t(requestMode ? "requestEndDescription" : "endDescription", { organization: workplace?.customer.name ?? "" })}</DialogDescription>
      </DialogHeader>
      <DialogContent className="space-y-4">
        {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 h-4 w-4 flex-none" /><span>{error}</span></div> : null}
        <div className="rounded-xl border border-zinc-200 bg-muted/35 p-4 dark:border-zinc-700">
          <p className="font-medium">{workplace?.customer.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("endDate", { date: endedOn })}</p>
        </div>
        {requestMode ? (
          <div className="grid gap-1.5">
            <Label htmlFor="workplace-end-reason">{t("reason")} <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Textarea id="workplace-end-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required placeholder={t("reasonPlaceholder")} />
          </div>
        ) : null}
      </DialogContent>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
        <Button type="button" variant="destructive" disabled={saving || !workplace} onClick={() => void submit()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : requestMode ? <Send className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {saving ? t("saving") : requestMode ? t("sendRequest") : t("endWorkplace")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
