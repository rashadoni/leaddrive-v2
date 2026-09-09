"use client"

/**
 * D8 Loyalty Builder — "Rewards" tab (redeem catalog admin, Phase 2).
 *
 * CRUD over /api/v1/loyalty-rewards: the tenant defines what members can spend
 * their points on (name, description, pointsCost, optional stockLimit). Members
 * redeem these from the portal (Phase 3). Same shape as the Tiers/Earning/Promos
 * sections; takes the `embedded` prop so the Builder renders it tab-style.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { InfoHint } from "@/components/info-hint"
import { LoyaltyFormActions } from "@/components/loyalty/loyalty-form-actions"
import { LoyaltyConfirmDialog } from "@/components/loyalty/loyalty-confirm-dialog"
import {
  Gift,
  Plus,
  RefreshCw,
  X,
  AlertCircle,
  Pencil,
  Trash2,
} from "lucide-react"

interface LoyaltyRewardRow {
  id: string
  name: string
  description: string | null
  pointsCost: number
  stockLimit: number | null
  isActive: boolean
}

interface FormState {
  name: string
  description: string
  pointsCost: string
  stockLimit: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  pointsCost: "",
  stockLimit: "",
  isActive: true,
}

const REWARD_EXAMPLES = [
  { key: "freeCoffee", name: "Free coffee", pointsCost: "100" },
  { key: "discount10", name: "10% discount", pointsCost: "250" },
  { key: "giftItem", name: "Gift item", pointsCost: "500" },
  { key: "freeDelivery", name: "Free delivery", pointsCost: "150" },
] as const

export function RewardsSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("slice2.loyaltyRewards")
  const tc = useTranslations("slice2.common")

  const [rewards, setRewards] = useState<LoyaltyRewardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<LoyaltyRewardRow | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/v1/loyalty-rewards")
      if (!r.ok) throw new Error("fetch failed")
      const j = await r.json()
      setRewards(j.rewards ?? [])
    } catch {
      setError(tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(row: LoyaltyRewardRow) {
    setEditingId(row.id)
    setForm({
      name: row.name,
      description: row.description ?? "",
      pointsCost: String(row.pointsCost),
      stockLimit: row.stockLimit === null ? "" : String(row.stockLimit),
      isActive: row.isActive,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function applyExample(example: (typeof REWARD_EXAMPLES)[number]) {
    setForm({
      ...form,
      name: t(`examples.${example.key}`),
      description: t(`exampleDescriptions.${example.key}`),
      pointsCost: example.pointsCost,
      isActive: true,
    })
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const pointsCost = Number(form.pointsCost)
      if (!Number.isInteger(pointsCost) || pointsCost <= 0) {
        throw new Error(t("errorPointsCost"))
      }
      if (!form.name.trim()) throw new Error(t("errorNameRequired"))
      const stockLimit = form.stockLimit.trim() === "" ? null : Number(form.stockLimit)
      if (stockLimit !== null && (!Number.isInteger(stockLimit) || stockLimit < 0)) {
        throw new Error(t("errorStockLimit"))
      }
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        pointsCost,
        stockLimit,
        isActive: form.isActive,
      }
      const r = await fetch(
        editingId ? `/api/v1/loyalty-rewards/${editingId}` : "/api/v1/loyalty-rewards",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || tc("errorGeneric"))
      }
      closeForm()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: LoyaltyRewardRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/v1/loyalty-rewards/${row.id}`, { method: "DELETE" })
      if (!r.ok) throw new Error(tc("errorDeleteFailed"))
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorDeleteFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <header className={`mb-6 flex items-start gap-4 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && (
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Gift className="w-8 h-8 text-primary" />
              {t("title")}
              {/* loyalty-rewards has no Help article yet (the help-content area is
                  owned by a parallel session); reuse the registered Builder slug.
                  This header only renders when NOT embedded — the Builder always
                  embeds it, so it's effectively unused in the live path. */}
              <HelpButton slug="loyalty-builder" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">{t("subtitle")}</p>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={openCreate}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {t("newReward")}
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
              {editingId ? t("editReward") : t("createReward")}
            </h2>
            <button onClick={closeForm} className="p-1 rounded hover:bg-muted" aria-label={tc("close")}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <LoyaltyFormActions
            busy={busy}
            cancelLabel={tc("cancel")}
            submitLabel={tc("save")}
            helperText={tc("liveFormHint")}
            onCancel={closeForm}
            onSubmit={submit}
          />
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("examplesTitle")}</p>
            <div className="flex flex-wrap gap-2">
              {REWARD_EXAMPLES.map((example) => (
                <button
                  key={example.key}
                  type="button"
                  onClick={() => applyExample(example)}
                  className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {t(`examples.${example.key}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4 rounded-lg border bg-muted/60 p-3 text-sm">
            <p className="font-medium">{t("portalPreviewTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("portalPreviewBody", {
                name: form.name || t("fieldName"),
                points: Number(form.pointsCost || 0).toLocaleString(),
              })}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1">{t("fieldName")}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("phName")}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1">{t("fieldDescription")}</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("fieldPointsCost")} <InfoHint text={t("hintPointsCost")} />
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.pointsCost}
                onChange={(e) => setForm({ ...form, pointsCost: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("fieldStockLimit")} <InfoHint text={t("hintStockLimit")} />
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.stockLimit}
                onChange={(e) => setForm({ ...form, stockLimit: e.target.value })}
                placeholder={t("phUnlimited")}
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="reward-active"
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <label htmlFor="reward-active" className="text-sm cursor-pointer select-none">
                {t("fieldActive")}
              </label>
            </div>
          </div>
        </MotionCard>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{tc("loading")}</p>
      ) : rewards.length === 0 ? (
        <MotionCard className="p-8 text-center border border-dashed border-zinc-200 dark:border-zinc-700 rounded-lg">
          <Gift className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("emptyDesc")}</p>
        </MotionCard>
      ) : (
        <div className="space-y-2">
          {rewards.map((r) => (
            <MotionCard
              key={r.id}
              className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{r.name}</span>
                  {!r.isActive && (
                    <span className="text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                      {t("statusInactive")}
                    </span>
                  )}
                </div>
                {r.description && <p className="text-xs text-muted-foreground truncate">{r.description}</p>}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold">
                    {r.pointsCost.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{t("pts")}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.stockLimit === null ? t("unlimited") : t("inStock", { n: r.stockLimit })}
                  </p>
                </div>
                <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-muted" aria-label={tc("edit")}>
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(r)}
                  disabled={busy}
                  className="p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  aria-label={tc("delete")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
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
