"use client"

/**
 * D8 Loyalty — tier-ladder CRUD section (Slice 2 step 3b).
 *
 * Extracted VERBATIM from the body of /loyalty/tiers/page.tsx so it can be
 * rendered BOTH by that page (which now wraps it in MotionPage) AND as a tab
 * in the Loyalty Builder — one source of truth, zero behavior change to the
 * original page (it renders this same content under the same MotionPage).
 *
 * Admin CRUD over LoyaltyTier (per-tenant tier ladder): seed defaults, create,
 * edit (code immutable post-create), delete.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { InfoHint } from "@/components/info-hint"
import { LoyaltyFormActions } from "@/components/loyalty/loyalty-form-actions"
import { LoyaltyConfirmDialog } from "@/components/loyalty/loyalty-confirm-dialog"
import { MAX_TIER_MULTIPLIER } from "@/lib/loyalty/limits"
import { tierColor } from "@/lib/loyalty/tier-colors"
import {
  AlertCircle,
  Award,
  Crown,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

interface LoyaltyTierRow {
  id: string
  organizationId: string
  code: string
  name: string
  description: string | null
  minLifetimePoints: number
  multiplier: number
  benefits: Record<string, unknown>
  isActive: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  tiers: LoyaltyTierRow[]
  total: number
}

interface FormState {
  code: string
  name: string
  description: string
  minLifetimePoints: string
  multiplier: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  minLifetimePoints: "0",
  multiplier: "1.0",
  isActive: true,
}

export function TiersSection({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("slice2.loyaltyTiers")
  const tc = useTranslations("slice2.common")

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inline create + edit state. `editingId === null` means create.
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<LoyaltyTierRow | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/loyalty-tiers")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ListResponse
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorFetchFailed"))
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

  function openEdit(row: LoyaltyTierRow) {
    setEditingId(row.id)
    setForm({
      code: row.code,
      name: row.name,
      description: row.description ?? "",
      minLifetimePoints: String(row.minLifetimePoints),
      multiplier: String(row.multiplier),
      isActive: row.isActive,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function seedDefaults() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        "/api/v1/loyalty-tiers?seedDefaults=true",
        { method: "POST" },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("errorGeneric"))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const minLp = Number(form.minLifetimePoints)
      const mult = Number(form.multiplier)
      if (!Number.isFinite(minLp) || minLp < 0 || !Number.isInteger(minLp)) {
        throw new Error(t("errorThresholdInt"))
      }
      // Mirror server-side MAX_TIER_MULTIPLIER so the form 400s clientside
      // before the round-trip — import keeps client/server in lockstep.
      if (!Number.isFinite(mult) || mult <= 0 || mult > MAX_TIER_MULTIPLIER) {
        throw new Error(t("errorMultiplierPositive"))
      }

      let res: Response
      if (editingId) {
        // PATCH — drop `code` (immutable).
        res = await fetch(`/api/v1/loyalty-tiers/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            minLifetimePoints: minLp,
            multiplier: mult,
            isActive: form.isActive,
          }),
        })
      } else {
        res = await fetch("/api/v1/loyalty-tiers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: form.code.trim(),
            name: form.name.trim(),
            description: form.description.trim() || null,
            minLifetimePoints: minLp,
            multiplier: mult,
            isActive: form.isActive,
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

  async function remove(row: LoyaltyTierRow) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/loyalty-tiers/${row.id}`, {
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

  const tiers = data?.tiers ?? []
  const noTiers = !loading && tiers.length === 0

  return (
    <div className="max-w-5xl mx-auto">
      <header className={`mb-6 flex items-start gap-4 flex-wrap ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded && (
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Crown className="w-8 h-8 text-primary" />
              {t("title")}
              <HelpButton slug="loyalty-tiers" variant="label" />
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          {noTiers && (
            <button
              onClick={seedDefaults}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {t("seedDefaults")}
            </button>
          )}
          <button
            onClick={openCreate}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {t("newTier")}
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

      {noTiers && !showForm && (
        <MotionCard className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          <p className="font-medium">{t("seedRecommendationTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("seedRecommendationBody")}</p>
        </MotionCard>
      )}

      {showForm && (
        <MotionCard className="mb-6 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">
              {editingId ? t("editTier") : t("createTier")}
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
            submitDisabled={!form.name.trim() || (!editingId && !form.code.trim())}
            onCancel={closeForm}
            onSubmit={submit}
          />
          {editingId && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {t("liveEditWarning")}
            </div>
          )}
          <div className="mb-4 rounded-lg border bg-muted/60 p-3 text-sm">
            <p className="font-medium">{t("previewTitle")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("previewBody", {
                name: form.name || t("fieldName"),
                threshold: Number(form.minLifetimePoints || 0).toLocaleString(),
                multiplier: Number(form.multiplier || 1).toLocaleString(),
              })}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("fieldCode")} {editingId ? `(${t("codeImmutable")})` : ""}
              </label>
              <input
                type="text"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toLowerCase() })
                }
                disabled={!!editingId}
                placeholder="bronze"
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm disabled:bg-muted disabled:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("fieldName")}
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Bronze"
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm"
              />
            </div>
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
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("fieldThreshold")} <InfoHint text={t("hintThreshold")} />
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.minLifetimePoints}
                onChange={(e) =>
                  setForm({ ...form, minLifetimePoints: e.target.value })
                }
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t("fieldMultiplier")} <InfoHint text={t("hintMultiplier")} />
              </label>
              <input
                type="number"
                min="0"
                step="0.05"
                value={form.multiplier}
                onChange={(e) =>
                  setForm({ ...form, multiplier: e.target.value })
                }
                className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-md text-sm font-mono"
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="tier-active"
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
              <label
                htmlFor="tier-active"
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

      {!loading && noTiers && (
        <MotionCard className="p-12 text-center text-muted-foreground">
          <Award className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="text-sm mt-1">{t("emptyDesc")}</p>
        </MotionCard>
      )}

      {!loading && tiers.length > 0 && (
        <div className="space-y-2">
          {tiers.map((row) => (
            <MotionCard key={row.id} className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${tierColor(row.code)}`}
                  >
                    {row.code}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.name}</p>
                    {row.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {row.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("colThreshold")}
                    </p>
                    <p className="font-mono">
                      {row.minLifetimePoints.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("colMultiplier")}
                    </p>
                    <p className="font-mono">×{row.multiplier.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("colStatus")}
                    </p>
                    <p
                      className={
                        row.isActive ? "text-green-600" : "text-muted-foreground"
                      }
                    >
                      {row.isActive ? t("statusActive") : t("statusInactive")}
                    </p>
                  </div>
                  <div className="flex gap-1">
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
