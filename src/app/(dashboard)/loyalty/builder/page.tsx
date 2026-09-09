"use client"

/**
 * D8 Loyalty Builder — unified, preview-driven setup screen (Slice 2 step 3a).
 *
 * Consolidates the loyalty program into one place: a live PREVIEW panel (what
 * members earn / which promo applies, computed via the real helpers) beside
 * the management entry points. Step 3a ships the preview + manage links + a
 * first-run hint; step 3b embeds the Tiers/Earning/Promos CRUD as sections and
 * step 3a-ii adds the quick-start template wizard. The 4 existing pages stay
 * fully routable (UI-protection) — this screen does not remove them.
 */
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Sparkles, Trophy, Zap, Ticket, LayoutDashboard, ArrowRight, Loader2, AlertCircle, CheckCircle2, Circle, PlayCircle } from "lucide-react"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { LoyaltyPreviewPanel } from "@/components/loyalty/loyalty-preview-panel"
import { QuickStartWizard } from "@/components/loyalty/quick-start-wizard"
import { TiersSection } from "@/app/(dashboard)/loyalty/builder/_sections/tiers-section"
import { EarnRulesSection } from "@/app/(dashboard)/loyalty/builder/_sections/earn-rules-section"
import { PromosSection } from "@/app/(dashboard)/loyalty/builder/_sections/promos-section"
import { MembersSection } from "@/app/(dashboard)/loyalty/builder/_sections/members-section"
import { RewardsSection } from "@/app/(dashboard)/loyalty/builder/_sections/rewards-section"
import type { PreviewEarnRule, PreviewTier, PreviewPromoCode } from "@/lib/loyalty/preview"
import { computeLaunchReadiness, type LaunchStepKey, type LoyaltyOverviewLike } from "@/lib/loyalty/ux"

interface LoadState {
  rules: PreviewEarnRule[]
  tiers: PreviewTier[]
  promos: PreviewPromoCode[]
  rewards: unknown[]
  overview: LoyaltyOverviewLike | null
}

const MANAGE_LINKS = [
  { href: "/loyalty/tiers", icon: Trophy, key: "manageTiers" },
  { href: "/loyalty/earn-rules", icon: Zap, key: "manageEarning" },
  { href: "/loyalty/promo-codes", icon: Ticket, key: "managePromos" },
  { href: "/loyalty/dashboard", icon: LayoutDashboard, key: "manageDashboard" },
] as const

const TABS = ["overview", "tiers", "earning", "promos", "rewards", "members"] as const
type BuilderTab = (typeof TABS)[number]

