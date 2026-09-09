"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  BadgeCheck,
  Braces,
  Check,
  FileClock,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createDateFormatter } from "@/lib/format-date"

type FormulaStatus = "DRAFT" | "ACTIVE" | "RETIRED"

interface ScoringFormula {
  id: string
  version: string
  name: string
  definition: Record<string, unknown>
  definitionHash: string | null
  glossarySchemaVersion: number | null
  approvalReference: string | null
  sourceSystem: string | null
  sourceReference: string | null
  sourceObservedAt: string | null
  status: FormulaStatus
  createdBy: string | null
  signedBy: string | null
  signedAt: string | null
  retiredAt: string | null
  createdAt: string
  updatedAt: string
}

interface FormulaResponse {
  success?: boolean
  error?: string
  data?: {
    formulas?: ScoringFormula[]
    capabilities?: { canConfigure?: boolean }
  }
}

const DEFINITION_TEMPLATE = JSON.stringify({
  engine: "server",
  factors: {
    patientsPerMonth: { weight: 0 },
    bedCount: { weight: 0 },
    kol: { weight: 0 },
  },
  rounding: "HALF_UP",
  glossary: {
    schemaVersion: 1,
    terms: {
      balance: {
        labels: { ru: "Баланс", az: "Balans", en: "Balance" },
        definitions: {
          ru: "Фактический и целевой баллы профессиональной оценки врача, показанные вместе.",
          az: "Həkimin birlikdə göstərilən faktiki və hədəf peşəkar qiymətləndirmə balları.",
          en: "The doctor's actual and target professional assessment scores shown together.",
        },
        unit: "score",
        sourceField: "actualScore/targetScore",
      },
      potential: {
        labels: { ru: "Потенциал", az: "Potensial", en: "Potential" },
        definitions: {
          ru: "Оценённый потенциал врача для указанного бренда и периода.",
          az: "Göstərilən brend və dövr üzrə həkimin qiymətləndirilmiş potensialı.",
          en: "The doctor's assessed potential for the specified brand and period.",
        },
        sourceField: "potentialValue",
      },
      coverageDisclosure: {
        labels: { ru: "Покрытие", az: "Əhatə", en: "Coverage" },
        definitions: {
          ru: "Подтверждённая часть потенциала, покрытая в указанном периоде.",
          az: "Göstərilən dövrdə potensialın təsdiqlənmiş əhatə olunmuş hissəsi.",
          en: "The verified portion of potential covered in the specified period.",
        },
        sourceField: "coverageValue",
      },
      doctorCategory: {
        labels: { ru: "Категория врача", az: "Həkim kateqoriyası", en: "Doctor category" },
        definitions: {
          ru: "Утверждённая профессиональная классификация врача на дату оценки.",
          az: "Qiymətləndirmə tarixində həkimin təsdiqlənmiş peşəkar təsnifatı.",
          en: "The doctor's approved professional classification on the assessment date.",
        },
        sourceField: "granularCategory",
      },
      kol: {
        labels: { ru: "Лидер мнений (KOL)", az: "Rəy lideri (KOL)", en: "Key opinion leader (KOL)" },
        definitions: {
          ru: "Подтверждённый статус и уровень лидера профессионального мнения.",
          az: "Peşəkar rəy liderinin təsdiqlənmiş statusu və səviyyəsi.",
          en: "The verified status and level of a professional key opinion leader.",
        },
        sourceField: "isKol/kolLevel",
      },
      profile: {
        labels: { ru: "Профиль", az: "Profil", en: "Profile" },
        definitions: {
          ru: "Профессиональный профиль врача, зафиксированный в оценке.",
          az: "Qiymətləndirmədə qeydə alınmış həkimin peşəkar profili.",
          en: "The doctor's professional profile captured in the assessment.",
        },
        sourceField: "profile",
      },
    },
  },
  authority: {
    sourceSystem: "",
    sourceReference: "",
    sourceObservedAt: "",
    approvalReference: "",
  },
}, null, 2)

