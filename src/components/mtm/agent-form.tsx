"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"

interface AgentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: AgentData
  orgId?: string
}

interface AgentData {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  externalCode?: string | null
  role?: string | null
  status?: string | null
  canPlanOwnRoutes?: boolean | null
  canSelfPublishRoutes?: boolean | null
  managerId?: string | null
}

interface ManagerOption {
  id: string
  name: string
}

export function MtmAgentForm({ open, onOpenChange, onSaved, initialData, orgId }: AgentFormProps) {
  const tc = useTranslations("common")
  const tf = useTranslations("mtmForms")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    externalCode: "",
    password: "",
    role: "AGENT",
    status: "ACTIVE",
    canPlanOwnRoutes: true,
    canSelfPublishRoutes: false,
    managerId: "",
  })
  const [managers, setManagers] = useState<ManagerOption[]>([])
  // Shown in clear by default. The manager sets this password for someone else
  // and has to hand it over, so what is saved must be what they can read: on
  // 2026-10-06 a manager set an agent's password twice behind the dots and the
  // phone was refused both times — the card held something else, and nothing on
  // the screen could show it.
  const [passwordHidden, setPasswordHidden] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  // Self-publishing needs two things: this card's tick and the organization's
  // switch. The switch lived on another page and the tick alone did nothing,
  // silently (owner, 2026-10-06: settings «должны быть интуитивные, а не
  // прятаться где-то»). The form now reads the switch, says under the tick
  // whether it works, and can turn the switch on from here. `null` = not read.
  const [companySelfPublish, setCompanySelfPublish] = useState<boolean | null>(null)
  const [enablingCompany, setEnablingCompany] = useState(false)
  const [companyError, setCompanyError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        name: initialData?.name || "",
        email: initialData?.email || "",
        phone: initialData?.phone || "",
        externalCode: initialData?.externalCode || "",
        password: "",
        role: initialData?.role || "AGENT",
        status: initialData?.status || "ACTIVE",
        canPlanOwnRoutes: initialData?.canPlanOwnRoutes ?? true,
        canSelfPublishRoutes: initialData?.canSelfPublishRoutes ?? false,
        managerId: initialData?.managerId || "",
      })
      setError("")
      setPasswordHidden(false)
      setCompanySelfPublish(null)
      setCompanyError("")
      fetch("/api/v1/mtm/agents?limit=200", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(json => { if (json.success) setManagers(json.data.agents || []) })
        .catch(() => {})
      fetch("/api/v1/mtm/settings", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(json => {
          const value = json?.data?.routeSelfPublish
          if (typeof value === "boolean") setCompanySelfPublish(value)
        })
        .catch(() => {})
    }
  }, [open, initialData, orgId])

  const enableCompanySelfPublish = async () => {
    setEnablingCompany(true)
    setCompanyError("")
    try {
      const res = await fetch("/api/v1/mtm/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({ routeSelfPublish: true }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : String(res.status))
      setCompanySelfPublish(true)
    } catch (err: unknown) {
      setCompanyError(tf("selfPublishCompanyFailed", { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      setEnablingCompany(false)
    }
  }

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/mtm/agents/${initialData!.id}` : "/api/v1/mtm/agents"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          ...form,
          managerId: form.managerId || null,
          password: form.password || undefined, // only send if not empty
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tc("failedToSave"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editAgent") : tf("addAgent")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">{`${tc("name")} *`}</Label>
              <Input id="name" value={form.name} onChange={e => update("name", e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email">{tc("email")}</Label>
                <Input id="email" type="email" value={form.email} onChange={e => update("email", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="phone">{tc("phone")}</Label>
                <Input id="phone" value={form.phone} onChange={e => update("phone", e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="externalCode">{tf("externalCode")}</Label>
              <Input id="externalCode" value={form.externalCode} onChange={e => update("externalCode", e.target.value)} placeholder={tf("externalCodeHint")} />
            </div>
            <div>
              <Label htmlFor="agent-password">{isEdit ? tf("newPassword") : tf("password")} {!isEdit && "*"}</Label>
              <div className="relative">
                {/* Not `id="password"` beside an email field: that is a sign-in
                    form to a browser, which then offers — or fills in — the
                    manager's own saved password. `new-password` says this is a
                    credential being set; in clear it is an ordinary field the
                    browser must not remember. */}
                <Input
                  id="agent-password"
                  name="agent-new-password"
                  type={passwordHidden ? "password" : "text"}
                  value={form.password}
                  onChange={e => update("password", e.target.value)}
                  placeholder={isEdit ? tf("leaveEmptyToKeep") : tf("minSixChars")}
                  minLength={isEdit ? undefined : 12}
                  maxLength={72}
                  required={!isEdit}
                  autoComplete={passwordHidden ? "new-password" : "off"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="pr-24"
                />
                <button
                  type="button"
                  onClick={() => setPasswordHidden(hidden => !hidden)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {passwordHidden ? tf("showPassword") : tf("hidePassword")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{tf("passwordHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="role">{tf("role")}</Label>
                <Select value={form.role} onChange={e => update("role", e.target.value)}>
                  <option value="AGENT">{tf("roleAgent")}</option>
                  <option value="SUPERVISOR">{tf("roleSupervisor")}</option>
                  <option value="MANAGER">{tf("roleManager")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={e => update("status", e.target.value)}>
                  <option value="ACTIVE">{tc("active")}</option>
                  <option value="INACTIVE">{tc("inactive")}</option>
                  <option value="SUSPENDED">{tf("suspended")}</option>
                </Select>
              </div>
            </div>
            {form.role === "AGENT" ? (
              <div className="grid gap-3">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                  <input
                    id="canPlanOwnRoutes"
                    className="mt-0.5 h-5 w-5 accent-primary"
                    type="checkbox"
                    checked={form.canPlanOwnRoutes}
                    onChange={(event) => setForm((current) => ({ ...current, canPlanOwnRoutes: event.target.checked }))}
                  />
                  <span>
                    <span className="block font-medium">{tf("allowSelfRoutePlanning")}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{tf("allowSelfRoutePlanningHint")}</span>
                  </span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                  <input
                    id="canSelfPublishRoutes"
                    className="mt-0.5 h-5 w-5 accent-primary"
                    type="checkbox"
                    checked={form.canSelfPublishRoutes}
                    onChange={(event) => setForm((current) => ({ ...current, canSelfPublishRoutes: event.target.checked }))}
                  />
                  <span>
                    <span className="block font-medium">{tf("allowSelfRoutePublish")}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{tf("allowSelfRoutePublishHint")}</span>
                  </span>
                </label>
                {form.canSelfPublishRoutes && companySelfPublish === false ? (
                  <div
                    className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
                    data-testid="mtm-agent-self-publish-company-off"
                    role="status"
                  >
                    <p className="font-medium">{tf("selfPublishCompanyOffTitle")}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{tf("selfPublishCompanyOffBody")}</p>
                    <Button type="button" size="sm" className="mt-2" disabled={enablingCompany} onClick={enableCompanySelfPublish}>
                      {enablingCompany ? tc("saving") : tf("selfPublishCompanyEnable")}
                    </Button>
                    {companyError && <p className="mt-2 text-xs text-red-500">{companyError}</p>}
                  </div>
                ) : null}
                {form.canSelfPublishRoutes && companySelfPublish === true ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300" data-testid="mtm-agent-self-publish-company-on">
                    {tf("selfPublishCompanyOn")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div>
              <Label htmlFor="managerId">{tf("manager")}</Label>
              <Select value={form.managerId} onChange={e => update("managerId", e.target.value)}>
                <option value="">{tf("noManager")}</option>
                {managers.filter(m => m.id !== initialData?.id).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
