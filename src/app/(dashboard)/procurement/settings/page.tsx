"use client"

/**
 * Approval limits of purchase orders (task 3.4): bands of the order total and,
 * for each, the approvers in order. An administrator edits; everyone in
 * purchasing sees who will decide.
 */
import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Loader2, Plus, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isAdmin, type Role } from "@/lib/permissions"
import { APPROVER_ROLES } from "@/lib/procurement/approval"

type Approver = { role: string } | { userId: string }
type Band = { minAmount: string; maxAmount: string; approvers: Approver[] }
type Person = { id: string; name: string; role: string }

export default function ProcurementSettingsPage() {
  const t = useTranslations("procurement.approvalSettings")
  const tc = useTranslations("procurement.common")
  const tr = useTranslations("procurement.common.role")
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || "viewer") as Role
  const canEdit = isAdmin(role)

  const [bands, setBands] = useState<Band[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/procurement/settings")
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      setPeople(body.data.people ?? [])
      setBands((body.data.approvalRules ?? []).map((rule: { minAmount: number; maxAmount: number | null; approvers: Approver[] }) => ({
        minAmount: String(rule.minAmount),
        maxAmount: rule.maxAmount === null ? "" : String(rule.maxAmount),
        approvers: rule.approvers,
      })))
    } catch {
      toast.error(tc("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [tc])

  useEffect(() => { void load() }, [load])

  const update = (index: number, patch: Partial<Band>) => setBands((all) => all.map((band, i) => (i === index ? { ...band, ...patch } : band)))
  const approverValue = (approver: Approver) => ("role" in approver ? `role:${approver.role}` : `user:${approver.userId}`)
  const parseApprover = (value: string): Approver => (value.startsWith("user:") ? { userId: value.slice(5) } : { role: value.slice(5) })

  const save = async () => {
    const approvalRules = bands.map((band) => ({
      minAmount: Number(band.minAmount || 0),
      maxAmount: band.maxAmount.trim() === "" ? null : Number(band.maxAmount),
      approvers: band.approvers,
    }))
    setSaving(true)
    try {
      const res = await fetch("/api/v1/procurement/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalRules }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body?.error === "bands overlap" ? t("overlap") : body?.error || tc("saveFailed")); return }
      toast.success(tc("saved"))
      void load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-orange-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>
      {!canEdit && <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>}

      <div className="space-y-4">
        {bands.map((band, index) => (
          <div key={index} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`band-min-${index}`}>{t("from")}</Label>
                <Input id={`band-min-${index}`} className="w-40" type="number" min="0" disabled={!canEdit} value={band.minAmount} onChange={(e) => update(index, { minAmount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`band-max-${index}`}>{t("to")}</Label>
                <Input id={`band-max-${index}`} className="w-40" type="number" min="0" disabled={!canEdit} value={band.maxAmount} onChange={(e) => update(index, { maxAmount: e.target.value })} />
              </div>
              {canEdit && <Button type="button" variant="ghost" onClick={() => setBands((all) => all.filter((_, i) => i !== index))}>{t("removeBand")}</Button>}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("approvers")}</p>
              {band.approvers.map((approver, step) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="w-5 text-sm text-muted-foreground">{step + 1}.</span>
                  <select
                    aria-label={t("approvers")}
                    className="h-9 min-w-[16rem] rounded-md border bg-background px-3 text-sm"
                    disabled={!canEdit}
                    value={approverValue(approver)}
                    onChange={(e) => update(index, { approvers: band.approvers.map((a, i) => (i === step ? parseApprover(e.target.value) : a)) })}
                  >
                    {APPROVER_ROLES.map((r) => <option key={r} value={`role:${r}`}>{tr(r)}</option>)}
                    {people.map((person) => <option key={person.id} value={`user:${person.id}`}>{t("person")}: {person.name}</option>)}
                  </select>
                  {canEdit && band.approvers.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t("removeBand")} onClick={() => update(index, { approvers: band.approvers.filter((_, i) => i !== step) })}><X className="h-4 w-4" /></Button>
                  )}
                </div>
              ))}
              {canEdit && band.approvers.length < 5 && (
                <Button type="button" variant="outline" size="sm" onClick={() => update(index, { approvers: [...band.approvers, { role: "manager" }] })}><Plus className="mr-1 h-4 w-4" />{t("addApprover")}</Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setBands((all) => [...all, { minAmount: all.length ? all[all.length - 1].maxAmount || "0" : "0", maxAmount: "", approvers: [{ role: "manager" }] }])}>
            <Plus className="mr-1 h-4 w-4" />{t("addBand")}
          </Button>
          <Button type="button" onClick={save} disabled={saving}>{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tc("saving")}</> : tc("save")}</Button>
        </div>
      )}
    </div>
  )
}
