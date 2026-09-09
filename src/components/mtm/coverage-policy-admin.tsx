"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { CheckCircle2, FileJson2, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type PolicyStatus = "DRAFT" | "ACTIVE" | "RETIRED"

type CoveragePolicy = {
  id: string
  code: string
  version: number
  nameRu: string
  nameAz: string
  nameEn: string
  status: PolicyStatus
  definitionHash: string
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: string
  effectiveFrom: string
  effectiveTo: string | null
  approvalReference: string | null
}

type PolicyPreview = {
  code: string
  version: number
  name: string
  timezone: string
  groups: number
  doctors: number
  pharmacies: number
  source: string
  effectiveFrom: string
}

type SnapshotPreview = {
  policyId: string
  agentId: string
  period: string
  batch: string
  rows: number
  doctors: number
  pharmacies: number
  requiredCoverage: string
  actualCoverage: string
  uncoveredMoi: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function apiError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function policyPreview(value: Record<string, unknown>): PolicyPreview | null {
  if (!isRecord(value.definition) || !Array.isArray(value.definition.groups)) return null
  const groups = value.definition.groups.filter(isRecord)
  if (
    typeof value.code !== "string" || typeof value.version !== "number"
    || typeof value.nameRu !== "string" || typeof value.sourceSystem !== "string"
    || typeof value.effectiveFrom !== "string" || typeof value.definition.timezone !== "string"
  ) return null
  return {
    code: value.code,
    version: value.version,
    name: value.nameRu,
    timezone: value.definition.timezone,
    groups: groups.length,
    doctors: groups.filter((group) => group.subjectType === "DOCTOR").length,
    pharmacies: groups.filter((group) => group.subjectType === "PHARMACY").length,
    source: value.sourceSystem,
    effectiveFrom: value.effectiveFrom,
  }
}

function addDecimal(left: bigint, value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,4})?$/.test(value)) return left
  const [whole, fraction = ""] = value.split(".")
  return left + BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"))
}

