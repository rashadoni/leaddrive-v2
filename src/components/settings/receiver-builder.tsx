"use client"

import { useEffect, useRef, useState } from "react"
import { BUILDER_FIELDS, CONTEXT_FIELDS, fieldsForResource, type BuilderField, type BuilderLocale, type BuilderResource } from "@/lib/integrations/customer-receiver/constructor/catalog"
import { builderProfileSchema, defaultBuilderProfile, type BuilderMapping, type BuilderProfile, type BuilderTransform } from "@/lib/integrations/customer-receiver/constructor/profile"
import { RECEIVER_COPY, RECEIVER_LOG_LABELS, type ReceiverCopy } from "./receiver-builder-copy"
import "./receiver-builder.css"

interface Draft { id: string; revision: number; profile: BuilderProfile; updatedAt: string; history?: { revision: number; profile: BuilderProfile; recordedAt: string }[] }
interface Preview { resource: string; selected: boolean; method: string; path: string; body: string; bytes: number; omitted: string[]; externalSendingAvailable: false }
const API = "/api/v1/integrations/customer-receiver"
const literal = (text: string): string | number | boolean | null => {
  try { const parsed: unknown = JSON.parse(text); if (parsed === null || typeof parsed === "string" || typeof parsed === "boolean" || (typeof parsed === "number" && Number.isFinite(parsed))) return parsed } catch { /* Plain text is a valid constant. */ }
  return text
}
const showValue = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value)
const sourceChoice = (mapping: BuilderMapping) => mapping.source.type === "field" ? mapping.source.field : mapping.source.type === "context" ? `ctx:${mapping.source.field}` : "constant"

function TransformEditor({ mapping, c, change }: { mapping: BuilderMapping; c: ReceiverCopy; change: (transforms: BuilderTransform[]) => void }) {
  const transform = mapping.transforms[0]
  const setType = (type: string) => {
    const next: BuilderTransform | null = type === "none" ? null : type === "decimal" ? { type, scale: 2, rounding: "reject" } : type === "date" ? { type, format: "utc_date" } : type === "affix" ? { type, prefix: "", suffix: "" } : type === "lookup" ? { type, entries: [], fallback: "reject" } : { type: type as "trim" | "upper" | "lower" }
    change(next ? [next, ...mapping.transforms.slice(1)] : [])
  }
  const id = `transform-${mapping.id}`
  return <div className="rb-transform">
    <label htmlFor={id}>{c.transform}</label>
    <select id={id} value={transform?.type ?? "none"} onChange={(event) => setType(event.target.value)}>
      {(["none", "trim", "upper", "lower", "decimal", "date", "affix", "lookup"] as const).map((key) => <option key={key} value={key}>{c[key]}</option>)}
    </select>
    {transform?.type === "decimal" && <div className="rb-pair">
      <label>{c.scale}<input type="number" min={0} max={4} value={transform.scale} onChange={(event) => change([{ ...transform, scale: Number(event.target.value) }, ...mapping.transforms.slice(1)])} /></label>
      <label>{c.rounding}<select aria-label={c.rounding} value={transform.rounding} onChange={(event) => change([{ ...transform, rounding: event.target.value as "reject" | "half_up" }, ...mapping.transforms.slice(1)])}><option value="reject">{c.rejectRounding}</option><option value="half_up">{c.half_up}</option></select></label>
    </div>}
    {transform?.type === "date" && <label>{c.date}<select aria-label={c.date} value={transform.format} onChange={(event) => change([{ ...transform, format: event.target.value as "utc_date" | "utc_timestamp" }, ...mapping.transforms.slice(1)])}><option value="utc_date">{c.utc_date}</option><option value="utc_timestamp">{c.utc_timestamp}</option></select></label>}
    {transform?.type === "affix" && <div className="rb-pair">{(["prefix", "suffix"] as const).map((key) => <label key={key}>{c[key]}<input value={transform[key]} onChange={(event) => change([{ ...transform, [key]: event.target.value }, ...mapping.transforms.slice(1)])} /></label>)}</div>}
    {transform?.type === "lookup" && <div className="rb-lookup">
      {transform.entries.map((entry, index) => <div className="rb-lookup-row" key={index}>
        <label>{c.lookupFrom}<input value={showValue(entry.from)} onChange={(event) => change([{ ...transform, entries: transform.entries.map((item, i) => i === index ? { ...item, from: literal(event.target.value) } : item) }, ...mapping.transforms.slice(1)])} /></label>
        <label>{c.lookupTo}<input value={showValue(entry.to)} onChange={(event) => change([{ ...transform, entries: transform.entries.map((item, i) => i === index ? { ...item, to: literal(event.target.value) } : item) }, ...mapping.transforms.slice(1)])} /></label>
        <button type="button" onClick={() => change([{ ...transform, entries: transform.entries.filter((_, i) => i !== index) }, ...mapping.transforms.slice(1)])}>{c.remove}</button>
      </div>)}
      <button type="button" onClick={() => change([{ ...transform, entries: [...transform.entries, { from: "", to: "" }] }, ...mapping.transforms.slice(1)])}>{c.addLookup}</button>
      <label>{c.fallback}<select aria-label={c.fallback} value={transform.fallback} onChange={(event) => change([{ ...transform, fallback: event.target.value as "keep" | "reject" }, ...mapping.transforms.slice(1)])}><option value="reject">{c.forbid}</option><option value="keep">{c.keep}</option></select></label>
    </div>}
  </div>
}

