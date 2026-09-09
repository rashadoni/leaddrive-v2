"use client"

/**
 * D8 Loyalty — slice-2-full Phase D-2 admin UI: promo-code catalog.
 *
 * Admin CRUD over PromoCode. Operators can:
 *   - Create a new promo code (UPPER alphanumeric slug, percentage/fixed,
 *     optional limits + validity window)
 *   - Edit existing code (description, discountValue, limits, window,
 *     active). `code` and `discountType` immutable post-create.
 *   - Toggle active (PATCH isActive)
 *   - Hard-delete (blocked if any redemptions exist; deactivate instead)
 *
 * Operator gets per-code redemption count surface to see "12/100 used".
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { InfoHint } from "@/components/info-hint"
import { LoyaltyFormActions } from "@/components/loyalty/loyalty-form-actions"
import { LoyaltyConfirmDialog } from "@/components/loyalty/loyalty-confirm-dialog"
import {
  AlertCircle,
  Loader2,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  X,
} from "lucide-react"

type DiscountType = "percentage" | "fixed"

interface PromoCodeRow {
  id: string
  organizationId: string
  code: string
  description: string | null
  discountType: string
  discountValue: number
  currency: string | null
  minOrderAmount: number | null
  usageLimit: number | null
  perCustomerLimit: number | null
  validFrom: string | null
  validUntil: string | null
  isActive: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
  redemptionCount: number
}

interface ListResponse {
  codes: PromoCodeRow[]
  total: number
}

interface FormState {
  code: string
  description: string
  discountType: DiscountType
  discountValue: string
  currency: string
  minOrderAmount: string
  usageLimit: string
  perCustomerLimit: string
  validFrom: string
  validUntil: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  code: "",
  description: "",
  discountType: "percentage",
  discountValue: "",
  currency: "AZN",
  minOrderAmount: "",
  usageLimit: "",
  perCustomerLimit: "",
  validFrom: "",
  validUntil: "",
  isActive: true,
}

const PROMO_PRESETS = [
  { key: "tenPercent", code: "SAVE10", discountType: "percentage" as const, discountValue: "10" },
  { key: "welcome", code: "WELCOME", discountType: "percentage" as const, discountValue: "15" },
  { key: "fixedAmount", code: "TAKE5", discountType: "fixed" as const, discountValue: "5" },
] as const

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
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function PromosSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("slice2.promoCodes")
  const tc = useTranslations("slice2.common")

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("")

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<PromoCodeRow | null>(null)

  const load = useCallback(async function load() {
    setLoading(true)
    try {
      const qs = activeFilter ? `?active=${activeFilter}` : ""
      const res = await fetch(`/api/v1/promo-codes${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ListResponse
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }, [activeFilter, tc])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(row: PromoCodeRow) {
    setEditingId(row.id)
    setForm({
      code: row.code,
      description: row.description ?? "",
      discountType: row.discountType as DiscountType,
      discountValue: String(row.discountValue),
      currency: row.currency ?? "",
      minOrderAmount:
        row.minOrderAmount === null ? "" : String(row.minOrderAmount),
      usageLimit: row.usageLimit === null ? "" : String(row.usageLimit),
      perCustomerLimit:
        row.perCustomerLimit === null ? "" : String(row.perCustomerLimit),
      validFrom: toLocalInput(row.validFrom),
      validUntil: toLocalInput(row.validUntil),
      isActive: row.isActive,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function applyPreset(preset: (typeof PROMO_PRESETS)[number]) {
    setForm({
      ...form,
      code: preset.code,
      description: t(`presetDescriptions.${preset.key}`),
      discountType: preset.discountType,
      discountValue: preset.discountValue,
      currency: preset.discountType === "fixed" ? "AZN" : form.currency,
      isActive: true,
    })
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!editingId && !form.code.trim()) throw new Error(t("errorCodeRequired"))
      const dv = Number(form.discountValue)
      if (!Number.isFinite(dv) || dv <= 0) {
        throw new Error(t("errorDiscountInvalid"))
      }
      if (form.discountType === "percentage" && dv > 100) {
        throw new Error(t("errorPctMax"))
      }
      const moa =
        form.minOrderAmount.trim() === "" ? null : Number(form.minOrderAmount)
      if (moa !== null && (!Number.isFinite(moa) || moa < 0)) {
        throw new Error(t("errorMinOrderInvalid"))
      }
      const ul = form.usageLimit.trim() === "" ? null : Number(form.usageLimit)
      if (ul !== null && (!Number.isInteger(ul) || ul < 0)) {
        throw new Error(t("errorUsageLimitInvalid"))
      }
      const pcl =
        form.perCustomerLimit.trim() === "" ? null : Number(form.perCustomerLimit)
      if (pcl !== null && (!Number.isInteger(pcl) || pcl < 0)) {
        throw new Error(t("errorPerCustomerInvalid"))
      }
      const currency =
        form.discountType === "fixed" ? form.currency.trim().toUpperCase() : null
      if (form.discountType === "fixed" && (!currency || currency.length < 3)) {
        throw new Error(t("errorCurrencyRequired"))
      }

      const basePayload = {
        description: form.description.trim() || null,
        discountValue: dv,
        currency,
        minOrderAmount: moa,
        usageLimit: ul,
        perCustomerLimit: pcl,
        validFrom: toIsoOrNull(form.validFrom),
        validUntil: toIsoOrNull(form.validUntil),
        isActive: form.isActive,
      }

      let res: Response
      if (editingId) {
        // PATCH — drop code + discountType (immutable post-create).
        const { currency: _c, ...patchable } = basePayload
        void _c
        const finalPatch =
          form.discountType === "fixed"
            ? { ...patchable, currency }
            : patchable
        res = await fetch(`/api/v1/promo-codes/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(finalPatch),
        })
      } else {
        res = await fetch("/api/v1/promo-codes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: form.code.trim().toUpperCase(),
            discountType: form.discountType,
            ...basePayload,
          }),
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

  async function remove(row: PromoCodeRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/promo-codes/${row.id}`, {
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

  async function toggleActive(row: PromoCodeRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/promo-codes/${row.id}`, {
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

  const codes = data?.codes ?? []
  const noCodes = !loading && codes.length === 0

  return (
      <div className="max-w-6xl mx-auto">
        <header className={`mb-6 flex items-start gap-4 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
          {!embedded && (
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Tag className="w-8 h-8 text-primary" />
                {t("title")}
                <HelpButton slug="loyalty-promo-codes" variant="label" />
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
              {t("newCode")}
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

        <div className="mb-4 flex items-center gap-2">
          <label className="text-xs font-medium">{t("filterStatus")}</label>
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
                {editingId ? t("editCode") : t("createCode")}
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
              onCancel={closeForm}
              onSubmit={submit}
            />
            {!editingId && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t("presetsTitle")}</p>
                <div className="flex flex-wrap gap-2">
                  {PROMO_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                    >
                      {t(`presets.${preset.key}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-4 rounded-lg border bg-muted/60 p-3 text-sm">
              <p className="font-medium">{t("previewTitle")}</p>
              <p className="mt-1 text-muted-foreground">
                {t("previewBody", {
                  code: form.code || "SUMMER25",
                  discount: form.discountType === "percentage" ? `${form.discountValue || 10}%` : `${form.discountValue || 5} ${form.currency || "AZN"}`,
                })}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2 border-b pb-1 text-xs font-semibold text-muted-foreground">
                {t("sectionCodeDiscount")}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldCode")} {editingId ? `(${t("codeImmutable")})` : ""}
                </label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) =>
                    setForm({ ...form, code: e.target.value.toUpperCase() })
                  }
                  disabled={!!editingId}
                  placeholder="SUMMER25"
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono uppercase disabled:bg-muted disabled:text-muted-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {t("fieldDiscountType")} {editingId ? `(${t("typeImmutable")})` : ""}
                </label>
                <select
                  value={form.discountType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      discountType: e.target.value as DiscountType,
                    })
                  }
                  disabled={!!editingId}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm disabled:bg-muted disabled:text-muted-foreground"
                >
                  <option value="percentage">{t("typePercentage")}</option>
                  <option value="fixed">{t("typeFixed")}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  {form.discountType === "percentage"
                    ? t("fieldDiscountPct")
                    : t("fieldDiscountFixed")}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discountValue}
                  onChange={(e) =>
                    setForm({ ...form, discountValue: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                />
              </div>
              {form.discountType === "fixed" && (
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("fieldCurrency")}
                  </label>
                  <select
                    value={form.currency}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        currency: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm uppercase font-mono"
                  >
                    <option value="AZN">AZN</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              )}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  {t("fieldDescription")}
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
                />
              </div>
              <div className="md:col-span-2 border-b pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                {t("sectionRestrictions")}
              </div>
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("fieldUsageLimit")} <InfoHint text={t("hintUsageLimit")} />
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.usageLimit}
                    onChange={(e) =>
                      setForm({ ...form, usageLimit: e.target.value })
                    }
                    placeholder={t("phUnlimited")}
                    className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    {t("fieldPerCustomerLimit")} <InfoHint text={t("hintPerCustomerLimit")} />
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.perCustomerLimit}
                    onChange={(e) =>
                      setForm({ ...form, perCustomerLimit: e.target.value })
                    }
                    placeholder={t("phUnlimited")}
                    className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
                  />
                </div>
              </div>
              <div className="md:col-span-2 border-b pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                {t("sectionValidity")}
              </div>
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
              <div className="md:col-span-2 border-b pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                {t("sectionStatus")}
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <input
                  id="code-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                />
                <label
                  htmlFor="code-active"
                  className="text-sm cursor-pointer select-none"
                >
                  {t("fieldActive")}
                </label>
              </div>
            </div>
          </MotionCard>
        )}

        {loading && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
            {tc("loading")}
          </MotionCard>
        )}

        {!loading && noCodes && (
          <MotionCard className="p-12 text-center text-muted-foreground">
            <Tag className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="text-sm mt-1">{t("emptyDesc")}</p>
          </MotionCard>
        )}

        {!loading && codes.length > 0 && (
          <div className="space-y-2">
            {codes.map((row) => (
              <MotionCard key={row.id} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono font-semibold text-base">
                        {row.code}
                      </span>
                      <span className="px-2 py-0.5 bg-muted text-xs rounded inline-flex items-center gap-1">
                        {row.discountType === "percentage" ? (
                          <>
                            <Percent className="w-3 h-3" />
                            {row.discountValue}%
                          </>
                        ) : (
                          <>
                            {row.discountValue} {row.currency}
                          </>
                        )}
                      </span>
                      {!row.isActive && (
                        <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded">
                          {t("statusInactive")}
                        </span>
                      )}
                    </div>
                    {row.description && (
                      <p className="text-sm text-muted-foreground mb-1">
                        {row.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      <span className="mr-3">
                        {t("colUsed")}: {row.redemptionCount}
                        {row.usageLimit !== null ? `/${row.usageLimit}` : ""}
                      </span>
                      {row.perCustomerLimit !== null && (
                        <span className="mr-3">
                          {t("colPerCustomer")}: {row.perCustomerLimit}
                        </span>
                      )}
                      {row.minOrderAmount !== null && (
                        <span className="mr-3">
                          {t("colMinOrder")}: {row.minOrderAmount}
                        </span>
                      )}
                    </p>
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
          title={deleteTarget ? t("deleteDialogTitle", { code: deleteTarget.code }) : ""}
          description={deleteTarget ? t("confirmDelete", { code: deleteTarget.code }) : ""}
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
