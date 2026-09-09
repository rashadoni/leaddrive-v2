"use client"

/**
 * C9 Marketing Attribution — models UI.
 *
 * Lists AttributionModels with type / status / config summary and latest
 * computation-run info, and lets admins author them: create / edit config /
 * set-default / activate / archive / delete (POST/PATCH/DELETE
 * /api/v1/attribution-models). The recompute worker that fills influences is
 * Phase 3. `custom` models are offered with a 3-point curve preset (early /
 * mid / late, positions 0 / 0.5 / 1); arbitrary multi-point curves are
 * API-only and shown read-only on edit (the preset can't represent them).
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import {
  AlertCircle,
  Activity,
  Archive,
  Calculator,
  ChartPie,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Star,
  Trash2,
  X,
  XCircle,
} from "lucide-react"

interface LatestRun {
  status: string
  triggerSource: string
  dealsTotal: number
  dealsProcessed: number
  influencesWritten: number
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  errorMessage: string | null
  createdAt: string
}

interface Model {
  id: string
  name: string
  description: string | null
  modelType: string
  config: Record<string, unknown> | null
  status: string
  isDefault: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  influenceCount: number
  attributedRevenue: number
  pipelineInfluenceCount: number
  pipelineRevenue: number
  latestRun: LatestRun | null
}

interface BreakdownRow {
  campaignId: string
  campaignName: string
  dealCount: number
  attributedRevenue: number
}

interface ModelsResponse {
  models: Model[]
  totalModels: number
  activeModelCount: number
  totalTouchpoints: number
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  draft: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  archived: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
}

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-600",
  running: "text-blue-600",
  succeeded: "text-green-600",
  failed: "text-red-600",
}

// Authoring offers the 5 standard models + a `custom` piecewise-linear curve
// (3 control points: early / mid / late, at normalized positions 0 / 0.5 / 1).
const CREATE_MODEL_TYPES = [
  "first_touch",
  "last_touch",
  "linear",
  "time_decay",
  "u_shaped",
  "custom",
] as const

const DEFAULT_HALF_LIFE_DAYS = 7
const DEFAULT_U_FIRST = 0.4
const DEFAULT_U_MIDDLE = 0.2
const DEFAULT_U_LAST = 0.4
const U_SUM_TOLERANCE = 1e-6
// Neutral default custom curve (flat → renormalizes to linear; user shapes it).
const DEFAULT_CURVE = 1

interface FormState {
  name: string
  description: string
  modelType: string
  halfLifeDays: string // time_decay
  firstWeight: string // u_shaped
  middleWeight: string // u_shaped
  lastWeight: string // u_shaped
  // custom — N control points (position 0..1 → relative weight), kept as
  // editable strings; weights are renormalized server-side. ≥2 points. Replaces
  // the old fixed 3-point preset so arbitrary curves are fully editable here.
  curve: { position: string; weight: string }[]
  createActive: boolean // create-only
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  modelType: "linear",
  halfLifeDays: String(DEFAULT_HALF_LIFE_DAYS),
  firstWeight: String(DEFAULT_U_FIRST),
  middleWeight: String(DEFAULT_U_MIDDLE),
  lastWeight: String(DEFAULT_U_LAST),
  curve: [
    { position: "0", weight: String(DEFAULT_CURVE) },
    { position: "0.5", weight: String(DEFAULT_CURVE) },
    { position: "1", weight: String(DEFAULT_CURVE) },
  ],
  createActive: false,
}

/**
 * Build the config object POSTed/PATCHed for a given model type from form knobs.
 * The N-point custom curve editor can represent any stored curve, so there's no
 * longer a "locked, API-managed" fallback — points are emitted sorted by position.
 */
function buildConfig(form: FormState): Record<string, unknown> {
  if (form.modelType === "time_decay") {
    return { halfLifeDays: Number(form.halfLifeDays) }
  }
  if (form.modelType === "u_shaped") {
    return {
      firstWeight: Number(form.firstWeight),
      middleWeight: Number(form.middleWeight),
      lastWeight: Number(form.lastWeight),
    }
  }
  if (form.modelType === "custom") {
    return {
      curve: form.curve
        .map((p) => ({ position: Number(p.position), weight: Number(p.weight) }))
        .sort((a, b) => a.position - b.position),
    }
  }
  return {} // first_touch / last_touch / linear take no knobs
}