function statusVariant(status: FormulaStatus): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success"
  if (status === "DRAFT") return "warning"
  return "outline"
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function ScoringFormulaSettings() {
  const t = useTranslations("mtmScoringFormulas")
  const locale = useLocale()
  const [formulas, setFormulas] = useState<ScoringFormula[]>([])
  const [canConfigure, setCanConfigure] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [activateTarget, setActivateTarget] = useState<ScoringFormula | null>(null)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [approvalConfirmation, setApprovalConfirmation] = useState("")
  const [version, setVersion] = useState("")
  const [name, setName] = useState("")
  const [definition, setDefinition] = useState(DEFINITION_TEMPLATE)
  const [formError, setFormError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const response = await fetch("/api/v1/mtm/doctor-scoring/formulas", {
        headers: { Accept: "application/json" },
      })
      const body = await response.json().catch(() => null) as FormulaResponse | null
      if (!response.ok || !body?.success) throw new Error(body?.error || t("loadFailed"))
      setFormulas(body.data?.formulas ?? [])
      setCanConfigure(Boolean(body.data?.capabilities?.canConfigure))
    } catch (error) {
      const message = error instanceof Error ? error.message : t("loadFailed")
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const orderedFormulas = useMemo(() => {
    const rank: Record<FormulaStatus, number> = { ACTIVE: 0, DRAFT: 1, RETIRED: 2 }
    return [...formulas].sort((left, right) => {
      const statusDifference = rank[left.status] - rank[right.status]
      return statusDifference || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
  }, [formulas])

  const dateTime = useMemo(() => createDateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale])

  const resetCreate = () => {
    setVersion("")
    setName("")
    setDefinition(DEFINITION_TEMPLATE)
    setFormError("")
  }

  const openCreate = () => {
    resetCreate()
    setCreateOpen(true)
  }

  const createFormula = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError("")
    let parsedDefinition: unknown
    try {
      parsedDefinition = JSON.parse(definition)
    } catch {
      setFormError(t("definitionInvalid"))
      return
    }
    if (!isJsonObject(parsedDefinition) || Object.keys(parsedDefinition).length === 0) {
      setFormError(t("definitionObjectRequired"))
      return
    }
    if (!version.trim() || !name.trim()) {
      setFormError(t("requiredFields"))
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/v1/mtm/doctor-scoring/formulas", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          version: version.trim(),
          name: name.trim(),
          definition: parsedDefinition,
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || t("createFailed"))
      toast.success(t("created"))
      setCreateOpen(false)
      resetCreate()
      await load()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("createFailed"))
    } finally {
      setSaving(false)
    }
  }

  const activateFormula = async () => {
    if (!activateTarget) return
    if (!activateTarget.definitionHash || approvalConfirmation.trim() !== activateTarget.approvalReference) {
      toast.error(t("approvalConfirmationMismatch"))
      return
    }
    setActivating(true)
    try {
      const response = await fetch(`/api/v1/mtm/doctor-scoring/formulas/${activateTarget.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          expectedDefinitionHash: activateTarget.definitionHash,
          approvalReference: approvalConfirmation.trim(),
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || t("activateFailed"))
      toast.success(t("activated", { version: activateTarget.version }))
      setActivateTarget(null)
      setApprovalConfirmation("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("activateFailed"))
    } finally {
      setActivating(false)
    }
  }

  return (
    <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Braces className="h-4 w-4 text-muted-foreground" />
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
          {canConfigure ? (
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              {t("newFormula")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/20 dark:text-sky-100">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{t("governanceTitle")}</p>
            <p className="mt-0.5 text-xs leading-relaxed opacity-80">{t("governanceDescription")}</p>
          </div>
        </div>
      </div>

      {loading && formulas.length === 0 ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {[1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : loadError && formulas.length === 0 ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <p>{loadError}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : orderedFormulas.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <FileClock className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {orderedFormulas.map((formula) => (
            <article
              key={formula.id}
              className={`rounded-lg border p-4 ${
                formula.status === "ACTIVE"
                  ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/15"
                  : "border-zinc-200 bg-card dark:border-zinc-700"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{formula.name}</h3>
                    <Badge variant={statusVariant(formula.status)}>{t(`statuses.${formula.status}`)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("version", { version: formula.version })}</p>
                </div>
                {canConfigure && formula.status === "DRAFT" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!formula.definitionHash}
                    onClick={() => {
                      setApprovalConfirmation("")
                      setActivateTarget(formula)
                    }}
                  >
                    <BadgeCheck className="mr-1 h-4 w-4" />
                    {t("activate")}
                  </Button>
                ) : null}
              </div>

              <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("createdAt")}</dt>
                  <dd className="mt-0.5 font-medium">{dateTime.format(new Date(formula.createdAt))}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("definitionHash")}</dt>
                  <dd className="mt-0.5 break-all font-mono font-medium">
                    {formula.definitionHash ?? t("legacyUnsigned")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("authority")}</dt>
                  <dd className="mt-0.5 font-medium">
                    {formula.sourceSystem
                      ? `${formula.sourceSystem}${formula.sourceReference ? ` · ${formula.sourceReference}` : ""}`
                      : t("legacyUnsigned")}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{t("approvalReference")}</dt>
                  <dd className="mt-0.5 font-medium">{formula.approvalReference ?? t("legacyUnsigned")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {formula.status === "RETIRED" ? t("retiredAt") : t("signedAt")}
                  </dt>
                  <dd className="mt-0.5 font-medium">
                    {formula.status === "RETIRED" && formula.retiredAt
                      ? dateTime.format(new Date(formula.retiredAt))
                      : formula.signedAt
                        ? dateTime.format(new Date(formula.signedAt))
                        : t("notSigned")}
                  </dd>
                </div>
              </dl>

              <details className="mt-4 rounded-md border border-zinc-200 bg-background/80 dark:border-zinc-700">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium">
                  {t("showDefinition")}
                </summary>
                <pre className="max-h-72 overflow-auto border-t border-zinc-200 p-3 text-[11px] leading-relaxed dark:border-zinc-700">
                  {JSON.stringify(formula.definition, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => !saving && setCreateOpen(open)} widthClassName="max-w-3xl">
        <form onSubmit={createFormula}>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          <DialogContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="scoring-formula-version">{t("versionLabel")}</Label>
                <Input
                  id="scoring-formula-version"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  maxLength={80}
                  autoComplete="off"
                  className="mt-1.5"
                  placeholder={t("versionPlaceholder")}
                  required
                />
              </div>
              <div>
                <Label htmlFor="scoring-formula-name">{t("nameLabel")}</Label>
                <Input
                  id="scoring-formula-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  className="mt-1.5"
                  placeholder={t("namePlaceholder")}
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor="scoring-formula-definition">{t("definitionLabel")}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("definitionHint")}</p>
              <Textarea
                id="scoring-formula-definition"
                value={definition}
                onChange={(event) => setDefinition(event.target.value)}
                rows={15}
                spellCheck={false}
                className="mt-2 resize-y font-mono text-xs"
                required
              />
            </div>
            {formError ? (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                {formError}
              </p>
            ) : null}
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              {saving ? t("creating") : t("createDraft")}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={Boolean(activateTarget)} onOpenChange={(open) => {
        if (!open && !activating) {
          setActivateTarget(null)
          setApprovalConfirmation("")
        }
      }}>
        <DialogHeader>
          <DialogTitle>{t("activateTitle")}</DialogTitle>
          <DialogDescription>
            {activateTarget ? t("activateDescription", {
              name: activateTarget.name,
              version: activateTarget.version,
            }) : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
            <p className="font-medium">{t("activationEffectTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed opacity-80">{t("activationEffectDescription")}</p>
          </div>
          <div className="mt-4 space-y-2">
            <Label htmlFor="scoring-formula-approval-confirmation">{t("approvalConfirmation")}</Label>
            <Input
              id="scoring-formula-approval-confirmation"
              value={approvalConfirmation}
              onChange={(event) => setApprovalConfirmation(event.target.value)}
              placeholder={activateTarget?.approvalReference ?? ""}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t("approvalConfirmationHint")}</p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setActivateTarget(null)} disabled={activating}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void activateFormula()}
            disabled={activating || !activateTarget?.definitionHash || approvalConfirmation.trim() !== activateTarget?.approvalReference}
          >
            {activating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            {activating ? t("activating") : t("confirmActivation")}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  )
}
