"use client"

/**
 * D8 Loyalty — slice-2-full Phase B admin UI: earn-rule catalog.
 *
 * Admin CRUD over LoyaltyEarnRule. Each rule answers "how does this
 * trigger (purchase / signup / referral / ...) translate into points?"
 * Rules are evaluated in (priority DESC, createdAt ASC) order; first
 * match wins.
 *
 * Slice-2-full earn-pipeline (D8 Phase C) reads from this table.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { InfoHint } from "@/components/info-hint"
import { LoyaltyFormActions } from "@/components/loyalty/loyalty-form-actions"
import { LoyaltyConfirmDialog } from "@/components/loyalty/loyalty-confirm-dialog"
import { buildEarnRuleWizardPayload, type EarnRuleWizardScenario } from "@/lib/loyalty/ux"
import {
  AlertCircle,
  Coins,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react"

type Trigger =
  | "purchase"
  | "deal_won"
  | "signup"
  | "referral"
  | "birthday"
  | "review"
  | "survey"
  | "custom"

const TRIGGERS: Trigger[] = [
  "purchase",
  "deal_won",
  "signup",
  "referral",
  "birthday",
  "review",
  "survey",
  "custom",
]

interface LoyaltyEarnRuleRow {
  id: string
  organizationId: string
  name: string
  trigger: string
  pointsRate: number | null
  pointsFlat: number | null
  minOrderAmount: number | null
  productCategory: string | null
  priority: number
  applyTierMultiplier: boolean
  isActive: boolean
  validFrom: string | null
  validUntil: string | null
  metadata: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  rules: LoyaltyEarnRuleRow[]
  total: number
}

interface FormState {
  name: string
  trigger: Trigger
  pointsRate: string
  pointsFlat: string
  minOrderAmount: string
  productCategory: string
  priority: string
  applyTierMultiplier: boolean
  isActive: boolean
  validFrom: string
  validUntil: string
}

const EMPTY_FORM: FormState = {
  name: "",
  trigger: "purchase",
  pointsRate: "",
  pointsFlat: "",
  minOrderAmount: "",
  productCategory: "",
  priority: "0",
  applyTierMultiplier: true,
  isActive: true,
  validFrom: "",
  validUntil: "",
}

const BUSINESS_SCENARIOS: Trigger[] = ["purchase", "signup", "referral", "birthday", "review", "survey", "custom"]

function defaultFlatForTrigger(trigger: Trigger): string {
  if (trigger === "signup") return "100"
  if (trigger === "referral") return "250"
  if (trigger === "birthday") return "100"
  if (trigger === "review" || trigger === "survey") return "50"
  return "100"
}

function toIsoOrNull(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  // YYYY-MM-DDTHH:mm for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EarnRulesSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("slice2.loyaltyEarnRules")
  const tc = useTranslations("slice2.common")

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [triggerFilter, setTriggerFilter] = useState<Trigger | "">("")
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("")

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LoyaltyEarnRuleRow | null>(null)

  const load = useCallback(async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (triggerFilter) params.set("trigger", triggerFilter)
      if (activeFilter) params.set("active", activeFilter)
      const qs = params.toString() ? `?${params.toString()}` : ""
      const res = await fetch(`/api/v1/loyalty-earn-rules${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ListResponse
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [activeFilter, tc, triggerFilter])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      name: t("defaultRuleNames.purchase"),
      pointsRate: "1",
    })
    setAdvancedOpen(false)
    setShowForm(true)
  }

  function openEdit(row: LoyaltyEarnRuleRow) {
    setEditingId(row.id)
    setForm({
      name: row.name,
      trigger: row.trigger as Trigger,
      pointsRate: row.pointsRate === null ? "" : String(row.pointsRate),
      pointsFlat: row.pointsFlat === null ? "" : String(row.pointsFlat),
      minOrderAmount:
        row.minOrderAmount === null ? "" : String(row.minOrderAmount),
      productCategory: row.productCategory ?? "",
      priority: String(row.priority),
      applyTierMultiplier: row.applyTierMultiplier,
      isActive: row.isActive,
      validFrom: toLocalInput(row.validFrom),
      validUntil: toLocalInput(row.validUntil),
    })
    setAdvancedOpen(true)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setAdvancedOpen(false)
  }

  function chooseScenario(trigger: Trigger) {
    const purchaseLike = trigger === "purchase" || trigger === "deal_won"
    setForm({
      ...form,
      trigger,
      name: form.name.trim() ? form.name : t(`defaultRuleNames.${trigger}`),
      pointsRate: purchaseLike ? form.pointsRate || "1" : "",
      pointsFlat: purchaseLike ? "" : form.pointsFlat || defaultFlatForTrigger(trigger),
      minOrderAmount: purchaseLike ? form.minOrderAmount : "",
      applyTierMultiplier: purchaseLike,
    })
  }

  function chooseAwardType(type: "rate" | "flat") {
    setForm({
      ...form,
      pointsRate: type === "rate" ? form.pointsRate || "1" : "",
      pointsFlat: type === "flat" ? form.pointsFlat || defaultFlatForTrigger(form.trigger) : "",
    })
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!form.name.trim()) throw new Error(t("errorNameRequired"))
      const rate = form.pointsRate.trim() === "" ? null : Number(form.pointsRate)
      const flat = form.pointsFlat.trim() === "" ? null : Number(form.pointsFlat)
      if (rate === null && flat === null) {
        throw new Error(t("errorAwardRequired"))
      }
      if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
        throw new Error(t("errorRateInvalid"))
      }
      if (flat !== null && (!Number.isInteger(flat) || flat < 0)) {
        throw new Error(t("errorFlatInvalid"))
      }
      if (rate !== null && flat !== null) {
        throw new Error(t("errorSingleAward"))
      }
      const moa =
        form.minOrderAmount.trim() === "" ? null : Number(form.minOrderAmount)
      if (moa !== null && (!Number.isFinite(moa) || moa < 0)) {
        throw new Error(t("errorMinOrderInvalid"))
      }
      const prio = Number(form.priority)
      if (!Number.isInteger(prio)) {
        throw new Error(t("errorPriorityInvalid"))
      }

      let res: Response
      if (editingId) {
        const payload = {
          name: form.name.trim(),
          trigger: form.trigger,
          pointsRate: rate,
          pointsFlat: flat,
          minOrderAmount: moa,
          productCategory: form.productCategory.trim() || null,
          priority: prio,
          applyTierMultiplier: form.applyTierMultiplier,
          isActive: form.isActive,
          validFrom: toIsoOrNull(form.validFrom),
          validUntil: toIsoOrNull(form.validUntil),
        }
        // PATCH — drop `trigger` (immutable for taxonomy stability).
        const { trigger: _trigger, ...patchable } = payload
        void _trigger
        res = await fetch(`/api/v1/loyalty-earn-rules/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patchable),
        })
      } else {
        const payload = buildEarnRuleWizardPayload({
          name: form.name,
          scenario: form.trigger as EarnRuleWizardScenario,
          awardType,
          pointsRate: rate,
          pointsFlat: flat,
          minOrderAmount: moa,
          productCategory: form.productCategory,
          priority: prio,
          applyTierMultiplier: form.applyTierMultiplier,
          isActive: form.isActive,
          validFrom: toIsoOrNull(form.validFrom),
          validUntil: toIsoOrNull(form.validUntil),
        })
        res = await fetch("/api/v1/loyalty-earn-rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      }
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

  async function remove(row: LoyaltyEarnRuleRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/loyalty-earn-rules/${row.id}`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorDeleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(row: LoyaltyEarnRuleRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/loyalty-earn-rules/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setBusy(false)
    }
  }

  const rules = data?.rules ?? []
  const noRules = !loading && rules.length === 0
  const awardType: "rate" | "flat" = form.pointsRate.trim() !== "" && form.pointsFlat.trim() === "" ? "rate" : "flat"
  const showAdvanced = !!editingId || advancedOpen
  const showPurchaseFields = form.trigger === "purchase" || form.trigger === "deal_won"
  const exampleAmount = 100
  const previewPoints =
    form.pointsRate.trim() !== ""
      ? Math.round(exampleAmount * Number(form.pointsRate || 0))
      : Number(form.pointsFlat || 0)
  const hasDualAward = form.pointsRate.trim() !== "" && form.pointsFlat.trim() !== ""

  return (
      <div className="max-w-6xl mx-auto">
        <header className={`mb-6 flex items-start gap-4 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
          {!embedded && (
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Coins className="w-8 h-8 text-primary" />
                {t("title")}
                <HelpButton slug="loyalty-earn-rules" variant="label" />
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl">
                {t("subtitle")}
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={openCreate}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {t("newRule")}
            </button>
            <button
              onClick={load}
              disabled={loading || busy}
              className="inline-flex items-center gap-2 px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
              aria-label={tc("refresh")}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium">{t("filterTrigger")}</label>
          <select
            value={triggerFilter}
            onChange={(e) => setTriggerFilter(e.target.value as Trigger | "")}
            className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
          >
            <option value="">{t("filterAll")}</option>
            {TRIGGERS.map((tr) => (
              <option key={tr} value={tr}>
                {t(`triggers.${tr}`)}
              </option>
            ))}
          </select>
          <label className="text-xs font-medium ml-2">{t("filterStatus")}</label>
          <select
            value={activeFilter}
            onChange={(e) =>
              setActiveFilter(e.target.value as "" | "true" | "false")
            }
            className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
          >
            <option value="">{t("filterAll")}</option>
            <option value="true">{t("statusActive")}</option>
            <option value="false">{t("statusInactive")}</option>
          </select>
        </div>

        {error && (
          <MotionCard className="mb-4 p-4 border border-destructive bg-destructive/10 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </MotionCard>
        )}

        {showForm && (
          <MotionCard className="mb-6 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                {editingId ? t("editRule") : t("createRule")}
              </h2>
              <button
                onClick={closeForm}
                className="p-1 rounded hover:bg-muted"
                aria-label={tc("close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <LoyaltyFormActions
              busy={busy}
              cancelLabel={tc("cancel")}
              submitLabel={editingId ? tc("save") : tc("create")}
              helperText={tc("liveFormHint")}
              submitDisabled={!form.name.trim()}
              onCancel={closeForm}
              onSubmit={submit}
            />
            {!editingId && (
              <div className="mb-4 space-y-4">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t("wizardScenario")}</p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {BUSINESS_SCENARIOS.map((tr) => (
                      <button
                        key={tr}
                        type="button"
                        onClick={() => chooseScenario(tr)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                          form.trigger === tr ? "border-primary bg-primary/5 text-foreground" : "hover:bg-muted"
                        }`}
                      >
                        <span className="font-medium">{t(`triggers.${tr}`)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t(`scenarioHelp.${tr}`)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t("wizardAwardType")}</p>
                  <div className="inline-flex rounded-lg bg-muted p-0.5">
                    <button
                      type="button"
                      onClick={() => chooseAwardType("rate")}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium ${awardType === "rate" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    >
                      {t("awardTypeRate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseAwardType("flat")}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium ${awardType === "flat" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    >
                      {t("awardTypeFlat")}
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/60 p-3 text-sm">
                  <p className="font-medium">{t("wizardPreviewTitle")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {awardType === "rate"
                      ? t("wizardPreviewRate", { amount: exampleAmount, points: Number.isFinite(previewPoints) ? previewPoints : 0 })
                      : t("wizardPreviewFlat", { points: Number.isFinite(previewPoints) ? previewPoints : 0 })}
                  </p>
                  {hasDualAward && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      {t("warningDualAward")}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldName")}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
                />
              </div>
              <div className={editingId ? "" : "hidden"}>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldTrigger")} {editingId ? `(${t("triggerImmutable")})` : ""} <InfoHint text={t("hintTrigger")} />
                </label>
                <select
                  value={form.trigger}
                  onChange={(e) =>
                    setForm({ ...form, trigger: e.target.value as Trigger })
                  }
                  disabled={!!editingId}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm disabled:bg-muted disabled:text-muted-foreground"
                >
                  {TRIGGERS.map((tr) => (
                    <option key={tr} value={tr}>
                      {t(`triggers.${tr}`)}
                    </option>
                  ))}
                </select>
              </div>
              {(awardType === "rate" || showAdvanced) && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldPointsRate")} <InfoHint text={t("hintPointsRate")} />
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.pointsRate}
                  onChange={(e) =>
                    setForm({ ...form, pointsRate: e.target.value })
                  }
                  placeholder={t("phPointsRate")}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                />
              </div>
              )}
              {(awardType === "flat" || showAdvanced) && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldPointsFlat")} <InfoHint text={t("hintPointsFlat")} />
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.pointsFlat}
                  onChange={(e) =>
                    setForm({ ...form, pointsFlat: e.target.value })
                  }
                  placeholder={t("phPointsFlat")}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                />
              </div>
              )}
              {(showPurchaseFields || showAdvanced) && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldMinOrder")} <InfoHint text={t("hintMinOrder")} />
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minOrderAmount}
                  onChange={(e) =>
                    setForm({ ...form, minOrderAmount: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                />
              </div>
              )}
              {showAdvanced && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldProductCategory")}
                </label>
                <input
                  type="text"
                  value={form.productCategory}
                  onChange={(e) =>
                    setForm({ ...form, productCategory: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
                />
              </div>
              )}
              {showAdvanced && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldPriority")} <InfoHint text={t("hintPriority")} />
                </label>
                <input
                  type="number"
                  step="1"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                />
              </div>
              )}
              {showAdvanced && (
              <div className="flex items-center gap-2 pt-6">
                <input
                  id="rule-apply-multiplier"
                  type="checkbox"
                  checked={form.applyTierMultiplier}
                  onChange={(e) =>
                    setForm({ ...form, applyTierMultiplier: e.target.checked })
                  }
                />
                <label
                  htmlFor="rule-apply-multiplier"
                  className="text-sm cursor-pointer select-none"
                >
                  {t("fieldApplyTierMultiplier")} <InfoHint text={t("hintApplyTierMultiplier")} />
                </label>
              </div>
              )}
              {showAdvanced && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldValidFrom")}
                </label>
                <input
                  type="datetime-local"
                  value={form.validFrom}
                  onChange={(e) =>
                    setForm({ ...form, validFrom: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
                />
              </div>
              )}
              {showAdvanced && (
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldValidUntil")}
                </label>
                <input
                  type="datetime-local"
                  value={form.validUntil}
                  onChange={(e) =>
                    setForm({ ...form, validUntil: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
                />
              </div>
              )}
              <div className="flex items-center gap-2 md:col-span-2">
                <input
                  id="rule-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                />
                <label
                  htmlFor="rule-active"
                  className="text-sm cursor-pointer select-none"
                >
                  {t("fieldActive")}
                </label>
              </div>
            </div>
            {!editingId && (
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="mt-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {advancedOpen ? t("hideAdvanced") : t("showAdvanced")}
              </button>
            )}
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && noRules && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="text-sm mt-1">{t("emptyDesc")}</p>
          </MotionCard>
        )}

        {!loading && rules.length > 0 && (
          <div className="space-y-2">
            {rules.map((row) => (
              <MotionCard key={row.id} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium truncate">{row.name}</p>
                      <span className="px-2 py-0.5 bg-muted text-xs rounded">
                        {t(`triggers.${row.trigger}`)}
                      </span>
                      {!row.isActive && (
                        <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded">
                          {t("statusInactive")}
                        </span>
                      )}
                    </div>
                    <p className="mb-1 text-sm text-foreground">
                      {row.pointsRate !== null
                        ? t("summaryRate", {
                            trigger: t(`triggers.${row.trigger}`),
                            rate: row.pointsRate,
                            min:
                              row.minOrderAmount === null
                                ? t("summaryAnyPurchase")
                                : t("summaryFromAmount", { min: row.minOrderAmount }),
                            tier: row.applyTierMultiplier ? t("summaryTierStack") : t("summaryNoTierStack"),
                          })
                        : t("summaryFlat", {
                            trigger: t(`triggers.${row.trigger}`),
                            points: row.pointsFlat ?? 0,
                            tier: row.applyTierMultiplier ? t("summaryTierStack") : t("summaryNoTierStack"),
                          })}
                    </p>
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
                        {t("advancedDetails")}
                      </summary>
                      <p className="mt-1">
                        {row.pointsRate !== null && (
                          <span className="mr-3">
                            {t("colRate")}: {row.pointsRate}
                          </span>
                        )}
                        {row.pointsFlat !== null && (
                          <span className="mr-3">
                            {t("colFlat")}: {row.pointsFlat}
                          </span>
                        )}
                        {row.minOrderAmount !== null && (
                          <span className="mr-3">
                            {t("colMinOrder")}: {row.minOrderAmount}
                          </span>
                        )}
                        <span className="mr-3">
                          {t("colPriority")}: {row.priority}
                        </span>
                        {!row.applyTierMultiplier && (
                          <span className="mr-3">{t("noTierStack")}</span>
                        )}
                      </p>
                    </details>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleActive(row)}
                      disabled={busy}
                      className="px-2 py-1 border border-zinc-200 dark:border-zinc-700 rounded-md text-xs hover:bg-muted disabled:opacity-50"
                    >
                      {row.isActive ? t("disable") : t("enable")}
                    </button>
                    <button
                      onClick={() => openEdit(row)}
                      disabled={busy}
                      className="p-2 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-muted disabled:opacity-50"
                      aria-label={tc("edit")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(row)}
                      disabled={busy}
                      className="p-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      aria-label={tc("delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </MotionCard>
            ))}
          </div>
        )}
        <LoyaltyConfirmDialog
          open={!!deleteTarget}
          title={deleteTarget ? t("deleteDialogTitle", { name: deleteTarget.name }) : ""}
          description={deleteTarget ? t("confirmDelete", { name: deleteTarget.name }) : ""}
          confirmLabel={tc("delete")}
          cancelLabel={tc("cancel")}
          busy={busy}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          onConfirm={() => {
            if (deleteTarget) void remove(deleteTarget)
          }}
        />
      </div>
  )
}