/**
 * Practice-based custom-curve presets — one click fills the control points. The
 * 5 standalone models cover the basics; these are the multi-point shapes people
 * commonly reach for inside the custom editor.
 */
const CURVE_PRESETS: { key: string; points: [string, string][] }[] = [
  { key: "equal", points: [["0", "1"], ["0.5", "1"], ["1", "1"]] },
  { key: "firstLean", points: [["0", "5"], ["0.5", "2"], ["1", "1"]] },
  { key: "lastLean", points: [["0", "1"], ["0.5", "2"], ["1", "5"]] },
  { key: "uShaped", points: [["0", "5"], ["0.5", "1"], ["1", "5"]] },
  { key: "wShaped", points: [["0", "5"], ["0.25", "1"], ["0.5", "5"], ["0.75", "1"], ["1", "5"]] },
]

/** Live preview of a custom curve — plots the points (position x → weight y) with
 *  linear interpolation so the user SEES the shape instead of reading raw numbers. */
function CurvePreview({ points }: { points: { position: string; weight: string }[] }) {
  const pts = points
    .map((p) => ({ x: Number(p.position), y: Number(p.weight) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y > 0)
    .sort((a, b) => a.x - b.x)
  if (pts.length < 2) return null
  const W = 320
  const H = 56
  const pad = 6
  const maxY = Math.max(...pts.map((p) => p.y))
  const sx = (x: number) => pad + x * (W - 2 * pad)
  const sy = (y: number) => H - pad - (y / maxY) * (H - 2 * pad)
  const line = pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")
  const area = `${sx(pts[0].x).toFixed(1)},${H - pad} ${line} ${sx(pts[pts.length - 1].x).toFixed(1)},${H - pad}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-14 text-primary" aria-hidden>
      <polygon points={area} fill="currentColor" fillOpacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function formatRevenue(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${Math.round(n)}`
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—"
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${minutes}m ${s}s` : `${minutes}m`
}

interface RelativeLabels {
  justNow: string
  hoursAgo: (n: number) => string
  daysAgo: (n: number) => string
  monthsAgo: (n: number) => string
}

function formatRelative(iso: string | null, labels: RelativeLabels): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000)
    if (hours < 1) return labels.justNow
    return labels.hoursAgo(hours)
  }
  if (days < 30) return labels.daysAgo(days)
  return labels.monthsAgo(Math.floor(days / 30))
}

interface ConfigLabels {
  halfLife: (days: number) => string
  uShapedSplit: (first: number, middle: number, last: number) => string
  customCurve: (points: number) => string
}

function describeConfig(
  modelType: string,
  config: Record<string, unknown> | null,
  labels: ConfigLabels,
): string | null {
  if (!config) return null
  if (modelType === "time_decay" && typeof config.halfLifeDays === "number") {
    return labels.halfLife(config.halfLifeDays)
  }
  if (modelType === "u_shaped") {
    const first = typeof config.firstWeight === "number" ? config.firstWeight : null
    const last = typeof config.lastWeight === "number" ? config.lastWeight : null
    const middle = typeof config.middleWeight === "number" ? config.middleWeight : null
    if (first !== null && last !== null && middle !== null) {
      return labels.uShapedSplit(
        Math.round(first * 100),
        Math.round(middle * 100),
        Math.round(last * 100),
      )
    }
  }
  if (modelType === "custom" && Array.isArray(config.curve)) {
    return labels.customCurve(config.curve.length)
  }
  return null
}

export default function AttributionModelsPage() {
  const t = useTranslations("slice2.attributionModels")
  const tc = useTranslations("slice2.common")
  const relLabels: RelativeLabels = {
    justNow: t("relJustNow"),
    hoursAgo: (n) => t("relHoursAgo", { n }),
    daysAgo: (n) => t("relDaysAgo", { n }),
    monthsAgo: (n) => t("relMonthsAgo", { n }),
  }
  const configLabels: ConfigLabels = {
    halfLife: (days) => t("configHalfLife", { days }),
    uShapedSplit: (first, middle, last) =>
      t("configUShapedSplit", { first, middle, last }),
    customCurve: (points) => t("configCustomCurve", { points }),
  }
  const [data, setData] = useState<ModelsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Authoring state.
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  // ── custom-curve N-point editors ──
  const setCurvePoint = (i: number, field: "position" | "weight", value: string) =>
    setForm((f) => ({ ...f, curve: f.curve.map((p, j) => (j === i ? { ...p, [field]: value } : p)) }))
  const addCurvePoint = () => setForm((f) => ({ ...f, curve: [...f.curve, { position: "1", weight: String(DEFAULT_CURVE) }] }))
  const applyCurvePreset = (preset: [string, string][]) =>
    setForm((f) => ({ ...f, curve: preset.map(([position, weight]) => ({ position, weight })) }))
  const removeCurvePoint = (i: number) =>
    setForm((f) => (f.curve.length <= 2 ? f : { ...f, curve: f.curve.filter((_, j) => j !== i) }))

  // Per-campaign breakdown drill-down (lazy-loaded per model).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [breakdown, setBreakdown] = useState<Record<string, BreakdownRow[]>>({})
  const [breakdownLoading, setBreakdownLoading] = useState<string | null>(null)

  async function fetchBreakdown(m: Model) {
    setBreakdownLoading(m.id)
    try {
      const res = await fetch(`/api/v1/attribution-models/${m.id}/influences`)
      const json = await res.json()
      if (res.ok) setBreakdown((b) => ({ ...b, [m.id]: json.campaigns ?? [] }))
    } catch {
      /* leave empty; UI shows the empty state */
    } finally {
      setBreakdownLoading(null)
    }
  }

  async function toggleBreakdown(m: Model) {
    if (expandedId === m.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(m.id)
    if (!breakdown[m.id]) await fetchBreakdown(m)
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/attribution-models")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }

  // Mirrors loyalty/tiers: fetch once on mount; refresh button + mutations
  // re-invoke load() directly. (Plain fn + empty deps avoids re-running on
  // every render from an unstable `tc` reference.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(m: Model) {
    const cfg = (m.config ?? {}) as Record<string, unknown>
    const num = (v: unknown, d: number) => (typeof v === "number" ? String(v) : String(d))
    // Load the stored curve verbatim into the N-point editor (sorted by
    // position); fall back to the neutral 3-point preset when there's none.
    const curve = Array.isArray(cfg.curve)
      ? (cfg.curve as Array<{ position?: number; weight?: number }>)
          .filter((p) => typeof p?.position === "number" && typeof p?.weight === "number")
          .sort((a, b) => (a.position as number) - (b.position as number))
          .map((p) => ({ position: String(p.position), weight: String(p.weight) }))
      : []
    setEditingId(m.id)
    setForm({
      name: m.name,
      description: m.description ?? "",
      modelType: m.modelType,
      halfLifeDays: num(cfg.halfLifeDays, DEFAULT_HALF_LIFE_DAYS),
      firstWeight: num(cfg.firstWeight, DEFAULT_U_FIRST),
      middleWeight: num(cfg.middleWeight, DEFAULT_U_MIDDLE),
      lastWeight: num(cfg.lastWeight, DEFAULT_U_LAST),
      curve: curve.length >= 2 ? curve : EMPTY_FORM.curve,
      createActive: false,
    })
    setError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  /** Client-side validation mirroring model-config-validator on the server. */
  function validateForm(): string | null {
    if (!form.name.trim()) return t("errorNameRequired")
    if (form.modelType === "time_decay") {
      const h = Number(form.halfLifeDays)
      if (!Number.isFinite(h) || h <= 0) return t("errorHalfLifePositive")
    }
    if (form.modelType === "u_shaped") {
      const ws = [Number(form.firstWeight), Number(form.middleWeight), Number(form.lastWeight)]
      if (ws.some((w) => !Number.isFinite(w) || w < 0 || w > 1)) return t("errorUShapedRange")
      if (Math.abs(ws[0] + ws[1] + ws[2] - 1) > U_SUM_TOLERANCE) return t("errorUShapedSum")
    }
    if (form.modelType === "custom") {
      // ≥2 control points; each position ∈ [0,1] finite; each weight > 0 finite
      // (weights are relative — renormalized server-side). Mirrors the validator.
      if (form.curve.length < 2) return t("errorCustomCurvePoints")
      const bad = form.curve.some((p) => {
        const pos = Number(p.position)
        const w = Number(p.weight)
        return !Number.isFinite(pos) || pos < 0 || pos > 1 || !Number.isFinite(w) || w <= 0
      })
      if (bad) return t("errorCustomWeights")
    }
    return null
  }

  async function submit() {
    if (busy) return
    const verr = validateForm()
    if (verr) {
      setError(verr)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const config = buildConfig(form)
      const res = editingId
        ? await fetch(`/api/v1/attribution-models/${editingId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: form.name.trim(),
              description: form.description.trim() || null,
              config,
            }),
          })
        : await fetch("/api/v1/attribution-models", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: form.name.trim(),
              description: form.description.trim() || null,
              modelType: form.modelType,
              config,
              status: form.createActive ? "active" : "draft",
            }),
          })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      closeForm()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setBusy(false)
    }
  }

  async function patchModel(m: Model, body: Record<string, unknown>, fallbackErr: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/attribution-models/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackErr)
    } finally {
      setBusy(false)
    }
  }

  function setDefault(m: Model) {
    void patchModel(m, { isDefault: true }, tc("errorGeneric"))
  }
  function activate(m: Model) {
    void patchModel(m, { status: "active" }, tc("errorGeneric"))
  }
  function archive(m: Model) {
    if (!confirm(t("confirmArchive", { name: m.name }))) return
    void patchModel(m, { status: "archived" }, tc("errorGeneric"))
  }

  async function remove(m: Model) {
    if (busy) return
    if (!confirm(t("confirmDelete", { name: m.name }))) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/attribution-models/${m.id}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorDeleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  // Trigger the background recompute for this model (the route 202-queues it and
  // runs the worker off-request to dodge the 504 on huge orgs), then poll the
  // model's latest run until it finishes. Polls silently (no loading flash) and
  // caps at ~24s — a very large org may still be "running" after that, and the
  // user can refresh to watch it finish; the win is the request no longer 504s.
  async function recompute(m: Model) {
    if (busy) return
    setBusy(true)
    setError(null)
    const startedAt = Date.now()
    try {
      const res = await fetch(`/api/v1/attribution-models/${m.id}/recompute`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      let done = false
      for (let i = 0; i < 12 && !done; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          const r = await fetch("/api/v1/attribution-models")
          if (r.ok) {
            const j: ModelsResponse = await r.json()
            setData(j)
            const run = j.models.find((x) => x.id === m.id)?.latestRun
            if (
              run &&
              new Date(run.createdAt).getTime() >= startedAt - 5000 &&
              (run.status === "succeeded" || run.status === "failed")
            ) {
              done = true
              if (run.status === "failed") setError(run.errorMessage ?? tc("errorGeneric"))
            }
          }
        } catch {
          // transient network blip — keep polling
        }
      }
      // Recompute changed this model's influences → invalidate the cached
      // breakdown; refresh it in place if the user has it open.
      setBreakdown((b) => {
        const next = { ...b }
        delete next[m.id]
        return next
      })
      if (expandedId === m.id) await fetchBreakdown(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MotionPage className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <ChartPie className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="attribution-models" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={openCreate}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {t("newModel")}
            </button>
            <button
              onClick={() => void load()}
              disabled={loading || busy}
              aria-label={tc("refresh")}
              className="flex items-center justify-center px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {showForm && (
          <MotionCard className="mb-6 p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {editingId ? t("editModel") : t("createModel")}
              </h2>
              <button
                onClick={closeForm}
                aria-label={tc("close")}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("formName")}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("formNamePlaceholder")}
                  maxLength={120}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("formDescription")}</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t("formDescriptionPlaceholder")}
                  maxLength={500}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("formModelType")}</label>
                {editingId ? (
                  // modelType is immutable post-create (DB trigger) — show read-only.
                  <div className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/40 text-sm">
                    {t(`modelTypeLabels.${form.modelType}`)}
                  </div>
                ) : (
                  <select
                    value={form.modelType}
                    onChange={(e) => setForm({ ...form, modelType: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                  >
                    {CREATE_MODEL_TYPES.map((mt) => (
                      <option key={mt} value={mt}>
                        {t(`modelTypeLabels.${mt}`)}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {t(`modelTypeDescs.${form.modelType}`)}
                </p>
              </div>

              {form.modelType === "time_decay" && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t("formHalfLifeDays")}</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={form.halfLifeDays}
                    onChange={(e) => setForm({ ...form, halfLifeDays: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t("formHalfLifeHint")}</p>
                </div>
              )}

              {form.modelType === "u_shaped" && (
                <div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("formUShapedFirst")}</label>
                      <input
                        type="number" min="0" max="1" step="0.05"
                        value={form.firstWeight}
                        onChange={(e) => setForm({ ...form, firstWeight: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("formUShapedMiddle")}</label>
                      <input
                        type="number" min="0" max="1" step="0.05"
                        value={form.middleWeight}
                        onChange={(e) => setForm({ ...form, middleWeight: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("formUShapedLast")}</label>
                      <input
                        type="number" min="0" max="1" step="0.05"
                        value={form.lastWeight}
                        onChange={(e) => setForm({ ...form, lastWeight: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("formUShapedHint")}</p>
                </div>
              )}

              {form.modelType === "custom" && (
                <div>
                  {/* practice-based preset shapes — one click fills the curve */}
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("curvePresetsLabel")}</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {CURVE_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => applyCurvePreset(p.points)}
                        className="px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 text-xs hover:border-primary hover:text-primary transition"
                      >
                        {t(`curvePreset.${p.key}`)}
                      </button>
                    ))}
                  </div>
                  {/* live preview of the resulting shape + journey axis */}
                  <CurvePreview points={form.curve} />
                  <div className="flex justify-between px-1 mb-3 text-[10px] text-muted-foreground">
                    <span>{t("curveAxisStart")}</span>
                    <span>{t("curveAxisEnd")}</span>
                  </div>
                  <div className="flex items-center gap-2 px-1 mb-1 text-xs font-medium text-muted-foreground">
                    <span className="flex-1">{t("formCurvePosition")}</span>
                    <span className="flex-1">{t("formCurveWeight")}</span>
                    <span className="w-7" />
                  </div>
                  <div className="space-y-2">
                    {form.curve.map((pt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="number" min="0" max="1" step="0.05"
                          value={pt.position}
                          onChange={(e) => setCurvePoint(i, "position", e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm"
                        />
                        <input
                          type="number" min="0.01" step="0.1"
                          value={pt.weight}
                          onChange={(e) => setCurvePoint(i, "weight", e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeCurvePoint(i)}
                          disabled={form.curve.length <= 2}
                          title={t("formCurveRemovePoint")}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-600 disabled:opacity-30 disabled:hover:text-muted-foreground"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addCurvePoint}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" /> {t("formCurveAddPoint")}
                  </button>
                  <p className="text-xs text-muted-foreground mt-1">{t("formCurveHint")}</p>
                </div>
              )}

              {!editingId && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.createActive}
                    onChange={(e) => setForm({ ...form, createActive: e.target.checked })}
                  />
                  {t("formCreateActive")}
                </label>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={submit}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {tc("save")}
              </button>
              <button
                onClick={closeForm}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm hover:bg-muted disabled:opacity-50"
              >
                {tc("cancel")}
              </button>
            </div>
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">{t("kpiTotalModels")}</p>
                <p className="text-2xl font-bold mt-1">{data.totalModels}</p>
              </MotionCard>
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  {t("kpiActive")}
                </p>
                <p className="text-2xl font-bold mt-1">
                  {data.activeModelCount}
                </p>
              </MotionCard>
              <MotionCard className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  {t("kpiTouchpoints")}
                </p>
                <p className="text-2xl font-bold mt-1">
                  {data.totalTouchpoints.toLocaleString()}
                </p>
              </MotionCard>
            </div>

            {data.models.length === 0 ? (
              <MotionCard className="p-12 text-center text-muted-foreground">
                <ChartPie className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  {t("emptyDesc")}
                </p>
              </MotionCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.models.map((m) => {
                  const configSummary = describeConfig(m.modelType, m.config, configLabels)
                  // Zero-attribution diagnostic: the last run finished cleanly
                  // yet produced no influences. Split the two actionable causes —
                  // no won deals at all vs. won deals with no matching touchpoints.
                  const zeroReason =
                    m.status !== "archived" &&
                    m.influenceCount === 0 &&
                    m.latestRun?.status === "succeeded"
                      ? m.latestRun.dealsTotal === 0
                        ? "noDeals"
                        : "noTouchpoints"
                      : null
                  return (
                    <MotionCard
                      key={m.id}
                      className={`p-5 border border-zinc-200 dark:border-zinc-700 rounded-lg ${
                        m.isDefault ? "border-primary" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-semibold truncate">
                              {m.name}
                            </h3>
                            {m.isDefault && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-primary/10 text-primary border border-primary/30">
                                <Star className="w-3 h-3" />
                                {t("default")}
                              </span>
                            )}
                          </div>
                          {m.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {m.description}
                            </p>
                          )}
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-xs shrink-0 ${
                            STATUS_COLORS[m.status] ?? STATUS_COLORS.draft
                          }`}
                        >
                          {t(`statusLabels.${m.status}`)}
                        </span>
                      </div>

                      <div className="mb-3 pb-3 border-b">
                        <p className="text-sm font-medium">
                          {t(`modelTypeLabels.${m.modelType}`)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t(`modelTypeDescs.${m.modelType}`)}
                        </p>
                        {configSummary && (
                          <p className="text-xs text-muted-foreground mt-1 font-mono">
                            {configSummary}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {t("influences")}
                          </p>
                          <p className="font-mono font-semibold">
                            {m.influenceCount.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {t("attributedRevenue")}
                          </p>
                          <p className="font-mono font-semibold">
                            {formatRevenue(m.attributedRevenue)}
                          </p>
                        </div>
                      </div>

                      {m.pipelineRevenue > 0 && (
                        <p className="text-xs text-muted-foreground -mt-1 mb-3 flex items-center gap-1">
                          <Activity className="w-3 h-3 text-amber-500 shrink-0" />
                          {t("pipelineProjected", {
                            revenue: formatRevenue(m.pipelineRevenue),
                            count: m.pipelineInfluenceCount.toLocaleString(),
                          })}
                        </p>
                      )}

                      {m.influenceCount > 0 && (
                        <div className="mb-3">
                          <button
                            onClick={() => toggleBreakdown(m)}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {expandedId === m.id ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                            {expandedId === m.id ? t("breakdownHide") : t("breakdownShow")}
                          </button>
                          {expandedId === m.id && (
                            <div className="mt-2 rounded border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                              {breakdownLoading === m.id ? (
                                <div className="p-3 text-xs text-muted-foreground text-center">
                                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                                  {tc("loading")}
                                </div>
                              ) : (breakdown[m.id]?.length ?? 0) === 0 ? (
                                <div className="p-3 text-xs text-muted-foreground text-center">
                                  {t("breakdownEmpty")}
                                </div>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/50">
                                    <tr className="text-left">
                                      <th className="px-2 py-1.5 font-medium">{t("colCampaign")}</th>
                                      <th className="px-2 py-1.5 font-medium text-right">{t("colDeals")}</th>
                                      <th className="px-2 py-1.5 font-medium text-right">{t("colRevenue")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {breakdown[m.id]!.map((r) => (
                                      <tr
                                        key={r.campaignId}
                                        className="border-t border-zinc-100 dark:border-zinc-800"
                                      >
                                        <td className="px-2 py-1.5 truncate max-w-[10rem]">
                                          {r.campaignName}
                                        </td>
                                        <td className="px-2 py-1.5 text-right font-mono">
                                          {r.dealCount.toLocaleString()}
                                        </td>
                                        <td className="px-2 py-1.5 text-right font-mono">
                                          {formatRevenue(r.attributedRevenue)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {m.latestRun ? (
                        <div className="pt-3 border-t">
                          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            {t("latestRun")}
                          </p>
                          <div className="flex items-center gap-2 text-sm">
                            {m.latestRun.status === "succeeded" ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                            ) : m.latestRun.status === "failed" ? (
                              <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                            )}
                            <span
                              className={
                                RUN_STATUS_COLORS[m.latestRun.status] ?? ""
                              }
                            >
                              {t(`runStatusLabels.${m.latestRun.status}`)}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">
                              {t(`triggerLabels.${m.latestRun.triggerSource}`)}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">
                              {formatRelative(m.latestRun.createdAt, relLabels)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                            <p>
                              {t("deals", { processed: m.latestRun.dealsProcessed, total: m.latestRun.dealsTotal })}
                            </p>
                            <p>
                              {t("influencesWritten", { written: m.latestRun.influencesWritten, duration: formatDuration(m.latestRun.durationMs) })}
                            </p>
                            {m.latestRun.errorMessage && (
                              <p className="text-red-600 dark:text-red-400 truncate">
                                {t("errorPrefix")}: {m.latestRun.errorMessage}
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="pt-3 border-t text-xs text-muted-foreground">
                          {t("noRuns")}
                        </div>
                      )}

                      {zeroReason && (
                        <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                            <Info className="w-3.5 h-3.5 shrink-0" />
                            {t("zeroTitle")}
                          </p>
                          {zeroReason === "noDeals" ? (
                            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-200/80">
                              {t("zeroNoDeals")}
                            </p>
                          ) : (
                            <>
                              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-200/80">
                                {t("zeroNoTouchpoints", { deals: m.latestRun!.dealsTotal })}
                              </p>
                              <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-xs text-amber-700 dark:text-amber-200/80">
                                <li>{t("zeroCheckLink")}</li>
                                <li>{t("zeroCheckTouchpoints")}</li>
                                <li>{t("zeroCheckBackfill")}</li>
                              </ul>
                            </>
                          )}
                        </div>
                      )}

                      <div className="pt-3 mt-3 border-t flex flex-wrap gap-2">
                        <button
                          onClick={() => openEdit(m)}
                          disabled={busy}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-zinc-200 dark:border-zinc-700 hover:bg-muted disabled:opacity-50"
                        >
                          <Pencil className="w-3 h-3" /> {t("actionEdit")}
                        </button>
                        {m.status !== "archived" && (
                          <button
                            onClick={() => recompute(m)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                          >
                            <Calculator className="w-3 h-3" /> {t("actionRecompute")}
                          </button>
                        )}
                        {!m.isDefault && m.status !== "archived" && (
                          <button
                            onClick={() => setDefault(m)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-zinc-200 dark:border-zinc-700 hover:bg-muted disabled:opacity-50"
                          >
                            <Star className="w-3 h-3" /> {t("actionSetDefault")}
                          </button>
                        )}
                        {m.status === "draft" && (
                          <button
                            onClick={() => activate(m)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
                          >
                            <Power className="w-3 h-3" /> {t("actionActivate")}
                          </button>
                        )}
                        {m.status !== "archived" && (
                          <button
                            onClick={() => archive(m)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-zinc-200 dark:border-zinc-700 hover:bg-muted disabled:opacity-50"
                          >
                            <Archive className="w-3 h-3" /> {t("actionArchive")}
                          </button>
                        )}
                        <button
                          onClick={() => remove(m)}
                          disabled={busy}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 ml-auto"
                        >
                          <Trash2 className="w-3 h-3" /> {t("actionDelete")}
                        </button>
                      </div>
                    </MotionCard>
                  )
                })}
              </div>
            )}
          </>
        )}

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>{t("footerTouchpoints")}</p>
          <p>{t("footerSlices")}</p>
        </div>
      </div>
    </MotionPage>
  )
}