function decimalText(value: bigint): string {
  const whole = value / 10_000n
  const fraction = (value % 10_000n).toString().padStart(4, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function snapshotPreview(value: Record<string, unknown>): SnapshotPreview | null {
  if (!Array.isArray(value.rows)) return null
  const rows = value.rows.filter(isRecord)
  if (
    typeof value.policyId !== "string" || typeof value.agentId !== "string"
    || typeof value.periodStart !== "string" || typeof value.periodEnd !== "string"
    || typeof value.sourceBatchReference !== "string" || rows.length !== value.rows.length
  ) return null
  return {
    policyId: value.policyId,
    agentId: value.agentId,
    period: `${value.periodStart} — ${value.periodEnd}`,
    batch: value.sourceBatchReference,
    rows: rows.length,
    doctors: rows.filter((row) => row.subjectType === "DOCTOR").length,
    pharmacies: rows.filter((row) => row.subjectType === "PHARMACY").length,
    requiredCoverage: decimalText(rows.reduce((sum, row) => addDecimal(sum, row.requiredCoverage), 0n)),
    actualCoverage: decimalText(rows.reduce((sum, row) => addDecimal(sum, row.actualCoverage), 0n)),
    uncoveredMoi: decimalText(rows.reduce((sum, row) => addDecimal(sum, row.uncoveredMoi), 0n)),
  }
}

async function readJsonFile(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("FILE_TOO_LARGE")
  return file.text()
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  const t = useTranslations("mtmCoverageAdmin.status")
  return <Badge variant={status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "outline"}>{t(status)}</Badge>
}

export function CoveragePolicyAdmin() {
  const t = useTranslations("mtmCoverageAdmin")
  const [policies, setPolicies] = useState<CoveragePolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState("")
  const [policyJson, setPolicyJson] = useState("")
  const [snapshotJson, setSnapshotJson] = useState("")
  const [policyConfirmed, setPolicyConfirmed] = useState(false)
  const [snapshotConfirmed, setSnapshotConfirmed] = useState(false)
  const [activationId, setActivationId] = useState("")
  const [approvalReference, setApprovalReference] = useState("")

  const parsedPolicy = useMemo(() => parseJsonObject(policyJson), [policyJson])
  const parsedSnapshot = useMemo(() => parseJsonObject(snapshotJson), [snapshotJson])
  const policySummary = useMemo(() => parsedPolicy ? policyPreview(parsedPolicy) : null, [parsedPolicy])
  const snapshotSummary = useMemo(() => parsedSnapshot ? snapshotPreview(parsedSnapshot) : null, [parsedSnapshot])
  const activation = policies.find((policy) => policy.id === activationId) ?? null

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const response = await fetch("/api/v1/mtm/coverage-policies", { cache: "no-store" })
      if (response.status === 403) { setHidden(true); return }
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.policies)) {
        throw new Error(apiError(payload, t("loadFailed")))
      }
      setPolicies(payload.data.policies as CoveragePolicy[])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  async function loadFile(file: File | undefined, kind: "policy" | "snapshot") {
    if (!file) return
    try {
      const text = await readJsonFile(file)
      if (!parseJsonObject(text)) throw new Error("INVALID_JSON")
      if (kind === "policy") { setPolicyJson(text); setPolicyConfirmed(false) }
      else { setSnapshotJson(text); setSnapshotConfirmed(false) }
    } catch (error) {
      toast.error(error instanceof Error && error.message === "FILE_TOO_LARGE" ? t("fileTooLarge") : t("jsonInvalid"))
    }
  }

  async function createPolicy() {
    if (!parsedPolicy || !policySummary || !policyConfirmed) return
    setBusy("policy")
    try {
      const response = await fetch("/api/v1/mtm/coverage-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedPolicy),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(apiError(payload, t("createFailed")))
      toast.success(t("created"))
      setPolicyJson("")
      setPolicyConfirmed(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("createFailed"))
    } finally {
      setBusy("")
    }
  }

  async function activatePolicy() {
    if (!activation || approvalReference.trim().length < 3) return
    setBusy("activate")
    try {
      const response = await fetch(`/api/v1/mtm/coverage-policies/${encodeURIComponent(activation.id)}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedDefinitionHash: activation.definitionHash,
          approvalReference: approvalReference.trim(),
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(apiError(payload, t("activateFailed")))
      toast.success(t("activated"))
      setActivationId("")
      setApprovalReference("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("activateFailed"))
    } finally {
      setBusy("")
    }
  }

  async function importSnapshot() {
    if (!parsedSnapshot || !snapshotSummary || !snapshotConfirmed) return
    setBusy("snapshot")
    try {
      const response = await fetch("/api/v1/mtm/coverage-snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedSnapshot),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(apiError(payload, t("snapshotFailed")))
      toast.success(t("snapshotImported"))
      setSnapshotJson("")
      setSnapshotConfirmed(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("snapshotFailed"))
    } finally {
      setBusy("")
    }
  }

  if (hidden) return null

  return (
    <section aria-labelledby="coverage-policy-admin-title" className="border border-zinc-200/70 bg-card dark:border-zinc-800">
      <header className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 id="coverage-policy-admin-title" className="font-semibold">{t("title")}</h2></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button variant="outline" className="min-h-11 shrink-0 lg:min-h-9" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} />{t("refresh")}
        </Button>
      </header>

      {loadError ? <div role="alert" className="border-b border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{loadError}</div> : null}

      <div className="grid divide-y xl:grid-cols-[1.1fr_1fr_1fr] xl:divide-x xl:divide-y-0">
        <div className="p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{t("registryTitle")}</h3><Badge variant="outline">{policies.length}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">{t("registryDescription")}</p>
          <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
            {loading && !policies.length ? <div className="grid min-h-32 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" /></div> : null}
            {!loading && !policies.length ? <div className="border border-dashed p-4 text-sm text-muted-foreground">{t("empty")}</div> : null}
            {policies.map((policy) => (
              <article key={policy.id} className={`border p-3 ${activationId === policy.id ? "border-primary bg-primary/5" : "border-zinc-200/70 dark:border-zinc-800"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-medium">{policy.code} · v{policy.version}</p><p className="truncate text-xs text-muted-foreground">{policy.nameRu}</p></div>
                  <StatusBadge status={policy.status} />
                </div>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("effective")}</dt><dd>{policy.effectiveFrom.slice(0, 10)}{policy.effectiveTo ? ` — ${policy.effectiveTo.slice(0, 10)}` : ""}</dd>
                  <dt className="text-muted-foreground">{t("source")}</dt><dd className="truncate">{policy.sourceSystem}{policy.sourceReference ? ` · ${policy.sourceReference}` : ""}</dd>
                  <dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-[11px]">{policy.definitionHash}</dd>
                </dl>
                {policy.status === "DRAFT" ? <Button className="mt-3 min-h-11 w-full lg:min-h-9" variant="outline" onClick={() => { setActivationId(policy.id); setApprovalReference("") }}><CheckCircle2 className="mr-2 h-4 w-4" />{t("reviewActivation")}</Button> : null}
                {policy.approvalReference ? <p className="mt-2 break-all text-xs text-muted-foreground">{t("approval")}: {policy.approvalReference}</p> : null}
              </article>
            ))}
          </div>
        </div>

        <div className="p-4">
          <h3 className="flex items-center gap-2 font-semibold"><FileJson2 className="h-4 w-4" />{t("policyTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("policyDescription")}</p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center border border-dashed px-3 text-sm hover:bg-muted/50">
            <Upload className="mr-2 h-4 w-4" />{t("chooseJson")}
            <input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0], "policy")} />
          </label>
          <Textarea className="mt-3 min-h-36 font-mono text-xs" value={policyJson} placeholder={t("policyPlaceholder")} onChange={(event) => { setPolicyJson(event.target.value); setPolicyConfirmed(false) }} />
          {policyJson && !policySummary ? <p role="alert" className="mt-2 text-xs text-red-600">{t("policyInvalid")}</p> : null}
          {policySummary ? (
            <div className="mt-3 border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{policySummary.code} · v{policySummary.version} · {policySummary.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{policySummary.timezone} · {t("groupCount", { count: policySummary.groups })} · {t("doctorCount", { count: policySummary.doctors })} · {t("pharmacyCount", { count: policySummary.pharmacies })}</p>
              <p className="mt-1 text-xs text-muted-foreground">{policySummary.source} · {t("fromDate", { date: policySummary.effectiveFrom })}</p>
            </div>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={policyConfirmed} onChange={(event) => setPolicyConfirmed(event.target.checked)} /><span>{t("policyConfirmation")}</span></label>
          <Button className="mt-3 min-h-11 w-full lg:min-h-9" disabled={!policySummary || !policyConfirmed || Boolean(busy)} onClick={() => void createPolicy()}>{busy === "policy" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{t("createDraft")}</Button>
        </div>

        <div className="p-4">
          <h3 className="flex items-center gap-2 font-semibold"><FileJson2 className="h-4 w-4" />{t("snapshotTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("snapshotDescription")}</p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center border border-dashed px-3 text-sm hover:bg-muted/50">
            <Upload className="mr-2 h-4 w-4" />{t("chooseJson")}
            <input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0], "snapshot")} />
          </label>
          <Textarea className="mt-3 min-h-36 font-mono text-xs" value={snapshotJson} placeholder={t("snapshotPlaceholder")} onChange={(event) => { setSnapshotJson(event.target.value); setSnapshotConfirmed(false) }} />
          {snapshotJson && !snapshotSummary ? <p role="alert" className="mt-2 text-xs text-red-600">{t("snapshotInvalid")}</p> : null}
          {snapshotSummary ? (
            <div className="mt-3 border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{snapshotSummary.period}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{t("policyId")}: {snapshotSummary.policyId} · {t("agentId")}: {snapshotSummary.agentId}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("rowCount", { count: snapshotSummary.rows })} · {t("doctorCount", { count: snapshotSummary.doctors })} · {t("pharmacyCount", { count: snapshotSummary.pharmacies })}</p>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-xs"><dt>{t("required")}</dt><dd className="text-right tabular-nums">{snapshotSummary.requiredCoverage}</dd><dt>{t("actual")}</dt><dd className="text-right tabular-nums">{snapshotSummary.actualCoverage}</dd><dt>{t("uncovered")}</dt><dd className="text-right tabular-nums">{snapshotSummary.uncoveredMoi}</dd></dl>
              <p className="mt-2 break-all text-xs text-muted-foreground">{t("batch")}: {snapshotSummary.batch}</p>
            </div>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={snapshotConfirmed} onChange={(event) => setSnapshotConfirmed(event.target.checked)} /><span>{t("snapshotConfirmation")}</span></label>
          <Button className="mt-3 min-h-11 w-full lg:min-h-9" disabled={!snapshotSummary || !snapshotConfirmed || Boolean(busy)} onClick={() => void importSnapshot()}>{busy === "snapshot" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{t("importSnapshot")}</Button>
        </div>
      </div>

      {activation ? (
        <div className="border-t bg-amber-50/70 p-4 dark:bg-amber-950/20">
          <h3 className="font-semibold">{t("activationTitle", { code: activation.code, version: activation.version })}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("activationDescription")}</p>
          <p className="mt-3 break-all border bg-background p-2 font-mono text-xs">{activation.definitionHash}</p>
          <label className="mt-3 block text-sm font-medium"><span className="mb-1.5 block">{t("approvalReference")}</span><Input value={approvalReference} maxLength={500} onChange={(event) => setApprovalReference(event.target.value)} /></label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => { setActivationId(""); setApprovalReference("") }}>{t("cancel")}</Button><Button disabled={approvalReference.trim().length < 3 || Boolean(busy)} onClick={() => void activatePolicy()}>{busy === "activate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{t("activateExactHash")}</Button></div>
        </div>
      ) : null}
    </section>
  )
}
