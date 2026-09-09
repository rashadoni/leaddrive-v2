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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

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
      fetch("/api/v1/mtm/agents?limit=200", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(json => { if (json.success) setManagers(json.data.agents || []) })
        .catch(() => {})
    }
  }, [open, initialData, orgId])

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
              <Label htmlFor="password">{isEdit ? tf("newPassword") : tf("password")} {!isEdit && "*"}</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={e => update("password", e.target.value)}
                placeholder={isEdit ? tf("leaveEmptyToKeep") : tf("minSixChars")}
                minLength={isEdit ? undefined : 12}
                maxLength={72}
                required={!isEdit}
              />
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
