"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Archive, ArrowLeft, ArrowRight, Check, ChevronDown, Info, Loader2, Plus, RotateCcw, ShieldCheck, X,
} from "lucide-react"
import { toast } from "sonner"

const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "web", "twitter"] as const
const DIRECTIONS = ["general_reputation", "customer_complaints"] as const

type Platform = typeof PLATFORMS[number]
type Direction = typeof DIRECTIONS[number]

type SuggestedAlias = { kind: string; value: string }

type ProfileMatch = {
  id: string
  subjectId: string | null
  name: string
  status: "active" | "paused" | "needs_resume" | "archived"
  platforms: string[]
  directions: string[]
  aliases: Array<{ kind: string; value: string }>
  sources: Array<{ id: string; platform: string; sourceType: string; label: string; status: string; isActive: boolean; ownership: string; relationType: string }>
  commentsEnabled: boolean
  archive: { matchedCount: number } | null
}

export type MonitoringProfileWizardProps = {
  onClose: () => void
  onLaunched: () => void
  onCollectionBlocked?: () => void
  canManagePaidPolicy?: boolean
  /** Предзаполнение из карточки компании CRM: имя клиента уже известно. */
  initialName?: string
}

type Step = 1 | 2 | 3

/**
 * "New monitoring" — the single action that replaces creating an Object and
 * then a Scenario. The brand name is typed once in step 1 and never asked for
 * again; the collection query is derived from it server-side.
 */
