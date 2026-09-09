"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { FileJson2, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type Policy = {
  id: string; code: string; version: number; nameRu: string;
  status: "DRAFT" | "ACTIVE" | "RETIRED"; definitionHash: string;
  sourceSystem: string; effectiveFrom: string; effectiveTo: string | null;
  approvalReference: string | null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function errorText(value: unknown, fallback: string): string {
  const item = record(value); return item && typeof item.error === "string" ? item.error : fallback
}

export function KpiPolicyAdmin() {
  const t = useTranslations("mtmKpiPolicyAdmin")
  const [policies, setPolicies] = useState<Policy[]>([])
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [json, setJson] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [activationId, setActivationId] = useState("")
  const [approval, setApproval] = useState("")

  const parsed = useMemo(() => {
    try { return record(JSON.parse(json)) } catch { return null }
  }, [json])
  const definition = parsed ? record(parsed.definition) : null
  const cases = definition && Array.isArray(definition.reconciliationCases) ? definition.reconciliationCases.length : 0
  const preview = parsed && definition && typeof parsed.code === "string" && typeof parsed.version === "number"
    && typeof definition.formulaVersion === "string" ? {
      code: parsed.code, version: parsed.version, formula: definition.formulaVersion,
      cases, effectiveFrom: typeof parsed.effectiveFrom === "string" ? parsed.effectiveFrom : "—",
    } : null
  const activation = policies.find((item) => item.id === activationId) ?? null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/kpi-policies", { cache: "no-store" })
      if (response.status === 403) { setHidden(true); return }
      const payload: unknown = await response.json().catch(() => null)
      const data = record(record(payload)?.data)
      if (!response.ok || !data || !Array.isArray(data.policies)) throw new Error(errorText(payload, t("loadFailed")))
      setPolicies(data.policies as Policy[])
    } catch (error) { toast.error(error instanceof Error ? error.message : t("loadFailed")) }
    finally { setLoading(false) }
  }, [t])
  useEffect(() => { void load() }, [load])

  async function chooseFile(file: File | undefined) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return toast.error(t("fileTooLarge"))
    const text = await file.text()
    try { if (!record(JSON.parse(text))) throw new Error() } catch { return toast.error(t("invalidJson")) }
    setJson(text); setConfirmed(false)
  }

  async function create() {
    if (!parsed || !preview || !confirmed) return
    setBusy("create")
    try {
      const response = await fetch("/api/v1/mtm/kpi-policies", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(errorText(payload, t("createFailed")))
      toast.success(t("created")); setJson(""); setConfirmed(false); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : t("createFailed")) }
    finally { setBusy("") }
  }

  async function activate() {
    if (!activation || approval.trim().length < 3) return
    setBusy("activate")
    try {
      const response = await fetch(`/api/v1/mtm/kpi-policies/${encodeURIComponent(activation.id)}/activate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedDefinitionHash: activation.definitionHash, approvalReference: approval.trim() }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(errorText(payload, t("activateFailed")))
      toast.success(t("activated")); setApproval(""); await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : t("activateFailed")) }
    finally { setBusy("") }
  }

  if (hidden) return null
  return <section className="rounded-lg border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="kpi-policy-title">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-700">
      <div><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 id="kpi-policy-title" className="font-semibold">{t("title")}</h2></div><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t("description")}</p></div>
      <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{t("refresh")}</Button>
    </div>
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
      <div className="space-y-3">
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 px-3 text-sm dark:border-zinc-700"><Upload className="h-4 w-4" />{t("chooseFile")}<input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>
        <Textarea value={json} onChange={(event) => { setJson(event.target.value); setConfirmed(false) }} rows={10} placeholder={t("jsonPlaceholder")} className="font-mono text-xs" />
        {preview ? <div className="rounded-md border border-zinc-200 bg-muted/30 p-3 text-xs dark:border-zinc-700"><div className="flex flex-wrap gap-2"><Badge variant="outline">{preview.code} v{preview.version}</Badge><Badge variant="outline">{preview.formula}</Badge><Badge variant={preview.cases > 0 ? "success" : "destructive"}>{t("cases", { count: preview.cases })}</Badge></div><p className="mt-2 text-muted-foreground">{t("effective", { date: preview.effectiveFrom })}</p></div> : json ? <p className="text-xs text-destructive">{t("invalidPackage")}</p> : null}
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("confirm")}</label>
        <Button type="button" onClick={() => void create()} disabled={!preview || !confirmed || busy !== ""}>{busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson2 className="h-4 w-4" />}{t("createDraft")}</Button>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("versions")}</h3>
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : policies.length ? <div className="max-h-80 space-y-2 overflow-auto">{policies.map((policy) => <button key={policy.id} type="button" onClick={() => setActivationId(policy.id)} className={`w-full rounded-md border p-3 text-left text-xs ${activationId === policy.id ? "border-primary" : "border-zinc-200 dark:border-zinc-700"}`}><div className="flex items-center gap-2"><strong>{policy.code} v{policy.version}</strong><Badge variant={policy.status === "ACTIVE" ? "success" : policy.status === "DRAFT" ? "warning" : "outline"}>{t(`status.${policy.status}`)}</Badge></div><p className="mt-1 truncate text-muted-foreground">{policy.definitionHash}</p></button>)}</div> : <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        {activation?.status === "DRAFT" ? <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700"><Input value={approval} onChange={(event) => setApproval(event.target.value)} placeholder={t("approvalPlaceholder")} maxLength={500} /><Button type="button" variant="outline" onClick={() => void activate()} disabled={approval.trim().length < 3 || busy !== ""}>{busy === "activate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{t("activate")}</Button><p className="text-xs leading-5 text-muted-foreground">{t("activationWarning")}</p></div> : null}
      </div>
    </div>
  </section>
}
