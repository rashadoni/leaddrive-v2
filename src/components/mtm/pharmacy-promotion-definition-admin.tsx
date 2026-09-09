"use client"

import { type ComponentProps, useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { CheckCircle2, FileJson2, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type DefinitionStatus = "DRAFT" | "ACTIVE" | "RETIRED"

type PromotionType = {
  id: string
  code: string
  nameRu: string
  nameAz: string
  nameEn: string
  status: DefinitionStatus
}

type SignedDefinition = {
  id: string
  code: string
  version: number
  status: DefinitionStatus
  definitionHash: string
  approvalReference: string | null
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
}

type Formula = SignedDefinition & { nameRu: string; nameAz: string; nameEn: string }
type ApprovalPolicy = SignedDefinition & { name: string }

type Catalog = {
  types: PromotionType[]
  formulas: Formula[]
  policies: ApprovalPolicy[]
}

type ActivationTarget = {
  kind: "formula" | "policy"
  id: string
  label: string
  definitionHash: string
}

const emptyCatalog: Catalog = { types: [], formulas: [], policies: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function apiError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback
}

function catalogArray(payload: unknown, key: "types" | "formulas" | "policies"): unknown[] | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data[key])) return null
  return payload.data[key]
}

function observedAtIso(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function DefinitionBadge({ status }: { status: DefinitionStatus }) {
  const t = useTranslations("mtmPharmacyPromotions.definitionStatus")
  return <Badge variant={status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "outline"}>{t(status)}</Badge>
}

function FormField({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="block min-w-0 text-sm font-medium">
      <span className="mb-1.5 block">{label}</span>
      <Input {...props} className="min-h-11 lg:min-h-10" />
    </label>
  )
}

export function PharmacyPromotionDefinitionAdmin({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("mtmPharmacyPromotions.configuration")
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState("")
  const [activation, setActivation] = useState<ActivationTarget | null>(null)
  const [approvalReference, setApprovalReference] = useState("")
  const [typeForm, setTypeForm] = useState({ code: "", nameRu: "", nameAz: "", nameEn: "" })
  const [formulaForm, setFormulaForm] = useState({
    code: "", version: "", nameRu: "", nameAz: "", nameEn: "", definition: "",
    sourceSystem: "", sourceReference: "", observedAt: "",
  })
  const [policyForm, setPolicyForm] = useState({
    code: "", version: "", name: "", definition: "", sourceSystem: "", sourceReference: "", observedAt: "",
  })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const [typesResponse, formulasResponse, policiesResponse] = await Promise.all([
        fetch("/api/v1/mtm/pharmacy-promotion-types", { cache: "no-store" }),
        fetch("/api/v1/mtm/pharmacy-points-formulas", { cache: "no-store" }),
        fetch("/api/v1/mtm/pharmacy-approval-policies", { cache: "no-store" }),
      ])
      const [typesPayload, formulasPayload, policiesPayload]: unknown[] = await Promise.all([
        typesResponse.json().catch(() => null),
        formulasResponse.json().catch(() => null),
        policiesResponse.json().catch(() => null),
      ])
      if (!typesResponse.ok) throw new Error(apiError(typesPayload, t("loadFailed")))
      if (!formulasResponse.ok) throw new Error(apiError(formulasPayload, t("loadFailed")))
      if (!policiesResponse.ok) throw new Error(apiError(policiesPayload, t("loadFailed")))
      const types = catalogArray(typesPayload, "types")
      const formulas = catalogArray(formulasPayload, "formulas")
      const policies = catalogArray(policiesPayload, "policies")
      if (!types || !formulas || !policies) throw new Error(t("loadFailed"))
      setCatalog({
        types: types as PromotionType[],
        formulas: formulas as Formula[],
        policies: policies as ApprovalPolicy[],
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  async function mutation(input: {
    key: string
    url: string
    body?: unknown
    success: string
  }) {
    setBusy(input.key)
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: input.body === undefined ? undefined : { "content-type": "application/json" },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(apiError(payload, t("saveFailed")))
      toast.success(input.success)
      await load()
      onChanged?.()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
      return false
    } finally {
      setBusy("")
    }
  }

  async function createType() {
    if (Object.values(typeForm).some((value) => !value.trim())) return
    const saved = await mutation({
      key: "create-type",
      url: "/api/v1/mtm/pharmacy-promotion-types",
      body: typeForm,
      success: t("typeCreated"),
    })
    if (saved) setTypeForm({ code: "", nameRu: "", nameAz: "", nameEn: "" })
  }

  async function createFormula() {
    const observedAt = observedAtIso(formulaForm.observedAt)
    let definition: unknown
    try { definition = JSON.parse(formulaForm.definition) } catch { toast.error(t("jsonInvalid")); return }
    if (!observedAt) { toast.error(t("observedAtInvalid")); return }
    const saved = await mutation({
      key: "create-formula",
      url: "/api/v1/mtm/pharmacy-points-formulas",
      body: {
        code: formulaForm.code,
        version: Number(formulaForm.version),
        nameRu: formulaForm.nameRu,
        nameAz: formulaForm.nameAz,
        nameEn: formulaForm.nameEn,
        definition,
        sourceSystem: formulaForm.sourceSystem,
        sourceReference: formulaForm.sourceReference,
        observedAt,
      },
      success: t("formulaCreated"),
    })
    if (saved) setFormulaForm({ code: "", version: "", nameRu: "", nameAz: "", nameEn: "", definition: "", sourceSystem: "", sourceReference: "", observedAt: "" })
  }

  async function createPolicy() {
    const observedAt = observedAtIso(policyForm.observedAt)
    let definition: unknown
    try { definition = JSON.parse(policyForm.definition) } catch { toast.error(t("jsonInvalid")); return }
    if (!observedAt) { toast.error(t("observedAtInvalid")); return }
    const saved = await mutation({
      key: "create-policy",
      url: "/api/v1/mtm/pharmacy-approval-policies",
      body: {
        code: policyForm.code,
        version: Number(policyForm.version),
        name: policyForm.name,
        definition,
        sourceSystem: policyForm.sourceSystem,
        sourceReference: policyForm.sourceReference,
        observedAt,
      },
      success: t("policyCreated"),
    })
    if (saved) setPolicyForm({ code: "", version: "", name: "", definition: "", sourceSystem: "", sourceReference: "", observedAt: "" })
  }

  async function activateType(item: PromotionType) {
    if (!window.confirm(t("activateTypeConfirm", { code: item.code }))) return
    await mutation({
      key: `type:${item.id}`,
      url: `/api/v1/mtm/pharmacy-promotion-types/${encodeURIComponent(item.id)}/activate`,
      success: t("typeActivated"),
    })
  }

  async function activateSignedDefinition() {
    if (!activation || approvalReference.trim().length < 3) return
    const url = activation.kind === "formula"
      ? `/api/v1/mtm/pharmacy-points-formulas/${encodeURIComponent(activation.id)}/activate`
      : `/api/v1/mtm/pharmacy-approval-policies/${encodeURIComponent(activation.id)}/activate`
    const saved = await mutation({
      key: `activate:${activation.kind}:${activation.id}`,
      url,
      body: { expectedDefinitionHash: activation.definitionHash, approvalReference: approvalReference.trim() },
      success: activation.kind === "formula" ? t("formulaActivated") : t("policyActivated"),
    })
    if (saved) { setActivation(null); setApprovalReference("") }
  }

  return (
    <section aria-labelledby="pharmacy-definition-admin-title" className="border border-zinc-200/70 bg-card dark:border-zinc-800">
      <header className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 id="pharmacy-definition-admin-title" className="font-semibold">{t("title")}</h2></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="outline" className="min-h-11 shrink-0 lg:min-h-9" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}
        </Button>
      </header>

      {loadError ? <div role="alert" className="border-b border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{loadError}</div> : null}
      {loading && catalog === emptyCatalog ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" /></div> : null}

      <div className="grid divide-y xl:grid-cols-3 xl:divide-x xl:divide-y-0">
        <details className="group p-4" open>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold">
            <span>{t("typesTitle")}</span><Badge variant="outline">{catalog.types.length}</Badge>
          </summary>
          <div className="mt-3 space-y-3">
            {catalog.types.map((item) => (
              <article key={item.id} className="border border-zinc-200/70 p-3 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{item.code}</p><p className="text-xs text-muted-foreground">{item.nameRu} · {item.nameAz} · {item.nameEn}</p></div><DefinitionBadge status={item.status} /></div>
                {item.status === "DRAFT" ? <Button className="mt-3 min-h-11 w-full lg:min-h-9" variant="outline" disabled={Boolean(busy)} onClick={() => void activateType(item)}>{busy === `type:${item.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}{t("activate")}</Button> : null}
              </article>
            ))}
            <div className="space-y-3 border border-dashed p-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("newType")}</h3>
              <FormField label={t("code")} value={typeForm.code} maxLength={40} onChange={(event) => setTypeForm((current) => ({ ...current, code: event.target.value }))} />
              <FormField label={t("nameRu")} value={typeForm.nameRu} maxLength={160} onChange={(event) => setTypeForm((current) => ({ ...current, nameRu: event.target.value }))} />
              <FormField label={t("nameAz")} value={typeForm.nameAz} maxLength={160} onChange={(event) => setTypeForm((current) => ({ ...current, nameAz: event.target.value }))} />
              <FormField label={t("nameEn")} value={typeForm.nameEn} maxLength={160} onChange={(event) => setTypeForm((current) => ({ ...current, nameEn: event.target.value }))} />
              <Button className="min-h-11 w-full lg:min-h-9" disabled={Boolean(busy) || Object.values(typeForm).some((value) => !value.trim())} onClick={() => void createType()}>{busy === "create-type" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{t("createDraft")}</Button>
            </div>
          </div>
        </details>

        <details className="group p-4" open>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold"><span>{t("formulasTitle")}</span><Badge variant="outline">{catalog.formulas.length}</Badge></summary>
          <div className="mt-3 space-y-3">
            {catalog.formulas.map((item) => (
              <article key={item.id} className="border border-zinc-200/70 p-3 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{item.code} · v{item.version}</p><p className="text-xs text-muted-foreground">{item.nameRu}</p></div><DefinitionBadge status={item.status} /></div>
                <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground" title={item.definitionHash}>{item.definitionHash}</p>
                <p className="mt-2 text-xs text-muted-foreground">{item.sourceSystem} · {item.sourceReference || "—"}</p>
                {item.status === "DRAFT" ? <Button className="mt-3 min-h-11 w-full lg:min-h-9" variant="outline" disabled={Boolean(busy)} onClick={() => { setActivation({ kind: "formula", id: item.id, label: `${item.code} v${item.version}`, definitionHash: item.definitionHash }); setApprovalReference("") }}><KeyRound className="mr-2 h-4 w-4" />{t("signAndActivate")}</Button> : null}
              </article>
            ))}
            <details className="border border-dashed p-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("newFormula")}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <FormField label={t("code")} value={formulaForm.code} maxLength={80} onChange={(event) => setFormulaForm((current) => ({ ...current, code: event.target.value }))} />
                <FormField label={t("version")} type="number" min={1} value={formulaForm.version} onChange={(event) => setFormulaForm((current) => ({ ...current, version: event.target.value }))} />
                <FormField label={t("nameRu")} value={formulaForm.nameRu} onChange={(event) => setFormulaForm((current) => ({ ...current, nameRu: event.target.value }))} />
                <FormField label={t("nameAz")} value={formulaForm.nameAz} onChange={(event) => setFormulaForm((current) => ({ ...current, nameAz: event.target.value }))} />
                <FormField label={t("nameEn")} value={formulaForm.nameEn} onChange={(event) => setFormulaForm((current) => ({ ...current, nameEn: event.target.value }))} />
                <FormField label={t("sourceSystem")} value={formulaForm.sourceSystem} onChange={(event) => setFormulaForm((current) => ({ ...current, sourceSystem: event.target.value }))} />
                <FormField label={t("sourceReference")} value={formulaForm.sourceReference} onChange={(event) => setFormulaForm((current) => ({ ...current, sourceReference: event.target.value }))} />
                <FormField label={t("observedAt")} type="datetime-local" value={formulaForm.observedAt} onChange={(event) => setFormulaForm((current) => ({ ...current, observedAt: event.target.value }))} />
              </div>
              <label className="mt-3 block text-sm font-medium"><span className="mb-1.5 block">{t("definitionJson")}</span><Textarea rows={9} className="font-mono text-xs" value={formulaForm.definition} onChange={(event) => setFormulaForm((current) => ({ ...current, definition: event.target.value }))} placeholder={t("formulaSchemaHint")} /></label>
              <p className="mt-2 text-xs text-muted-foreground">{t("noDefaultsHint")}</p>
              <Button className="mt-3 min-h-11 w-full lg:min-h-9" disabled={Boolean(busy) || !formulaForm.code.trim() || !formulaForm.version || !formulaForm.definition.trim() || !formulaForm.sourceSystem.trim() || !formulaForm.sourceReference.trim() || !formulaForm.observedAt} onClick={() => void createFormula()}>{busy === "create-formula" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileJson2 className="mr-2 h-4 w-4" />}{t("createDraft")}</Button>
            </details>
          </div>
        </details>

        <details className="group p-4" open>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold"><span>{t("policiesTitle")}</span><Badge variant="outline">{catalog.policies.length}</Badge></summary>
          <div className="mt-3 space-y-3">
            {catalog.policies.map((item) => (
              <article key={item.id} className="border border-zinc-200/70 p-3 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{item.code} · v{item.version}</p><p className="text-xs text-muted-foreground">{item.name}</p></div><DefinitionBadge status={item.status} /></div>
                <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground" title={item.definitionHash}>{item.definitionHash}</p>
                <p className="mt-2 text-xs text-muted-foreground">{item.sourceSystem} · {item.sourceReference || "—"}</p>
                {item.status === "DRAFT" ? <Button className="mt-3 min-h-11 w-full lg:min-h-9" variant="outline" disabled={Boolean(busy)} onClick={() => { setActivation({ kind: "policy", id: item.id, label: `${item.code} v${item.version}`, definitionHash: item.definitionHash }); setApprovalReference("") }}><KeyRound className="mr-2 h-4 w-4" />{t("signAndActivate")}</Button> : null}
              </article>
            ))}
            <details className="border border-dashed p-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("newPolicy")}</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <FormField label={t("code")} value={policyForm.code} maxLength={80} onChange={(event) => setPolicyForm((current) => ({ ...current, code: event.target.value }))} />
                <FormField label={t("version")} type="number" min={1} value={policyForm.version} onChange={(event) => setPolicyForm((current) => ({ ...current, version: event.target.value }))} />
                <FormField label={t("name")} value={policyForm.name} onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))} />
                <FormField label={t("sourceSystem")} value={policyForm.sourceSystem} onChange={(event) => setPolicyForm((current) => ({ ...current, sourceSystem: event.target.value }))} />
                <FormField label={t("sourceReference")} value={policyForm.sourceReference} onChange={(event) => setPolicyForm((current) => ({ ...current, sourceReference: event.target.value }))} />
                <FormField label={t("observedAt")} type="datetime-local" value={policyForm.observedAt} onChange={(event) => setPolicyForm((current) => ({ ...current, observedAt: event.target.value }))} />
              </div>
              <label className="mt-3 block text-sm font-medium"><span className="mb-1.5 block">{t("definitionJson")}</span><Textarea rows={9} className="font-mono text-xs" value={policyForm.definition} onChange={(event) => setPolicyForm((current) => ({ ...current, definition: event.target.value }))} placeholder={t("policySchemaHint")} /></label>
              <p className="mt-2 text-xs text-muted-foreground">{t("noDefaultsHint")}</p>
              <Button className="mt-3 min-h-11 w-full lg:min-h-9" disabled={Boolean(busy) || !policyForm.code.trim() || !policyForm.version || !policyForm.name.trim() || !policyForm.definition.trim() || !policyForm.sourceSystem.trim() || !policyForm.sourceReference.trim() || !policyForm.observedAt} onClick={() => void createPolicy()}>{busy === "create-policy" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileJson2 className="mr-2 h-4 w-4" />}{t("createDraft")}</Button>
            </details>
          </div>
        </details>
      </div>

      {activation ? (
        <div className="border-t border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="font-semibold">{t("activationTitle", { label: activation.label })}</h3><p className="mt-1 text-sm">{t("activationWarning")}</p><p className="mt-2 break-all font-mono text-[10px]">{activation.definitionHash}</p><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto]"><FormField label={t("approvalReference")} value={approvalReference} maxLength={500} onChange={(event) => setApprovalReference(event.target.value)} /><Button variant="ghost" className="min-h-11 self-end lg:min-h-10" disabled={Boolean(busy)} onClick={() => { setActivation(null); setApprovalReference("") }}>{t("cancel")}</Button><Button className="min-h-11 self-end lg:min-h-10" disabled={Boolean(busy) || approvalReference.trim().length < 3} onClick={() => void activateSignedDefinition()}>{busy.startsWith("activate:") ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{t("confirmActivation")}</Button></div></div></div>
        </div>
      ) : null}
    </section>
  )
}