export function MonitoringProfileWizard({
  onClose,
  onLaunched,
  onCollectionBlocked,
  canManagePaidPolicy = false,
  initialName,
}: MonitoringProfileWizardProps) {
  const t = useTranslations("socialMonitoring.profiles")
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState(initialName ?? "")
  const [lookupLoading, setLookupLoading] = useState(false)
  const [matches, setMatches] = useState<ProfileMatch[]>([])
  const [suggestions, setSuggestions] = useState<SuggestedAlias[]>([])
  const [aliases, setAliases] = useState<SuggestedAlias[]>([])
  const [reusedSubjectId, setReusedSubjectId] = useState<string | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "facebook", "tiktok", "youtube", "web"])
  const [directions, setDirections] = useState<Direction[]>(["general_reputation"])
  const [includeComments, setIncludeComments] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [minConfidence, setMinConfidence] = useState(80)
  const [archiveStartAt, setArchiveStartAt] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])
  // Move focus to the new step's heading so a keyboard or screen-reader user is
  // not silently left on the previous step's controls.
  useEffect(() => { if (step > 1) headingRef.current?.focus() }, [step])

  const trimmedName = name.trim()

  useEffect(() => {
    if (!trimmedName) {
      setMatches([])
      setSuggestions([])
      setLookupLoading(false)
      return
    }
    const controller = new AbortController()
    const handle = setTimeout(async () => {
      setLookupLoading(true)
      try {
        const response = await fetch(
          `/api/v1/social/monitoring-profiles?name=${encodeURIComponent(trimmedName)}`,
          { signal: controller.signal },
        )
        const body = await response.json()
        if (!response.ok) throw new Error(body?.error ?? "lookup_failed")
        setMatches(body.data.matches ?? [])
        setSuggestions(body.data.suggestions ?? [])
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return
        // Lookup is an enhancement, never a launch blocker.
        setMatches([])
        setSuggestions([])
      } finally {
        if (!controller.signal.aborted) setLookupLoading(false)
      }
    }, 350)
    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [trimmedName])

  const archivedMatch = useMemo(
    () => matches.find(match => match.status === "needs_resume" || match.status === "archived"),
    [matches],
  )
  const activeMatch = useMemo(
    () => matches.find(match => match.status === "active" || match.status === "paused"),
    [matches],
  )

  function togglePlatform(platform: Platform) {
    setPlatforms(prev => prev.includes(platform) ? prev.filter(item => item !== platform) : [...prev, platform])
  }

  function toggleDirection(direction: Direction) {
    setDirections(prev => prev.includes(direction) ? prev.filter(item => item !== direction) : [...prev, direction])
  }

  function removeAlias(value: string) {
    setAliases(prev => prev.filter(alias => alias.value !== value))
  }

  function addAlias(alias: SuggestedAlias) {
    setAliases(prev => prev.some(item => item.kind === alias.kind && item.value === alias.value) ? prev : [...prev, alias])
  }

  function applyMatch(match: ProfileMatch) {
    const matchPlatforms = match.platforms.filter((value): value is Platform => PLATFORMS.includes(value as Platform))
    const matchDirections = match.directions.filter((value): value is Direction => DIRECTIONS.includes(value as Direction))
    setReusedSubjectId(match.subjectId)
    setName(match.name)
    setAliases(match.aliases.map(alias => ({ kind: alias.kind, value: alias.value })))
    setPlatforms(matchPlatforms.length > 0 ? matchPlatforms : ["instagram", "facebook", "tiktok"])
    setDirections(matchDirections.length > 0 ? matchDirections : ["general_reputation"])
    setIncludeComments(match.commentsEnabled)
    setStep(2)
  }

  const step1Blocker = !trimmedName ? t("errors.nameRequired") : null
  const step2Blocker = platforms.length === 0 ? t("errors.platformRequired") : null
  const step3Blocker = directions.length === 0 ? t("errors.directionRequired") : null
  const launchBlocker = step1Blocker ?? step2Blocker ?? step3Blocker

  async function launch() {
    if (launchBlocker) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch("/api/v1/social/monitoring-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(reusedSubjectId ? { subjectId: reusedSubjectId } : {}),
          name: trimmedName,
          aliases: aliases.map(alias => ({ kind: alias.kind, value: alias.value })),
          platforms,
          directions,
          includeExternalComments: includeComments,
          ...(advancedOpen ? { minConfidence } : {}),
          ...(advancedOpen && archiveStartAt ? { archiveStartAt: new Date(archiveStartAt).toISOString() } : {}),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        if (body?.code === "social_monitoring_collection_blocked") {
          const message = t(
            canManagePaidPolicy
              ? "errors.collectionResetBlocked"
              : "errors.collectionResetBlockedAskAdmin",
          )
          toast.error(message)
          if (canManagePaidPolicy) onCollectionBlocked?.()
          else setError(message)
          return
        }
        throw new Error(body?.error || t("errors.launchFailed"))
      }
      toast.success(t("launchSuccess", { name: trimmedName }))
      onLaunched()
    } catch (caught) {
      // Keep every field on screen — a provider or storage error must not cost
      // the operator the configuration they just entered.
      console.error("Monitoring profile launch failed", caught)
      setError(t("errors.launchFailed"))
    } finally {
      setSaving(false)
    }
  }

  const steps: Array<{ index: Step; label: string }> = [
    { index: 1, label: t("steps.who") },
    { index: 2, label: t("steps.where") },
    { index: 3, label: t("steps.what") },
  ]

  return (
    <section data-testid="social-profile-wizard" className="space-y-6" aria-label={t("wizardTitle")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("wizardTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("wizardSubtitle")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="mr-1 h-4 w-4" />{t("cancel")}
        </Button>
      </header>

      <ol className="flex flex-wrap gap-2" aria-label={t("progressLabel")}>
        {steps.map(item => {
          const state = item.index === step ? "current" : item.index < step ? "done" : "todo"
          return (
            <li key={item.index} className="flex-1 min-w-[9rem]">
              <button
                type="button"
                onClick={() => setStep(item.index)}
                aria-current={state === "current" ? "step" : undefined}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  state === "current"
                    ? "border-primary bg-primary/5 font-medium"
                    : state === "done"
                      ? "border-emerald-500/40 text-muted-foreground"
                      : "border-border text-muted-foreground"
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  state === "done" ? "bg-emerald-500 text-white" : state === "current" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}>
                  {state === "done" ? <Check className="h-3 w-3" /> : item.index}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-medium outline-none">{t("step1.title")}</h3>
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t("step1.nameLabel")}</Label>
            <div className="relative">
              <Input
                id="profile-name"
                ref={nameRef}
                value={name}
                onChange={event => {
                  setName(event.target.value)
                  setReusedSubjectId(null)
                }}
                placeholder={t("step1.namePlaceholder")}
                aria-describedby="profile-name-hint"
                autoComplete="off"
              />
              {lookupLoading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <p id="profile-name-hint" className="text-xs text-muted-foreground">{t("step1.nameHint")}</p>
          </div>

          {activeMatch && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium">{t("step1.existingTitle", { name: activeMatch.name })}</p>
              <p className="text-muted-foreground">{t("step1.existingHint")}</p>
              <Button
                variant="outline" size="sm" className="mt-2"
                onClick={() => applyMatch(activeMatch)}
              >
                {t("step1.continueExisting")}
              </Button>
            </div>
          )}

          {archivedMatch && (
            <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium">
                <Archive className="h-4 w-4" />{t("step1.archivedTitle", { name: archivedMatch.name })}
              </p>
              <p className="text-muted-foreground">
                {t("step1.archivedHint", { count: archivedMatch.archive?.matchedCount ?? 0 })}
              </p>
              <Button
                variant="outline" size="sm" className="mt-2"
                onClick={() => applyMatch(archivedMatch)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />{t("step1.resume")}
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("step1.variantsLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("step1.variantsHint")}</p>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label={t("step1.suggestionsLabel")}>
                {suggestions
                  .filter(suggestion => !aliases.some(alias => alias.kind === suggestion.kind && alias.value === suggestion.value))
                  .map(suggestion => (
                    <Button
                      key={`${suggestion.kind}:${suggestion.value}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addAlias(suggestion)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {suggestion.kind === "HASHTAG" ? "#" : ""}{suggestion.value}
                    </Button>
                  ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {aliases.length === 0 && <p className="text-sm text-muted-foreground">{t("step1.noConfirmedVariants")}</p>}
              {aliases.map(alias => (
                <Badge key={`${alias.kind}:${alias.value}`} variant="secondary" className="gap-1 py-1 pl-2.5">
                  {alias.kind === "HASHTAG" ? "#" : ""}{alias.value}
                  <button
                    type="button"
                    onClick={() => removeAlias(alias.value)}
                    aria-label={t("step1.removeVariant", { value: alias.value })}
                    className="-my-2 -mr-2 ml-0.5 inline-flex min-h-9 min-w-9 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <AliasAdder onAdd={value => setAliases(prev => [...prev, { kind: "NAME", value }])} label={t("step1.addVariant")} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-medium outline-none">{t("step2.title")}</h3>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("step2.platformsLabel")}</legend>
            <p className="text-xs text-muted-foreground">{t("step2.platformsHint")}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORMS.map(platform => {
                const selected = platforms.includes(platform)
                return (
                  <button
                    key={platform}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => togglePlatform(platform)}
                    className={`min-h-20 rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selected ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="block">
                      {selected && <Check className="mr-1 inline h-3.5 w-3.5" />}
                      {t(`platforms.${platform}`)}
                    </span>
                    <span className="mt-1 block text-xs font-normal leading-4 text-muted-foreground">
                      {t(`step2.platformScope.${platform}`)}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="include-comments" className="text-sm font-medium">{t("step2.commentsLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("step2.commentsHint")}</p>
            </div>
            <Switch id="include-comments" checked={includeComments} onCheckedChange={setIncludeComments} />
          </div>

          <p data-testid="social-profile-global-search-hint" className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              <span className="block font-medium text-foreground">{t("step2.globalSearchTitle")}</span>
              <span className="mt-0.5 block text-muted-foreground">{t("step2.globalSearchHint")}</span>
            </span>
          </p>

          <p className="flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <span>
              <span className="block font-medium text-foreground">{t("step2.coverageTruthTitle")}</span>
              <span className="mt-0.5 block text-muted-foreground">{t("step2.coverageTruth")}</span>
              <span className="mt-1 block text-muted-foreground">{t("step2.archiveFirstNotice")}</span>
            </span>
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-medium outline-none">{t("step3.title")}</h3>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("step3.directionsLabel")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DIRECTIONS.map(direction => {
                const selected = directions.includes(direction)
                return (
                  <button
                    key={direction}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleDirection(direction)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {selected && <Check className="h-4 w-4" />}
                      {t(`directions.${direction}`)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t(`directionHints.${direction}`)}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("step3.directionsSingleCollection")}</p>
          </fieldset>

          <div className="rounded-lg border p-3 text-sm">
            <h4 className="mb-2 font-medium">{t("step3.summaryTitle")}</h4>
            <dl className="grid gap-1.5 sm:grid-cols-2">
              <SummaryRow label={t("summary.name")} value={trimmedName} />
              <SummaryRow label={t("summary.variants")} value={aliases.map(a => a.value).join(", ") || t("summary.none")} />
              <SummaryRow label={t("summary.platforms")} value={platforms.map(p => t(`platforms.${p}`)).join(", ")} />
              <SummaryRow label={t("summary.sources")} value={t("summary.autoSources")} />
              <SummaryRow label={t("summary.comments")} value={includeComments ? t("summary.on") : t("summary.off")} />
              <SummaryRow label={t("summary.directions")} value={directions.map(d => t(`directions.${d}`)).join(", ")} />
              <SummaryRow label={t("summary.archive")} value={archiveStartAt || t("summary.allArchive")} />
              <SummaryRow label={t("summary.liveSend")} value={t("summary.off")} />
            </dl>
            <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              {t("step3.whatHappens")}
            </p>
          </div>

          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setAdvancedOpen(open => !open)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between p-3 text-sm font-medium"
            >
              {t("advanced.title")}
              <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
            {advancedOpen && (
              <div className="space-y-3 border-t p-3">
                <p className="text-xs text-muted-foreground">{t("advanced.hint")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="min-confidence">{t("advanced.confidence")}</Label>
                  <Input
                    id="min-confidence" type="number" min={1} max={100}
                    value={minConfidence}
                    onChange={event => setMinConfidence(Number(event.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="archive-start">{t("advanced.archiveStart")}</Label>
                  <Input
                    id="archive-start" type="date"
                    value={archiveStartAt}
                    onChange={event => setArchiveStartAt(event.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {t("errors.launchFailedKeepConfig", { reason: error })}
            </p>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button
          variant="outline"
          onClick={() => setStep(prev => (prev > 1 ? (prev - 1) as Step : prev))}
          disabled={step === 1}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />{t("back")}
        </Button>

        {step < 3 ? (
          <div className="flex items-center gap-3">
            {step === 1 && step1Blocker && <span id="wizard-next-blocker" className="text-xs text-muted-foreground">{step1Blocker}</span>}
            {step === 2 && step2Blocker && <span id="wizard-next-blocker" className="text-xs text-muted-foreground">{step2Blocker}</span>}
            <Button
              data-testid="social-profile-next"
              onClick={() => setStep(prev => (prev + 1) as Step)}
              disabled={step === 1 ? Boolean(step1Blocker) : Boolean(step2Blocker)}
              aria-describedby={(step === 1 ? step1Blocker : step2Blocker) ? "wizard-next-blocker" : undefined}
            >
              {t("next")}<ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {/* The disabled reason is always stated — never a dead button. */}
            {launchBlocker && <span id="wizard-launch-blocker" className="text-xs text-muted-foreground">{launchBlocker}</span>}
            <Button onClick={launch} disabled={Boolean(launchBlocker) || saving} aria-describedby={launchBlocker ? "wizard-launch-blocker" : undefined}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              {saving ? t("launching") : t("launch")}
            </Button>
          </div>
        )}
      </footer>
    </section>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      {/* min-w-0 lets the flex item shrink so truncate works on 375px screens. */}
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  )
}

function AliasAdder({ onAdd, label }: { onAdd: (value: string) => void; label: string }) {
  const [value, setValue] = useState("")
  function submit() {
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setValue("")
  }
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submit() } }}
        placeholder={label}
        aria-label={label}
        className="max-w-xs"
      />
      <Button type="button" variant="outline" onClick={submit} disabled={!value.trim()} aria-label={label}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