export default function LoyaltyBuilderPage() {
  const t = useTranslations("slice2.loyaltyBuilder")
  const tc = useTranslations("slice2.common")
  useAutoTour("loyaltyBuilder")

  const [state, setState] = useState<LoadState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<BuilderTab>("overview")
  // member-portal flag (loyalty_portal); null = still loading. The toggle below
  // flips it via /api/v1/loyalty-settings.
  const [memberPortal, setMemberPortal] = useState<boolean | null>(null)
  // auto-earn master switch (settings.loyaltyAutoEarn); null = loading. When on,
  // a full invoice payment auto-awards points via the matching purchase rule.
  const [autoEarn, setAutoEarn] = useState<boolean | null>(null)
  // Readiness-only tenant decision: launch without invoice auto-earn for now.
  const [autoEarnSkipped, setAutoEarnSkipped] = useState(false)

  // load() is reusable: the quick-start wizard calls it after applying a
  // template so the preview lights up immediately.
  const load = useCallback(async () => {
    try {
      const [tiersR, rulesR, promosR, rewardsR, overviewR] = await Promise.all([
        fetch("/api/v1/loyalty-tiers").then((r) => r.json()),
        fetch("/api/v1/loyalty-earn-rules").then((r) => r.json()),
        fetch("/api/v1/promo-codes").then((r) => r.json()),
        fetch("/api/v1/loyalty-rewards").then((r) => r.json()).catch(() => ({ rewards: [] })),
        fetch("/api/v1/loyalty-overview").then((r) => r.json()).catch(() => null),
      ])
      setState({
        tiers: tiersR.tiers ?? [],
        rules: rulesR.rules ?? [],
        promos: promosR.codes ?? [],
        rewards: rewardsR.rewards ?? [],
        overview: overviewR,
      })
    } catch {
      setError(tc("errorFetchFailed"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    fetch("/api/v1/loyalty-settings")
      .then((r) => r.json())
      .then((j) => {
        setMemberPortal(!!j?.memberPortalEnabled)
        setAutoEarn(!!j?.autoEarnEnabled)
        setAutoEarnSkipped(!j?.autoEarnEnabled && !!j?.autoEarnSkipped)
      })
      .catch(() => {
        setMemberPortal(false)
        setAutoEarn(false)
        setAutoEarnSkipped(false)
      })
  }, [])

  async function toggleMemberPortal(next: boolean) {
    setMemberPortal(next) // optimistic
    try {
      const r = await fetch("/api/v1/loyalty-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberPortalEnabled: next }),
      })
      if (!r.ok) setMemberPortal(!next) // revert on failure
    } catch {
      setMemberPortal(!next)
    }
  }

  async function toggleAutoEarn(next: boolean) {
    const prevAutoEarn = autoEarn
    const prevSkipped = autoEarnSkipped
    setAutoEarn(next) // optimistic
    if (next) setAutoEarnSkipped(false)
    try {
      const r = await fetch("/api/v1/loyalty-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoEarnEnabled: next, ...(next ? { autoEarnSkipped: false } : {}) }),
      })
      if (!r.ok) {
        setAutoEarn(prevAutoEarn)
        setAutoEarnSkipped(prevSkipped)
      }
    } catch {
      setAutoEarn(prevAutoEarn)
      setAutoEarnSkipped(prevSkipped)
    }
  }

  async function setAutoEarnSkip(next: boolean) {
    const prevSkipped = autoEarnSkipped
    setAutoEarnSkipped(next)
    try {
      const r = await fetch("/api/v1/loyalty-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoEarnSkipped: next }),
      })
      if (!r.ok) setAutoEarnSkipped(prevSkipped)
    } catch {
      setAutoEarnSkipped(prevSkipped)
    }
  }

  const isEmpty = !!state && state.tiers.length === 0 && state.rules.length === 0
  const readiness = state
    ? computeLaunchReadiness({
        tiersCount: state.tiers.length,
        earnRulesCount: state.rules.length,
        rewardsCount: state.rewards.length,
        settings: {
          memberPortalEnabled: memberPortal === true,
          autoEarnEnabled: autoEarn === true,
          autoEarnSkipped,
        },
        overview: state.overview,
      })
    : null

  function goToStep(step: LaunchStepKey | null) {
    if (!step) return
    if (step === "tiers") setTab("tiers")
    if (step === "earning") setTab("earning")
    if (step === "rewards") setTab("rewards")
    if (step === "members") setTab("members")
    if (step === "portal") document.querySelector('[data-tour-id="lb-portal-toggle"]')?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (step === "autoEarn") document.querySelector('[data-tour-id="lb-auto-earn-toggle"]')?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  return (
    <MotionPage>
      <div className="mx-auto max-w-7xl">
        <div className="mb-1 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <HelpButton slug="loyalty-builder" />
          <TourReplayButton tourId="loyaltyBuilder" />
        </div>
        <p className="mb-6 text-sm text-muted-foreground">{t("subtitle")}</p>
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("liveSafetyTitle")}</p>
              <p className="mt-0.5 text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">{t("liveSafetyBody")}</p>
            </div>
          </div>
        </div>

        {/* Section tabs — Overview (preview + quick-start) or one of the CRUD
            sections (the same components the standalone pages render). */}
        <div className="mb-5 inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5" data-tour-id="lb-tabs">
          {TABS.map((x) => (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                tab === x ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {x === "overview"
                ? t("tabOverview")
                : x === "tiers"
                  ? t("manageTiers")
                  : x === "earning"
                    ? t("manageEarning")
                    : x === "promos"
                      ? t("managePromos")
                      : x === "rewards"
                        ? t("tabRewards")
                        : t("tabMembers")}
            </button>
          ))}
        </div>

        {tab === "tiers" ? (
          <TiersSection embedded />
        ) : tab === "earning" ? (
          <EarnRulesSection embedded />
        ) : tab === "promos" ? (
          <PromosSection embedded />
        ) : tab === "rewards" ? (
          <RewardsSection embedded />
        ) : tab === "members" ? (
          <MembersSection />
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> {tc("loading")}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(360px,420px)]">
            {/* ── left: manage + first-run ────────────────── */}
            <div className="space-y-4">
              {isEmpty && (
                <MotionCard className="rounded-xl border border-primary/30 bg-primary/5 p-5">
                  <h2 className="mb-1 text-base font-semibold">{t("emptyTitle")}</h2>
                  <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
                  <button
                    type="button"
                    onClick={() => setTab("tiers")}
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    <Sparkles className="h-4 w-4" />
                    {t("emptyCta")}
                  </button>
                </MotionCard>
              )}
              <MotionCard className="rounded-xl border bg-card p-4" data-tour-id="lb-launch-checklist">
                <div className="mb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">{t("launchChecklistTitle")}</h2>
                      <p className="text-xs text-muted-foreground">{t("launchChecklistHint")}</p>
                    </div>
                    {readiness && (
                      <span className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                        {t(`launchStatus.${readiness.status}`)}
                      </span>
                    )}
                  </div>
                  {readiness && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{t("launchProgress")}</span>
                        <span>{readiness.score}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${readiness.score}%` }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {(readiness?.steps ?? []).map((step) => {
                    const Icon = step.complete ? CheckCircle2 : Circle
                    const isLink = step.key === "pos"
                    const content = (
                      <>
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon className={`h-4 w-4 shrink-0 ${step.complete ? "text-emerald-600" : "text-muted-foreground"}`} />
                          <span className="truncate text-sm font-medium">{t(`launchStep_${step.key}`)}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {step.skipped ? t("launchSkipped") : step.complete ? t("launchDone") : t("launchTodo")}
                        </span>
                      </>
                    )
                    return isLink ? (
                      <Link
                        key={step.key}
                        href="/loyalty/pos"
                        className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 transition hover:bg-muted"
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        key={step.key}
                        type="button"
                        onClick={() => goToStep(step.key)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition hover:bg-muted"
                      >
                        {content}
                      </button>
                    )
                  })}
                </div>
                {readiness && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {readiness.nextStep === "pos" ? (
                      <Link
                        href="/loyalty/pos"
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                      >
                        <ArrowRight className="h-4 w-4" />
                        {t("continueSetup")}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => goToStep(readiness.nextStep)}
                        disabled={!readiness.nextStep}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        <ArrowRight className="h-4 w-4" />
                        {t("continueSetup")}
                      </button>
                    )}
                    {readiness.canRunPosTest && (
                      <Link
                        href="/loyalty/pos"
                        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted dark:border-zinc-700"
                      >
                        <PlayCircle className="h-4 w-4" />
                        {t("runPosTest")}
                      </Link>
                    )}
                  </div>
                )}
              </MotionCard>
              <div data-tour-id="lb-quickstart">
                <QuickStartWizard tiersCount={state!.tiers.length} onApplied={load} />
              </div>
              <MotionCard className="rounded-xl border bg-card p-4">
                <h2 className="mb-1 text-sm font-semibold">{t("manageTitle")}</h2>
                <p className="mb-3 text-xs text-muted-foreground">{t("manageHint")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MANAGE_LINKS.map(({ href, icon: Icon, key }) => (
                    <Link
                      key={href}
                      href={href}
                      className="group flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition hover:border-primary/40 hover:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        {t(key)}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </Link>
                  ))}
                </div>
              </MotionCard>
              {/* member-portal toggle (Slice 3 step 3) — flips loyalty_portal so
                  the loyalty tab + page appear in the customer portal. */}
              <MotionCard className="rounded-xl border bg-card p-4" data-tour-id="lb-portal-toggle">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{t("memberPortalTitle")}</h2>
                    <p className="text-xs text-muted-foreground">{t("memberPortalHint")}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!memberPortal}
                    aria-label={t("memberPortalTitle")}
                    onClick={() => toggleMemberPortal(!memberPortal)}
                    disabled={memberPortal === null}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                      memberPortal ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        memberPortal ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </MotionCard>
              {/* auto-earn master switch — settings.loyaltyAutoEarn. When on, a
                  full invoice payment auto-awards points via the purchase rule.
                  Needs an active "purchase" earning rule to actually award. */}
              <MotionCard className="rounded-xl border bg-card p-4" data-tour-id="lb-auto-earn-toggle">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{t("autoEarnTitle")}</h2>
                      {autoEarnSkipped && !autoEarn && (
                        <span className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {t("autoEarnSkippedBadge")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("autoEarnHint")}</p>
                    {autoEarnSkipped && !autoEarn && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("autoEarnSkippedHint")}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!autoEarn}
                    aria-label={t("autoEarnTitle")}
                    onClick={() => toggleAutoEarn(!autoEarn)}
                    disabled={autoEarn === null}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                      autoEarn ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        autoEarn ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
                {!autoEarn && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setAutoEarnSkip(!autoEarnSkipped)}
                      disabled={autoEarn === null}
                      className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 dark:border-zinc-700"
                    >
                      {autoEarnSkipped ? t("autoEarnClearSkip") : t("autoEarnSkipAction")}
                    </button>
                  </div>
                )}
              </MotionCard>
            </div>

            {/* ── right: live preview (sticky on lg) ──────── */}
            <div className="lg:sticky lg:top-4 lg:self-start" data-tour-id="lb-preview">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                {t("livePreviewTitle")}
              </h2>
              <LoyaltyPreviewPanel
                rules={state!.rules}
                tiers={state!.tiers}
                promos={state!.promos}
              />
            </div>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
