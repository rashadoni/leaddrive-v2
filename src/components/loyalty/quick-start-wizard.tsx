"use client"

/**
 * D8 Loyalty Builder — quick-start template wizard (Slice 2 step 3a-ii).
 *
 * One-click apply of ready-made earn-rule templates so a tenant goes empty →
 * working program. Consumes the step-2 templates API. Closes the two step-2
 * declared tails:
 *   1. ICON-MAP — maps each template's `icon` string to a lucide component.
 *   2. seedTiers WIRING — when a template's seedTiers hint is set AND the org
 *      has no tiers yet, it also seeds the default ladder via the existing
 *      POST /api/v1/loyalty-tiers?seedDefaults=true before creating the rule.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Coins, Gift, Cake, Users, Sparkles, Rocket, Check, Loader2, type LucideIcon } from "lucide-react"
import { MotionCard } from "@/components/ui/motion"

// icon-map (closes step-2 tail #1) — template.icon string → lucide component.
const ICON_MAP: Record<string, LucideIcon> = { Coins, Gift, Cake, Users }
const iconFor = (name: string): LucideIcon => ICON_MAP[name] ?? Sparkles

interface TemplateRow {
  id: string
  nameKey: string
  descriptionKey: string
  icon: string
  seedTiers?: boolean
  isApplied: boolean
}

interface Props {
  /** Current tier count — drives whether seedTiers also seeds the ladder. */
  tiersCount: number
  /** Called after a successful apply so the builder re-fetches + the preview lights up. */
  onApplied: () => void
}

export function QuickStartWizard({ tiersCount, onApplied }: Props) {
  const t = useTranslations("slice2.loyaltyBuilder.quickStart")
  const ti = useTranslations("loyaltyTemplates")

  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadTemplates() {
    try {
      const j = await fetch("/api/v1/loyalty-templates").then((r) => r.json())
      setTemplates(j.data ?? [])
    } catch {
      setTemplates([])
    }
  }

  useEffect(() => {
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function apply(tpl: TemplateRow) {
    if (applying) return
    setApplying(tpl.id)
    setError(null)
    try {
      // seedTiers WIRING (closes step-2 tail #2): seed the ladder FIRST (so the
      // multiplier exists for the new rule) when the template asks for it and
      // the tenant has no tiers yet. Idempotent server-side (no-op if tiers exist).
      if (tpl.seedTiers && tiersCount === 0) {
        await fetch("/api/v1/loyalty-tiers?seedDefaults=true", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      }
      const r = await fetch("/api/v1/loyalty-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: tpl.id }),
      })
      // 409 already_applied is a benign no-op (treat as success).
      if (!r.ok && r.status !== 409) throw new Error("apply failed")
      await loadTemplates()
      onApplied()
    } catch {
      setError(t("applyFailed"))
    } finally {
      setApplying(null)
    }
  }

  if (!templates || templates.length === 0) return null

  return (
    <MotionCard className="rounded-xl border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <Rocket className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("title")}</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("subtitle")}</p>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {templates.map((tpl) => {
          const Icon = iconFor(tpl.icon)
          const busy = applying === tpl.id
          return (
            <div key={tpl.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ti(tpl.nameKey)}</p>
                  <p className="text-xs text-muted-foreground">{ti(tpl.descriptionKey)}</p>
                </div>
              </div>
              {tpl.seedTiers && tiersCount === 0 && (
                <p className="text-[11px] text-muted-foreground">{t("seedTiersNote")}</p>
              )}
              {tpl.isApplied ? (
                <span className="mt-auto inline-flex items-center gap-1 self-start rounded-md bg-green-600/10 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                  <Check className="h-3.5 w-3.5" /> {t("applied")}
                </span>
              ) : (
                <button
                  onClick={() => apply(tpl)}
                  disabled={busy}
                  className="mt-auto inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("applying")}
                    </>
                  ) : (
                    t("apply")
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </MotionCard>
  )
}