export function ReceiverBuilder({ locale = "ru", fetcher = fetch }: { locale?: BuilderLocale; fetcher?: typeof fetch }) {
  const c = RECEIVER_COPY[locale]
  const [profile, setProfile] = useState<BuilderProfile>(defaultBuilderProfile)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [catalogue, setCatalogue] = useState<BuilderField[]>([...BUILDER_FIELDS])
  const [draftId, setDraftId] = useState<string | undefined>()
  const [revision, setRevision] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [resource, setResource] = useState<BuilderResource>("customers")
  const [tab, setTab] = useState<"data" | "rules" | "delivery" | "review">("data")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sample, setSample] = useState("typical")
  const [raw, setRaw] = useState("")
  const [rawChanged, setRawChanged] = useState(false)
  const [logFrom, setLogFrom] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 16))
  const [logTo, setLogTo] = useState(() => new Date(Date.now() + 60000).toISOString().slice(0, 16))
  const [logFiles, setLogFiles] = useState<{ environment: string; files: Record<string, string> } | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const initial = useRef(true)
  const valid = builderProfileSchema.safeParse(profile).success
  const config = profile.resources.find((entry) => entry.resource === resource)!
  const fields = fieldsForResource(resource, catalogue)
  const conditionValue = (key: string, text: string) => {
    const kind = catalogue.find((entry) => entry.key === key)?.kind
    if (kind === "text" || kind === "date" || kind === "decimal") {
      const parsed = literal(text)
      return typeof parsed === "string" ? parsed : text
    }
    return literal(text)
  }
  const resourceLabels = { customers: c.customers, contacts: c.contacts, deals: c.deals }
  const edit = (next: BuilderProfile) => { if (next.environment !== profile.environment) setLogFiles(null); setProfile(next); setDirty(true); setPreview(null); setMessage(""); setError("") }
  const editResource = (next: Partial<BuilderProfile["resources"][number]>) => edit({ ...profile, resources: profile.resources.map((entry) => entry.resource === resource ? { ...entry, ...next } : entry) })
  const editMapping = (id: string, next: Partial<BuilderMapping>) => editResource({ mappings: config.mappings.map((entry) => entry.id === id ? { ...entry, ...next } : entry) })
  const replace = (draft?: Draft) => {
    setProfile(draft?.profile ?? defaultBuilderProfile()); setDraftId(draft?.id); setRevision(draft?.revision ?? 0); setDirty(false); setPreview(null); setError(""); setMessage(""); setResource(draft?.profile.resources[0].resource ?? "customers"); setRaw(""); setRawChanged(false); setLogFiles(null)
  }

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    fetcher(API, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("load_failed")
      const payload = await response.json()
      if (!active) return
      setDrafts(payload.data.drafts); setCatalogue(payload.data.fields); setHasMore(payload.data.hasMore)
      if (initial.current) { replace(payload.data.drafts[0]); initial.current = false }
    }).catch(() => { if (active) setError(c.error) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
    // Locale updates copy without replacing in-progress edits.
  }, [fetcher, c.error])

  useEffect(() => () => { if (logFiles) Object.values(logFiles.files).forEach((url) => URL.revokeObjectURL(url)) }, [logFiles])

  const save = async () => {
    setBusy(true); setError(""); setMessage("")
    try {
      const response = await fetcher(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(draftId ? { id: draftId } : {}), expectedRevision: revision, profile }) })
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await fetcher(API, { cache: "no-store" })
          if (latest.ok) setDrafts((await latest.json()).data.drafts)
          throw new Error("conflict")
        }
        throw new Error(response.status === 400 ? "invalid" : "save_failed")
      }
      const draft: Draft = (await response.json()).data
      setDraftId(draft.id); setRevision(draft.revision); setDirty(false); setMessage(c.saved)
      setDrafts((items) => [draft, ...items.filter((entry) => entry.id !== draft.id)])
    } catch (failure) { setError(failure instanceof Error && failure.message === "conflict" ? c.conflict : failure instanceof Error && failure.message === "invalid" ? c.invalid : c.error) }
    finally { setBusy(false) }
  }
  const runPreview = async () => {
    setBusy(true); setError(""); setPreview(null)
    try {
      const response = await fetcher(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", profile, resource, sample }) })
      if (!response.ok) throw new Error(response.status === 422 ? "sample_failed" : "preview_failed")
      setPreview((await response.json()).data)
    } catch (failure) { setError(failure instanceof Error && failure.message === "sample_failed" ? c.sampleFailure : c.error) }
    finally { setBusy(false) }
  }
  const applyImport = (text: string) => {
    try {
      const parsed = builderProfileSchema.safeParse(JSON.parse(text))
      if (!parsed.success) { setError(c.invalid); return }
      if (dirty && !window.confirm(c.confirmReplace)) return
      edit(parsed.data); setResource(parsed.data.resources[0].resource); setRaw(""); setRawChanged(false)
    } catch { setError(c.invalid) }
  }
  const exportDocument = async (action: "export_profile" | "export_contract") => {
    setBusy(true); setError("")
    try {
      const response = await fetcher(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, profile }) })
      if (!response.ok) throw new Error("export_failed")
      const result = await response.json()
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2) + "\n"], { type: "application/json" }))
      const link = document.createElement("a"); link.href = url; link.download = action === "export_profile" ? "receiver-profile.json" : "receiver-openapi-proposal.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError(c.error) }
    finally { setBusy(false) }
  }
  const reload = async () => {
    if ((dirty || rawChanged) && !window.confirm(c.confirmReplace)) return
    setLoading(true)
    try {
      const response = await fetcher(API, { cache: "no-store" })
      if (!response.ok) throw new Error("reload_failed")
      const data = (await response.json()).data
      setDrafts(data.drafts); setCatalogue(data.fields); setHasMore(data.hasMore)
      replace(data.drafts.find((entry: Draft) => entry.id === draftId))
    } catch { setError(c.error) }
    finally { setLoading(false) }
  }
  const exportLogs = async () => {
    setBusy(true); setError(""); setLogFiles(null)
    try {
      const parameters = new URLSearchParams({ environment: profile.environment, from: logFrom + ":00Z", to: logTo + ":00Z" })
      const response = await fetcher(API + "/logs?" + parameters, { cache: "no-store" })
      if (!response.ok) throw new Error("log_export_failed")
      const data = (await response.json()).data
      const files = {
        "security-events.jsonl": URL.createObjectURL(new Blob([data.jsonl], { type: "application/x-ndjson" })),
        "security-event.schema.json": URL.createObjectURL(new Blob([data.schema], { type: "application/json" })),
        "manifest.json": URL.createObjectURL(new Blob([JSON.stringify(data.manifest, null, 2) + "\n"], { type: "application/json" })),
      }
      setLogFiles({ environment: profile.environment, files })
    } catch { setError(c.logExportError) }
    finally { setBusy(false) }
  }

  return <div className="receiver-builder">
    <header className="rb-header"><div><span className="rb-eyebrow">CRM → ERP</span><h1>{c.title}</h1><p>{c.intro}</p></div><span className="rb-badge">{c.draft}</span></header>
    <div className="rb-notice"><strong>{c.preparation}</strong><p>{c.blocked}</p></div>
    <div className="rb-toolbar">
      <label>{c.profiles}<select aria-label={c.profiles} value={draftId ?? ""} disabled={loading || busy} onChange={(event) => {
        if ((dirty || rawChanged) && !window.confirm(c.confirmReplace)) return
        replace(drafts.find((entry) => entry.id === event.target.value))
      }}><option value="">{c.newProfile}</option>{drafts.map((entry) => <option value={entry.id} key={entry.id}>{entry.profile.label} · {entry.profile.environment} · v{entry.revision}</option>)}</select></label>
      <button type="button" disabled={busy || loading} onClick={() => { if ((!dirty && !rawChanged) || window.confirm(c.confirmReplace)) replace() }}>{c.newProfile}</button>
      <div className="rb-actions"><button type="button" disabled={!valid || rawChanged || busy || loading} onClick={save} className="rb-primary">{busy ? c.saving : c.save}</button></div>
    </div>
    {loading && <p role="status">{c.load}</p>}
    {hasMore && <p>{c.more}</p>}
    {message && <p className="rb-feedback" role="status">{message}</p>}
    {error && <div className="rb-error" role="alert"><p>{error}</p><button type="button" disabled={busy || loading} onClick={reload}>{c.retry}</button></div>}
    {!valid && <p className="rb-error" role="alert">{c.invalid}</p>}
    <fieldset disabled={busy || loading} className="rb-profile">
      <label>{c.name}<input value={profile.label} maxLength={120} onChange={(event) => edit({ ...profile, label: event.target.value })} /></label>
      <label>{c.environment}<select aria-label={c.environment} value={profile.environment} onChange={(event) => edit({ ...profile, environment: event.target.value as "TEST" | "PROD" })}><option value="TEST">TEST</option><option value="PROD">PROD</option></select></label>
      <div className="rb-version">{c.revision}: {revision || "—"}<span>{dirty ? c.unsaved : c.draft}</span></div>
    </fieldset>
    {(drafts.find((entry) => entry.id === draftId)?.history?.length ?? 0) > 0 && <label className="rb-history">{c.history}<select aria-label={c.history} value="" disabled={busy || loading} onChange={(event) => {
      const snapshot = drafts.find((entry) => entry.id === draftId)?.history?.find((entry) => String(entry.revision) === event.target.value)
      if (snapshot && (!(dirty || rawChanged) || window.confirm(c.confirmReplace))) { edit(snapshot.profile); setResource(snapshot.profile.resources[0].resource); setRawChanged(false) }
    }}><option value="">{c.restoreHint}</option>{drafts.find((entry) => entry.id === draftId)?.history?.map((entry) => <option value={entry.revision} key={entry.revision}>{c.revision} {entry.revision} · {entry.profile.label}</option>)}</select></label>}
    <nav className="rb-tabs" role="tablist" aria-label={c.title}>
      {(["data", "rules", "delivery", "review"] as const).map((key, index, tabs) => <button type="button" key={key} id={`rb-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`rb-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={(event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
        setTab(tabs[next]); document.getElementById(`rb-tab-${tabs[next]}`)?.focus()
      }}>{c[key]}</button>)}
    </nav>
    <div className="rb-workspace">
      <fieldset disabled={busy || loading} className="rb-editor" role="tabpanel" id={`rb-panel-${tab}`} aria-labelledby={`rb-tab-${tab}`}>
        {(tab === "data" || tab === "rules") && <div className="rb-resource-row"><label>{c.resource}<select aria-label={c.resource} value={resource} onChange={(event) => { setResource(event.target.value as BuilderResource); setPreview(null) }}>{profile.resources.map((entry) => <option value={entry.resource} key={entry.resource}>{resourceLabels[entry.resource]}</option>)}</select></label><label className="rb-check"><input type="checkbox" checked={config.enabled} onChange={(event) => editResource({ enabled: event.target.checked })} />{c.enabled}</label></div>}
        {tab === "data" && <>
          <p className="rb-hint">{c.sourceHint}</p>
          <div className="rb-mappings">{config.mappings.map((mapping, index) => <section className="rb-mapping" key={mapping.id}>
            <div className="rb-mapping-head"><span>{String(index + 1).padStart(2, "0")}</span><button type="button" aria-label={`${c.remove}: ${mapping.target}`} disabled={config.mappings.length === 1 || (config.enabled && mapping.source.type === "context" && ["eventId", "externalId", "entityVersion"].includes(mapping.source.field))} onClick={() => editResource({ mappings: config.mappings.filter((entry) => entry.id !== mapping.id) })}>{c.remove}</button></div>
            <div className="rb-pair"><label>{c.source}<select aria-label={c.source} value={sourceChoice(mapping)} onChange={(event) => {
              const choice = event.target.value
              editMapping(mapping.id, { source: choice === "constant" ? { type: "constant", value: "" } : choice.startsWith("ctx:") ? { type: "context", field: choice.slice(4) as typeof CONTEXT_FIELDS[number] } : { type: "field", field: choice } })
            }}><optgroup label={c.field}>{fields.map((entry) => <option key={entry.key} value={entry.key}>{entry.label[locale]}</option>)}</optgroup><optgroup label={c.context}>{CONTEXT_FIELDS.map((entry) => <option key={entry} value={`ctx:${entry}`}>{entry}</option>)}</optgroup><option value="constant">{c.constant}</option></select></label>
              <label>{c.target}<input value={mapping.target} spellCheck={false} onChange={(event) => editMapping(mapping.id, { target: event.target.value })} /></label></div>
            {mapping.source.type === "constant" && <label>{c.constant}<input value={showValue(mapping.source.value)} onChange={(event) => editMapping(mapping.id, { source: { type: "constant", value: literal(event.target.value) } })} /></label>}
            <div className="rb-pair"><label>{c.missing}<select aria-label={c.missing} value={mapping.missing} onChange={(event) => editMapping(mapping.id, { missing: event.target.value as BuilderMapping["missing"] })}>{(["omit", "null", "reject"] as const).map((key) => <option key={key} value={key}>{c[key]}</option>)}</select></label><TransformEditor mapping={mapping} c={c} change={(transforms) => editMapping(mapping.id, { transforms })} /></div>
          </section>)}</div>
          <button type="button" onClick={() => editResource({ mappings: [...config.mappings, { id: `mapping_${crypto.randomUUID().replaceAll("-", "")}`, target: `field_${config.mappings.length + 1}`, source: { type: "field", field: fields[0].key }, missing: "omit", transforms: [] }] })}>{c.add}</button>
        </>}
        {tab === "rules" && <>
          <div className="rb-pair"><label>{c.selection}<select aria-label={c.selection} value={config.selection.mode} onChange={(event) => editResource({ selection: { ...config.selection, mode: event.target.value as "manual" | "all" | "filtered" } })}>{(["manual", "all", "filtered"] as const).map((key) => <option value={key} key={key}>{c[key]}</option>)}</select></label><label>{c.selection}<select aria-label={c.rules} value={config.selection.match} disabled={config.selection.mode !== "filtered"} onChange={(event) => editResource({ selection: { ...config.selection, match: event.target.value as "all" | "any" } })}><option value="all">{c.matchAll}</option><option value="any">{c.matchAny}</option></select></label></div>
          {config.selection.mode === "filtered" && <div className="rb-conditions">
            {config.selection.conditions.map((condition, index) => <div className="rb-condition" key={index}>
              <label>{c.field}<select aria-label={c.field} value={condition.field} onChange={(event) => editResource({ selection: { ...config.selection, conditions: config.selection.conditions.map((entry, i) => i === index ? { ...entry, field: event.target.value } : entry) } })}>{fields.map((entry) => <option value={entry.key} key={entry.key}>{entry.label[locale]}</option>)}</select></label>
              <label>{c.selection}<select aria-label={c.selection} value={condition.operator} onChange={(event) => {
                const operator = event.target.value as typeof condition.operator
                editResource({ selection: { ...config.selection, conditions: config.selection.conditions.map((entry, i) => i === index ? { ...entry, operator, value: ["in", "not_in"].includes(operator) ? [""] : null } : entry) } })
              }}>{(["eq", "not_eq", "in", "not_in", "exists", "missing", "gte", "lte"] as const).map((key) => <option value={key} key={key}>{key === "missing" ? c.missingValue : c[key]}</option>)}</select></label>
              <label>{c.value}<input disabled={["exists", "missing"].includes(condition.operator)} value={Array.isArray(condition.value) ? condition.value.map(showValue).join(",") : showValue(condition.value) ?? ""} onChange={(event) => editResource({ selection: { ...config.selection, conditions: config.selection.conditions.map((entry, i) => i === index ? { ...entry, value: ["in", "not_in"].includes(entry.operator) ? event.target.value.split(",").map((item) => conditionValue(entry.field, item.trim())) : conditionValue(entry.field, event.target.value) } : entry) } })} /></label>
              <button type="button" aria-label={`${c.remove}: ${index + 1}`} onClick={() => editResource({ selection: { ...config.selection, conditions: config.selection.conditions.filter((_, i) => i !== index) } })}>{c.remove}</button>
            </div>)}<p className="rb-hint">{c.listHint}</p><button type="button" onClick={() => editResource({ selection: { ...config.selection, conditions: [...config.selection.conditions, { field: fields[0].key, operator: "exists", value: null }] } })}>{c.addCondition}</button>
          </div>}
        </>}
        {tab === "delivery" && <>
          <h2>{c.path}</h2><p className="rb-hint">{c.pathHint}</p>
          {profile.resources.map((entry) => <div className="rb-endpoint" key={entry.resource}><span>{resourceLabels[entry.resource]}</span><label>{c.method}<select aria-label={c.method} value={entry.method} onChange={(event) => edit({ ...profile, resources: profile.resources.map((item) => item.resource === entry.resource ? { ...item, method: event.target.value as "POST" | "PUT" } : item) })}><option>PUT</option><option>POST</option></select></label><label>{c.path}<input value={entry.path} onChange={(event) => edit({ ...profile, resources: profile.resources.map((item) => item.resource === entry.resource ? { ...item, path: event.target.value } : item) })} /></label></div>)}
          <h2>{c.schedule}</h2><div className="rb-pair"><label>{c.schedule}<select aria-label={c.schedule} value={profile.schedule.mode} onChange={(event) => edit({ ...profile, schedule: { ...profile.schedule, mode: event.target.value as BuilderProfile["schedule"]["mode"] } })}>{(["manual", "on_change", "interval"] as const).map((key) => <option value={key} key={key}>{c[key]}</option>)}</select></label><label>{c.intervalSeconds}<input type="number" min={60} max={86400} disabled={profile.schedule.mode !== "interval"} value={profile.schedule.intervalSeconds} onChange={(event) => edit({ ...profile, schedule: { ...profile.schedule, intervalSeconds: Number(event.target.value) } })} /></label></div>
          <h2>{c.limits}</h2><div className="rb-pair">{Object.entries(profile.limits).map(([key, value]) => <label key={key}>{c[key as keyof ReceiverCopy]}<input type="number" min={1} value={value} onChange={(event) => edit({ ...profile, limits: { ...profile.limits, [key]: Number(event.target.value) } })} /></label>)}</div>
          <h2>{c.receipts}</h2><div className="rb-pair">{Object.entries(profile.receipt).map(([key, value]) => <label key={key}>{c[key as keyof ReceiverCopy]}<input value={value} onChange={(event) => edit({ ...profile, receipt: { ...profile.receipt, [key]: event.target.value } })} /></label>)}</div>
        </>}
        {tab === "review" && <>
          <h2>{c.logs}</h2><p className="rb-hint">{c.logsHint}</p><div className="rb-log-sources">{defaultBuilderProfile().logSources.map((source) => <label key={source} className="rb-check"><input type="checkbox" checked={profile.logSources.includes(source)} onChange={(event) => edit({ ...profile, logSources: event.target.checked ? [...profile.logSources, source] : profile.logSources.filter((entry) => entry !== source) })} />{RECEIVER_LOG_LABELS[locale][source]}</label>)}</div>
          <label>{c.retention}<input type="number" min={1} max={365} value={profile.logRetentionDays} onChange={(event) => edit({ ...profile, logRetentionDays: Number(event.target.value) })} /></label>
          <h2>{c.logExport}</h2><p className="rb-hint">{c.logExportHint}</p>
          <div className="rb-pair"><label>{c.logFrom}<input type="datetime-local" value={logFrom} onChange={(event) => { setLogFrom(event.target.value); setLogFiles(null) }} /></label><label>{c.logTo}<input type="datetime-local" value={logTo} onChange={(event) => { setLogTo(event.target.value); setLogFiles(null) }} /></label></div>
          <button type="button" disabled={!logFrom || !logTo} onClick={exportLogs}>{c.logExport}</button>
          {logFiles && <div className="rb-file-actions">{Object.entries(logFiles.files).map(([name, url]) => <a key={name} href={url} download={name}>{name}</a>)}</div>}
          <div className="rb-file-actions"><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{c.import}</button><button type="button" disabled={busy || loading || !valid || rawChanged} onClick={() => exportDocument("export_profile")}>{c.export}</button><button type="button" disabled={busy || loading || !valid || rawChanged} onClick={() => exportDocument("export_contract")}>{c.contractExport}</button><input ref={fileInput} type="file" accept="application/json,.json" aria-label={c.import} hidden onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 256 * 1024) setError(c.invalid); else applyImport(await file.text()) } event.target.value = "" }} /></div>
          <p className="rb-hint">{c.contractHint}</p>
          <details onToggle={(event) => { if (event.currentTarget.open && !rawChanged) setRaw(JSON.stringify(profile, null, 2)) }}><summary>{c.advanced}</summary><p className="rb-hint">{c.rawHint}</p>{rawChanged && <p role="status">{c.unsaved}</p>}<textarea aria-label={c.advanced} value={raw} rows={24} spellCheck={false} onChange={(event) => { setRaw(event.target.value); setRawChanged(true) }} /><button type="button" onClick={() => applyImport(raw)}>{c.apply}</button></details>
        </>}
      </fieldset>
      <aside className="rb-preview" aria-label={c.synthetic}>
        <div className="rb-preview-title"><h2>{c.synthetic}</h2><span className="rb-badge">TEST</span></div>
        <label>{c.resource}<select aria-label={c.resource} value={resource} disabled={busy || loading} onChange={(event) => { setResource(event.target.value as BuilderResource); setPreview(null) }}>{profile.resources.map((entry) => <option value={entry.resource} key={entry.resource}>{resourceLabels[entry.resource]}</option>)}</select></label>
        <label>{c.sample}<select aria-label={c.sample} value={sample} disabled={busy || loading} onChange={(event) => { setSample(event.target.value); setPreview(null) }}>{(["typical", "missing_optional", "precision"] as const).map((key) => <option value={key} key={key}>{c[key]}</option>)}</select></label>
        <button type="button" disabled={busy || loading || rawChanged || !valid} className="rb-primary" onClick={runPreview}>{c.preview}</button><p className="rb-hint">{c.previewHint}</p>
        {preview ? <div aria-live="polite"><p className="rb-preview-status">{preview.selected ? c.selected : c.notSelected}</p><p className="rb-request">{preview.method} {preview.path}</p><pre>{JSON.stringify(JSON.parse(preview.body), null, 2)}</pre><p>{c.bytes}: {preview.bytes}</p>{preview.omitted.length > 0 && <p>{c.omitted}: {preview.omitted.join(", ")}</p>}</div> : <p className="rb-empty">{c.noPreview}</p>}
      </aside>
    </div>
  </div>
}
