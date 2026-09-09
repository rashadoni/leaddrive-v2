"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, DatabaseZap, FileJson2, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type PackageStatus = "DRAFT" | "ACTIVE" | "RETIRED"
type AttributePackage = {
  id: string
  version: number
  rowsHash: string
  rowCount: number
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
  effectiveFrom: string
  status: PackageStatus
  approvalReference: string | null
  signedAt: string | null
  retiredAt: string | null
}

const SAMPLE_ROWS = JSON.stringify([
  {
    organizationCode: "3799",
    medicalCategory: { code: "A", labels: { ru: "Категория A", az: "A kateqoriyası", en: "Category A" } },
    license: { status: "LICENSED", labels: { ru: "Лицензия подтверждена", az: "Lisenziya təsdiqlənib", en: "License confirmed" } },
    polygon: { code: "BAKU-01", labels: { ru: "Баку 01", az: "Bakı 01", en: "Baku 01" } },
  },
], null, 2)

function statusVariant(status: PackageStatus): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success"
  if (status === "DRAFT") return "warning"
  return "outline"
}

export function OrganizationAttributePackageSettings() {
  const t = useTranslations("mtmOrganizationAttributes")
  const [packages, setPackages] = useState<AttributePackage[]>([])
  const [canConfigure, setCanConfigure] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [activation, setActivation] = useState<AttributePackage | null>(null)
  const [approvalReference, setApprovalReference] = useState("")
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    version: "1",
    rows: SAMPLE_ROWS,
    sourceSystem: "",
    sourceReference: "",
    sourceObservedAt: "",
    effectiveFrom: "",
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/organization-attribute-packages", { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null) as {
        success?: boolean
        error?: string
        data?: { packages?: AttributePackage[]; capabilities?: { canConfigure?: boolean } }
      } | null
      if (!response.ok || !body?.success) throw new Error(body?.error || t("loadFailed"))
      setPackages(body.data?.packages ?? [])
      setCanConfigure(Boolean(body.data?.capabilities?.canConfigure))
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const ordered = useMemo(() => {
    const rank: Record<PackageStatus, number> = { ACTIVE: 0, DRAFT: 1, RETIRED: 2 }
    return [...packages].sort((left, right) => rank[left.status] - rank[right.status] || right.version - left.version)
  }, [packages])

  const importFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError(t("fileTooLarge"))
      return
    }
    try {
      const rows = await file.text()
      setForm((current) => ({ ...current, rows }))
      setError("")
    } catch {
      setError(t("fileReadFailed"))
    }
  }

  const createDraft = async () => {
    setError("")
    let rows: unknown
    try {
      rows = JSON.parse(form.rows)
    } catch {
      setError(t("invalidJson"))
      return
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      setError(t("rowsRequired"))
      return
    }
    const observed = new Date(form.sourceObservedAt)
    if (Number.isNaN(observed.getTime())) {
      setError(t("observedRequired"))
      return
    }
    setBusy("create")
    try {
      const response = await fetch("/api/v1/mtm/organization-attribute-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          version: Number(form.version),
          rows,
          sourceSystem: form.sourceSystem.trim(),
          sourceReference: form.sourceReference.trim() || undefined,
          sourceObservedAt: observed.toISOString(),
          effectiveFrom: form.effectiveFrom,
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string; unknownOrganizationCodes?: string[] } | null
      if (!response.ok) {
        const unknown = body?.unknownOrganizationCodes?.join(", ")
        throw new Error(unknown ? `${body?.error}: ${unknown}` : body?.error || t("createFailed"))
      }
      toast.success(t("created"))
      setShowCreate(false)
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("createFailed"))
    } finally {
      setBusy("")
    }
  }

  const activate = async () => {
    if (!activation || approvalReference.trim().length < 3) return
    setBusy(`activate:${activation.id}`)
    try {
      const response = await fetch(`/api/v1/mtm/organization-attribute-packages/${activation.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ expectedRowsHash: activation.rowsHash, approvalReference: approvalReference.trim() }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || t("activateFailed"))
      toast.success(t("activated", { version: activation.version }))
      setActivation(null)
      setApprovalReference("")
      await load()
    } catch (activationError) {
      toast.error(activationError instanceof Error ? activationError.message : t("activateFailed"))
    } finally {
      setBusy("")
    }
  }

  return (
    <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold"><DatabaseZap className="h-4 w-4 text-muted-foreground" />{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("refresh")}</Button>
          {canConfigure ? <Button type="button" size="sm" className="min-h-11 sm:min-h-8" onClick={() => { setError(""); setShowCreate((open) => !open) }}><FileJson2 className="mr-1 h-4 w-4" />{t("newPackage")}</Button> : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/20 dark:text-sky-100">
        <p className="font-medium">{t("governanceTitle")}</p><p className="mt-0.5 text-xs leading-relaxed opacity-80">{t("governanceDescription")}</p>
      </div>

      {showCreate && canConfigure ? (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><Label htmlFor="org-attribute-version">{t("version")}</Label><Input id="org-attribute-version" type="number" min="1" max="1000000" className="mt-1.5 min-h-11" value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} /></div>
            <div><Label htmlFor="org-attribute-source">{t("sourceSystem")}</Label><Input id="org-attribute-source" className="mt-1.5 min-h-11" maxLength={120} value={form.sourceSystem} onChange={(event) => setForm((current) => ({ ...current, sourceSystem: event.target.value }))} /></div>
            <div><Label htmlFor="org-attribute-reference">{t("sourceReference")}</Label><Input id="org-attribute-reference" className="mt-1.5 min-h-11" maxLength={500} value={form.sourceReference} onChange={(event) => setForm((current) => ({ ...current, sourceReference: event.target.value }))} /></div>
            <div><Label htmlFor="org-attribute-observed">{t("sourceObservedAt")}</Label><Input id="org-attribute-observed" type="datetime-local" className="mt-1.5 min-h-11" value={form.sourceObservedAt} onChange={(event) => setForm((current) => ({ ...current, sourceObservedAt: event.target.value }))} /></div>
            <div><Label htmlFor="org-attribute-effective">{t("effectiveFrom")}</Label><Input id="org-attribute-effective" type="date" className="mt-1.5 min-h-11" value={form.effectiveFrom} onChange={(event) => setForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></div>
            <div><Label htmlFor="org-attribute-file">{t("jsonFile")}</Label><Input id="org-attribute-file" type="file" accept="application/json,.json" className="mt-1.5 min-h-11" onChange={(event) => void importFile(event.target.files?.[0])} /></div>
          </div>
          <div className="mt-4"><Label htmlFor="org-attribute-rows">{t("rows")}</Label><p className="mt-1 text-xs text-muted-foreground">{t("rowsHint")}</p><Textarea id="org-attribute-rows" rows={14} spellCheck={false} className="mt-2 resize-y font-mono text-xs" value={form.rows} onChange={(event) => setForm((current) => ({ ...current, rows: event.target.value }))} /></div>
          {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">{error}</p> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" disabled={Boolean(busy)} onClick={() => setShowCreate(false)}>{t("cancel")}</Button><Button disabled={Boolean(busy)} onClick={() => void createDraft()}>{busy === "create" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileJson2 className="mr-1 h-4 w-4" />}{t("createDraft")}</Button></div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {ordered.map((pkg) => (
          <article key={pkg.id} className={`rounded-lg border p-4 ${pkg.status === "ACTIVE" ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/15" : "border-zinc-200 bg-card dark:border-zinc-700"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{t("packageVersion", { version: pkg.version })}</h3><Badge variant={statusVariant(pkg.status)}>{t(`statuses.${pkg.status}`)}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{t("rowCount", { count: pkg.rowCount })} · {pkg.sourceSystem}</p></div>{canConfigure && pkg.status === "DRAFT" ? <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => { setActivation(pkg); setApprovalReference("") }}><ShieldCheck className="mr-1 h-4 w-4" />{t("activate")}</Button> : null}</div>
            <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">{t("effectiveFrom")}</dt><dd className="font-medium">{pkg.effectiveFrom.slice(0, 10)}</dd></div><div><dt className="text-muted-foreground">{t("approval")}</dt><dd className="break-words font-medium">{pkg.approvalReference || "—"}</dd></div></dl>
            <p className="mt-3 break-all border-t border-zinc-200 pt-3 font-mono text-[10px] text-muted-foreground dark:border-zinc-700">SHA-256: {pkg.rowsHash}</p>
          </article>
        ))}
        {!loading && ordered.length === 0 ? <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-muted-foreground dark:border-zinc-700">{t("empty")}</div> : null}
      </div>

      {activation ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="font-semibold">{t("activationTitle", { version: activation.version })}</h3><p className="mt-1 text-sm">{t("activationWarning")}</p><p className="mt-2 break-all font-mono text-[10px]">{activation.rowsHash}</p><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto]"><div><Label htmlFor="org-attribute-approval">{t("approvalReference")}</Label><Input id="org-attribute-approval" className="mt-1.5 min-h-11" maxLength={500} value={approvalReference} onChange={(event) => setApprovalReference(event.target.value)} /></div><Button variant="ghost" className="min-h-11 self-end" disabled={Boolean(busy)} onClick={() => setActivation(null)}>{t("cancel")}</Button><Button className="min-h-11 self-end" disabled={Boolean(busy) || approvalReference.trim().length < 3} onClick={() => void activate()}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}{t("confirmActivation")}</Button></div></div></div>
        </div>
      ) : null}
    </section>
  )
}
