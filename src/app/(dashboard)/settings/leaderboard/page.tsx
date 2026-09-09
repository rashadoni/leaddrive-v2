"use client"

/**
 * KPI Arena config (Phase C4) — admin editor for the per-org composite weights
 * (MTM task/photo/route) and the status-band thresholds. A live preview shows how
 * sample attainment %s map onto the status colour/label with the CURRENT edits
 * (reuses the same `attainmentColor`/`statusFromAttainment` the Arena renders with,
 * so what you see here is exactly what the boards will show after Save).
 *
 * Org-wide setting: the bands drive tickets/projects/tasks too, not just MTM —
 * the API gates on `settings:write`, not the mtm module.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Trophy, Save, RotateCcw, Loader2 } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { PageDescription } from "@/components/page-description"
import { attainmentColor, STATUS_COLOR } from "@/lib/leaderboard/colors"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import {
  type AgentStatus,
  DEFAULT_MTM_WEIGHTS,
  DEFAULT_STATUS_THRESHOLDS,
  type MtmWeightKey,
  type StatusThresholds,
} from "@/lib/leaderboard/types"

type Weights = Record<MtmWeightKey, number>
const WEIGHT_KEYS: MtmWeightKey[] = ["task", "photo", "route"]
const BAND_KEYS: (keyof StatusThresholds)[] = ["exceeding", "on_track", "behind", "at_risk"]
const SAMPLE_PCTS = [130, 100, 80, 60, 40, 15]

export default function LeaderboardConfigPage() {
  const t = useTranslations("leaderboard.config")
  const ts = useTranslations("leaderboard.status")
  useAutoTour("leaderboardSettings")
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_MTM_WEIGHTS })
  const [thresholds, setThresholds] = useState<StatusThresholds>({ ...DEFAULT_STATUS_THRESHOLDS })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customized, setCustomized] = useState(false)

  useEffect(() => {
    fetch("/api/v1/leaderboard/config")
      .then((r) => r.json())
      .then((j) => {
        if (j?.data) {
          setWeights({ ...DEFAULT_MTM_WEIGHTS, ...j.data.mtmWeights })
          setThresholds({ ...DEFAULT_STATUS_THRESHOLDS, ...j.data.statusThresholds })
          setCustomized(!!j.customized)
        }
      })
      .catch(() => toast.error(t("loadError")))
      .finally(() => setLoading(false))
  }, [t])

  const weightSum = weights.task + weights.photo + weights.route
  const bandsOk =
    thresholds.exceeding >= thresholds.on_track &&
    thresholds.on_track >= thresholds.behind &&
    thresholds.behind >= thresholds.at_risk
  const canSave = weightSum > 0 && bandsOk && !saving

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/v1/leaderboard/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mtmWeights: weights, statusThresholds: thresholds }),
      })
      const j = await res.json()
      if (res.ok && j.success) {
        setCustomized(true)
        toast.success(t("saved"))
      } else {
        toast.error(j.error || t("saveError"))
      }
    } catch {
      toast.error(t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/v1/leaderboard/config", { method: "DELETE" })
      const j = await res.json()
      if (res.ok && j.success) {
        setWeights({ ...DEFAULT_MTM_WEIGHTS })
        setThresholds({ ...DEFAULT_STATUS_THRESHOLDS })
        setCustomized(false)
        toast.success(t("resetDone"))
      } else {
        toast.error(j.error || t("saveError"))
      }
    } catch {
      toast.error(t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4" data-tour-id="leaderboard-config-header">
        <PageDescription icon={Trophy} title={t("title")} description={t("description")} />
        <div className="flex items-center gap-2">
          <TourReplayButton tourId="leaderboardSettings" />
          <HelpButton slug="settings-leaderboard" variant="label" />
        </div>
      </div>

      {/* MTM composite weights */}
      <Card data-tour-id="leaderboard-config-weights">
        <CardHeader>
          <CardTitle>{t("weightsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{t("weightsHint")}</p>
          {WEIGHT_KEYS.map((k) => (
            <div key={k} className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <Label>{t(`weight.${k}`)}</Label>
                <span className="tabular-nums text-muted-foreground">
                  {weights[k].toFixed(2)} · {weightSum > 0 ? Math.round((weights[k] / weightSum) * 100) : 0}%
                </span>
              </div>
              <Slider
                value={[weights[k]]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([v]) => setWeights((w) => ({ ...w, [k]: v }))}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t("weightsSum", { sum: weightSum.toFixed(2) })}</p>
        </CardContent>
      </Card>

      {/* Status-band thresholds + live preview */}
      <Card data-tour-id="leaderboard-config-bands">
        <CardHeader>
          <CardTitle>{t("bandsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{t("bandsHint")}</p>
          {BAND_KEYS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <Label className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[k as AgentStatus] }}
                />
                {ts(k)}
              </Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={200}
                  value={thresholds[k]}
                  className="w-20 text-right"
                  onChange={(e) => setThresholds((th) => ({ ...th, [k]: Number(e.target.value) || 0 }))}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ))}
          {!bandsOk && <p className="text-xs text-red-500">{t("bandsOrderError")}</p>}

          <div>
            <Label className="text-sm">{t("preview")}</Label>
            <div className="mt-2 flex flex-wrap gap-3">
              {SAMPLE_PCTS.map((pct) => {
                const c = attainmentColor(pct, thresholds)
                return (
                  <div key={pct} className="flex flex-col items-center gap-1">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ background: c.fill, border: `2px solid ${c.ring}` }}
                    >
                      {pct}%
                    </div>
                    <span className="text-[10px] text-muted-foreground">{ts(c.status)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3" data-tour-id="leaderboard-config-save">
        <Button onClick={save} disabled={!canSave} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("save")}
        </Button>
        {customized ? (
          <Button variant="outline" onClick={reset} disabled={saving} className="gap-1.5">
            <RotateCcw className="h-4 w-4" />
            {t("resetBtn")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("usingDefaults")}</span>
        )}
      </div>
    </div>
  )
}
