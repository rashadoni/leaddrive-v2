"use client"

import { type ComponentProps, useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Archive, CalendarRange, CheckCircle2, FileBadge, Loader2, Plus, RefreshCw, Send, ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/format-date"

type Localized = { nameRu: string; nameAz: string; nameEn: string }
type CatalogItem = { id: string; code: string; status: string }
type FormulaItem = CatalogItem & { version: number }
type PolicyItem = CatalogItem & { version: number; name: string }

export type PharmacyPromotionAdminCampaign = {
  id: string
  code: string
  updatedAt: string
  versions: Array<Localized & {
    id: string
    revision: number
    status: string
    startsOn: string
    endsOn: string
    definitionHash: string
    approvalReference: string | null
    eligibilityApprovalReference: string | null
    type: Localized & { code: string; status: string }
    formula: { code: string; version: number; status: string; definitionHash: string }
    approvalPolicy: { code: string; version: number; status: string; definitionHash: string }
    _count: { targets: number }
  }>
}

type VersionAction = {
  kind: "publish" | "retire"
  campaignId: string
  versionId: string
  label: string
  definitionHash: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function apiError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback
}

function dataArray(payload: unknown, key: string): unknown[] | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data[key])) return null
  return payload.data[key]
}

function isoDateTime(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function localizedName(value: Localized, locale: string): string {
  if (locale.startsWith("az")) return value.nameAz
  if (locale.startsWith("en")) return value.nameEn
  return value.nameRu
}

function Field({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  return <label className="block min-w-0 text-sm font-medium"><span className="mb-1.5 block">{label}</span><Input {...props} className="min-h-11 lg:min-h-10" /></label>
}

export function PharmacyPromotionCampaignAdmin({ campaigns, loading, postingEnabled, onChanged }: {
  campaigns: PharmacyPromotionAdminCampaign[]
  loading: boolean
  postingEnabled: boolean
  onChanged: () => void
}) {
  const t = useTranslations("mtmPharmacyPromotions.campaignConfiguration")
  const statusT = useTranslations("mtmPharmacyPromotions.definitionStatus")
  const unknownT = useTranslations("mtmPharmacyPromotions")
  const locale = useLocale()
  const [types, setTypes] = useState<CatalogItem[]>([])
  const [formulas, setFormulas] = useState<FormulaItem[]>([])
  const [policies, setPolicies] = useState<PolicyItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [campaignCode, setCampaignCode] = useState("")
  const [action, setAction] = useState<VersionAction | null>(null)
  const [approvalReference, setApprovalReference] = useState("")
  const [eligibilityApprovalReference, setEligibilityApprovalReference] = useState("")
  const [retirementReason, setRetirementReason] = useState("")
  const [versionForm, setVersionForm] = useState({
    campaignId: "", revision: "", typeId: "", nameRu: "", nameAz: "", nameEn: "",
    descriptionRu: "", descriptionAz: "", descriptionEn: "", startsOn: "", endsOn: "",
    timezone: "", formulaId: "", approvalPolicyId: "", eligibilityDefinition: "",
    eligibilityApprovalReference: "", sourceSystem: "", sourceReference: "", observedAt: "",
  })

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const [typeResponse, formulaResponse, policyResponse] = await Promise.all([
        fetch("/api/v1/mtm/pharmacy-promotion-types", { cache: "no-store" }),
        fetch("/api/v1/mtm/pharmacy-points-formulas", { cache: "no-store" }),
        fetch("/api/v1/mtm/pharmacy-approval-policies", { cache: "no-store" }),
      ])
      const [typePayload, formulaPayload, policyPayload]: unknown[] = await Promise.all([
        typeResponse.json().catch(() => null), formulaResponse.json().catch(() => null), policyResponse.json().catch(() => null),
      ])
      if (!typeResponse.ok) throw new Error(apiError(typePayload, t("catalogFailed")))
      if (!formulaResponse.ok) throw new Error(apiError(formulaPayload, t("catalogFailed")))
      if (!policyResponse.ok) throw new Error(apiError(policyPayload, t("catalogFailed")))
      const nextTypes = dataArray(typePayload, "types")
      const nextFormulas = dataArray(formulaPayload, "formulas")
      const nextPolicies = dataArray(policyPayload, "policies")
      if (!nextTypes || !nextFormulas || !nextPolicies) throw new Error(t("catalogFailed"))
      setTypes((nextTypes as CatalogItem[]).filter((item) => item.status === "ACTIVE"))
      setFormulas((nextFormulas as FormulaItem[]).filter((item) => item.status === "ACTIVE"))
      setPolicies((nextPolicies as PolicyItem[]).filter((item) => item.status === "ACTIVE"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("catalogFailed"))
    } finally {
      setCatalogLoading(false)
    }
  }, [t])

  useEffect(() => { void loadCatalog() }, [loadCatalog])

  async function mutate(input: { key: string; url: string; body: unknown; success: string }) {
    setBusy(input.key)
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.body),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(apiError(payload, t("saveFailed")))
      toast.success(input.success)
      onChanged()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
      return false
    } finally {
      setBusy("")
    }
  }

  async function createCampaign() {
    if (!campaignCode.trim()) return
    const saved = await mutate({ key: "campaign", url: "/api/v1/mtm/pharmacy-promotions", body: { code: campaignCode.trim() }, success: t("campaignCreated") })
    if (saved) setCampaignCode("")
  }

  async function createVersion() {
    let eligibilityDefinition: unknown
    try { eligibilityDefinition = JSON.parse(versionForm.eligibilityDefinition) } catch { toast.error(t("jsonInvalid")); return }
    const observedAt = isoDateTime(versionForm.observedAt)
    if (!observedAt) { toast.error(t("observedAtInvalid")); return }
    const saved = await mutate({
      key: "version",
      url: `/api/v1/mtm/pharmacy-promotions/${encodeURIComponent(versionForm.campaignId)}/versions`,
      body: {
        revision: Number(versionForm.revision), typeId: versionForm.typeId,
        nameRu: versionForm.nameRu, nameAz: versionForm.nameAz, nameEn: versionForm.nameEn,
        descriptionRu: versionForm.descriptionRu || null, descriptionAz: versionForm.descriptionAz || null,
        descriptionEn: versionForm.descriptionEn || null, startsOn: versionForm.startsOn,
        endsOn: versionForm.endsOn, timezone: versionForm.timezone, formulaId: versionForm.formulaId,
        approvalPolicyId: versionForm.approvalPolicyId, eligibilityDefinition,
        eligibilityApprovalReference: versionForm.eligibilityApprovalReference,
        sourceSystem: versionForm.sourceSystem, sourceReference: versionForm.sourceReference, observedAt,
      },
      success: t("versionCreated"),
    })
    if (saved) setVersionForm({ campaignId: "", revision: "", typeId: "", nameRu: "", nameAz: "", nameEn: "", descriptionRu: "", descriptionAz: "", descriptionEn: "", startsOn: "", endsOn: "", timezone: "", formulaId: "", approvalPolicyId: "", eligibilityDefinition: "", eligibilityApprovalReference: "", sourceSystem: "", sourceReference: "", observedAt: "" })
  }

  async function applyAction() {
    if (!action) return
    const base = `/api/v1/mtm/pharmacy-promotions/${encodeURIComponent(action.campaignId)}/versions/${encodeURIComponent(action.versionId)}`
    const saved = action.kind === "publish"
      ? await mutate({
          key: "publish", url: `${base}/publish`, success: t("published"),
          body: { expectedDefinitionHash: action.definitionHash, approvalReference: approvalReference.trim(), eligibilityApprovalReference: eligibilityApprovalReference.trim() },
        })
      : await mutate({
          key: "retire", url: `${base}/retire`, success: t("retired"),
          body: { expectedDefinitionHash: action.definitionHash, reason: retirementReason.trim() },
        })
    if (saved) { setAction(null); setApprovalReference(""); setEligibilityApprovalReference(""); setRetirementReason("") }
  }

  const versionReady = Object.entries(versionForm).every(([key, value]) => key.startsWith("description") || Boolean(value.trim()))

  return (
    <div className="space-y-4">
      {!postingEnabled ? <div className="flex gap-3 border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{t("postingBlocked")}</p><p className="mt-1 text-sm">{t("postingBlockedHint")}</p></div></div> : null}

      <section className="border border-zinc-200/70 bg-card dark:border-zinc-800">
        <header className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><CalendarRange className="h-5 w-5 text-primary" /><h2 className="font-semibold">{t("title")}</h2></div><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></div><Button variant="outline" className="min-h-11 lg:min-h-9" onClick={() => { void loadCatalog(); onChanged() }} disabled={catalogLoading || loading}><RefreshCw className={`mr-2 h-4 w-4 ${catalogLoading || loading ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}</Button></header>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,2fr)]">
          <div className="space-y-3 border border-dashed p-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("newCampaign")}</h3><Field label={t("campaignCode")} value={campaignCode} maxLength={80} onChange={(event) => setCampaignCode(event.target.value)} /><Button className="min-h-11 w-full lg:min-h-9" disabled={Boolean(busy) || !campaignCode.trim()} onClick={() => void createCampaign()}>{busy === "campaign" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{t("createCampaign")}</Button></div>
          <details className="border border-dashed p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" />{t("newVersion")}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-medium"><span className="mb-1.5 block">{t("campaign")}</span><Select className="min-h-11 lg:min-h-10" value={versionForm.campaignId} onChange={(event) => setVersionForm((current) => ({ ...current, campaignId: event.target.value }))}><option value="">{t("select")}</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</Select></label>
              <Field label={t("revision")} type="number" min={1} value={versionForm.revision} onChange={(event) => setVersionForm((current) => ({ ...current, revision: event.target.value }))} />
              <label className="text-sm font-medium"><span className="mb-1.5 block">{t("type")}</span><Select className="min-h-11 lg:min-h-10" value={versionForm.typeId} onChange={(event) => setVersionForm((current) => ({ ...current, typeId: event.target.value }))}><option value="">{t("select")}</option>{types.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</Select></label>
              <Field label={t("nameRu")} value={versionForm.nameRu} onChange={(event) => setVersionForm((current) => ({ ...current, nameRu: event.target.value }))} />
              <Field label={t("nameAz")} value={versionForm.nameAz} onChange={(event) => setVersionForm((current) => ({ ...current, nameAz: event.target.value }))} />
              <Field label={t("nameEn")} value={versionForm.nameEn} onChange={(event) => setVersionForm((current) => ({ ...current, nameEn: event.target.value }))} />
              <Field label={t("startsOn")} type="date" value={versionForm.startsOn} onChange={(event) => setVersionForm((current) => ({ ...current, startsOn: event.target.value }))} />
              <Field label={t("endsOn")} type="date" value={versionForm.endsOn} onChange={(event) => setVersionForm((current) => ({ ...current, endsOn: event.target.value }))} />
              <Field label={t("timezone")} value={versionForm.timezone} placeholder={t("timezoneHint")} onChange={(event) => setVersionForm((current) => ({ ...current, timezone: event.target.value }))} />
              <label className="text-sm font-medium"><span className="mb-1.5 block">{t("formula")}</span><Select className="min-h-11 lg:min-h-10" value={versionForm.formulaId} onChange={(event) => setVersionForm((current) => ({ ...current, formulaId: event.target.value }))}><option value="">{t("selectActive")}</option>{formulas.map((item) => <option key={item.id} value={item.id}>{item.code} · v{item.version}</option>)}</Select></label>
              <label className="text-sm font-medium"><span className="mb-1.5 block">{t("policy")}</span><Select className="min-h-11 lg:min-h-10" value={versionForm.approvalPolicyId} onChange={(event) => setVersionForm((current) => ({ ...current, approvalPolicyId: event.target.value }))}><option value="">{t("selectActive")}</option>{policies.map((item) => <option key={item.id} value={item.id}>{item.code} · v{item.version}</option>)}</Select></label>
              <Field label={t("eligibilityApprovalReference")} value={versionForm.eligibilityApprovalReference} onChange={(event) => setVersionForm((current) => ({ ...current, eligibilityApprovalReference: event.target.value }))} />
              <Field label={t("sourceSystem")} value={versionForm.sourceSystem} onChange={(event) => setVersionForm((current) => ({ ...current, sourceSystem: event.target.value }))} />
              <Field label={t("sourceReference")} value={versionForm.sourceReference} onChange={(event) => setVersionForm((current) => ({ ...current, sourceReference: event.target.value }))} />
              <Field label={t("observedAt")} type="datetime-local" value={versionForm.observedAt} onChange={(event) => setVersionForm((current) => ({ ...current, observedAt: event.target.value }))} />
            </div>
            <div className="mt-3 grid gap-3 xl:grid-cols-2"><label className="text-sm font-medium"><span className="mb-1.5 block">{t("eligibilityJson")}</span><Textarea rows={8} className="font-mono text-xs" value={versionForm.eligibilityDefinition} placeholder={t("eligibilityHint")} onChange={(event) => setVersionForm((current) => ({ ...current, eligibilityDefinition: event.target.value }))} /></label><div className="grid gap-3"><label className="text-sm font-medium"><span className="mb-1.5 block">{t("descriptionRu")}</span><Textarea rows={2} value={versionForm.descriptionRu} onChange={(event) => setVersionForm((current) => ({ ...current, descriptionRu: event.target.value }))} /></label><label className="text-sm font-medium"><span className="mb-1.5 block">{t("descriptionAz")}</span><Textarea rows={2} value={versionForm.descriptionAz} onChange={(event) => setVersionForm((current) => ({ ...current, descriptionAz: event.target.value }))} /></label><label className="text-sm font-medium"><span className="mb-1.5 block">{t("descriptionEn")}</span><Textarea rows={2} value={versionForm.descriptionEn} onChange={(event) => setVersionForm((current) => ({ ...current, descriptionEn: event.target.value }))} /></label></div></div>
            <p className="mt-2 text-xs text-muted-foreground">{t("noDefaultsHint")}</p><Button className="mt-3 min-h-11 w-full lg:min-h-9" disabled={Boolean(busy) || catalogLoading || !versionReady} onClick={() => void createVersion()}>{busy === "version" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileBadge className="mr-2 h-4 w-4" />}{t("createVersion")}</Button>
          </details>
        </div>
      </section>

      {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : campaigns.length === 0 ? <div className="border border-dashed p-8 text-center"><FileBadge className="mx-auto h-8 w-8 text-muted-foreground" /><h3 className="mt-3 font-semibold">{t("empty")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p></div> : campaigns.map((campaign) => (
        <article key={campaign.id} className="border border-zinc-200/70 bg-card dark:border-zinc-800"><header className="border-b px-4 py-3"><p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t("campaign")}</p><h3 className="font-semibold">{campaign.code}</h3></header><div className="divide-y">{campaign.versions.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t("noVersions")}</p> : campaign.versions.map((version) => <div key={version.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="truncate font-medium">{localizedName(version, locale)}</h4><Badge variant={version.status === "PUBLISHED" ? "success" : version.status === "DRAFT" ? "warning" : "outline"}>{statusT.has(version.status) ? statusT(version.status) : unknownT("unknownStatus")}</Badge></div><p className="mt-1 text-xs text-muted-foreground">v{version.revision} · {version.type.code} · {formatDate(new Date(version.startsOn), locale)} — {formatDate(new Date(version.endsOn), locale)}</p><p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{version.definitionHash}</p></div><div className="text-xs text-muted-foreground"><p>{t("formulaValue", { code: version.formula.code, version: version.formula.version })}</p><p>{t("policyValue", { code: version.approvalPolicy.code, version: version.approvalPolicy.version })}</p><p>{t("targets", { count: version._count.targets })}</p></div><div className="flex gap-2 lg:justify-end">{version.status === "DRAFT" ? <Button className="min-h-11 lg:min-h-9" disabled={Boolean(busy)} onClick={() => { setAction({ kind: "publish", campaignId: campaign.id, versionId: version.id, label: `${campaign.code} v${version.revision}`, definitionHash: version.definitionHash }); setApprovalReference(""); setEligibilityApprovalReference("") }}><Send className="mr-2 h-4 w-4" />{t("publish")}</Button> : null}{version.status === "PUBLISHED" ? <Button className="min-h-11 lg:min-h-9" variant="outline" disabled={Boolean(busy)} onClick={() => { setAction({ kind: "retire", campaignId: campaign.id, versionId: version.id, label: `${campaign.code} v${version.revision}`, definitionHash: version.definitionHash }); setRetirementReason("") }}><Archive className="mr-2 h-4 w-4" />{t("retire")}</Button> : null}</div></div>)}</div></article>
      ))}

      {action ? <section className="border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="font-semibold">{action.kind === "publish" ? t("publishTitle", { label: action.label }) : t("retireTitle", { label: action.label })}</h3><p className="mt-1 text-sm">{action.kind === "publish" ? t("publishWarning") : t("retireWarning")}</p><p className="mt-2 break-all font-mono text-[10px]">{action.definitionHash}</p>{action.kind === "publish" ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={t("approvalReference")} value={approvalReference} onChange={(event) => setApprovalReference(event.target.value)} /><Field label={t("eligibilityApprovalReference")} value={eligibilityApprovalReference} onChange={(event) => setEligibilityApprovalReference(event.target.value)} /></div> : <label className="mt-3 block text-sm font-medium"><span className="mb-1.5 block">{t("retirementReason")}</span><Textarea rows={3} maxLength={2_000} value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} /></label>}<div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" className="min-h-11 lg:min-h-9" disabled={Boolean(busy)} onClick={() => setAction(null)}>{t("cancel")}</Button><Button className="min-h-11 lg:min-h-9" disabled={Boolean(busy) || (action.kind === "publish" ? approvalReference.trim().length < 3 || eligibilityApprovalReference.trim().length < 3 : retirementReason.trim().length < 3)} onClick={() => void applyAction()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : action.kind === "publish" ? <Send className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}{action.kind === "publish" ? t("confirmPublish") : t("confirmRetire")}</Button></div></div></div></section> : null}
    </div>
  )
}
