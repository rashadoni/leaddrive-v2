"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Lightbulb, X, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"

const STORAGE_KEY = "leaddrive_dismissed_tips"

interface Tip {
  id: string
  titleKey: string
  descKey: string
  ctaKey: string
  href: string
}

const TIPS: Record<string, Tip[]> = {
  "skill-routing": [
    { id: "sr-edit", titleKey: "srEditTitle", descKey: "srEditDesc", ctaKey: "srEditCta", href: "/support/skill-routing" },
    { id: "sr-catch", titleKey: "srCatchTitle", descKey: "srCatchDesc", ctaKey: "srCatchCta", href: "/support/skill-routing" },
    { id: "sr-chip", titleKey: "srChipTitle", descKey: "srChipDesc", ctaKey: "srChipCta", href: "/support/skill-routing" },
  ],
  dashboard: [
    { id: "ctrl-k", titleKey: "ctrlKTitle", descKey: "ctrlKDesc", ctaKey: "ctrlKCta", href: "/settings/dashboard" },
    { id: "wallpaper", titleKey: "wallpaperTitle", descKey: "wallpaperDesc", ctaKey: "wallpaperCta", href: "/settings/dashboard" },
    { id: "daily-briefing", titleKey: "dailyBriefingTitle", descKey: "dailyBriefingDesc", ctaKey: "dailyBriefingCta", href: "/settings/ai-automation" },
    { id: "anomaly-detect", titleKey: "anomalyTitle", descKey: "anomalyDesc", ctaKey: "anomalyCta", href: "/ai-command-center" },
    { id: "widget-toggle", titleKey: "widgetTitle", descKey: "widgetDesc", ctaKey: "widgetCta", href: "/settings/dashboard" },
  ],
  deals: [
    { id: "deal-drag", titleKey: "dealDragTitle", descKey: "dealDragDesc", ctaKey: "dealDragCta", href: "/deals" },
    { id: "deal-rotting", titleKey: "dealRottingTitle", descKey: "dealRottingDesc", ctaKey: "dealRottingCta", href: "/settings/ai-automation" },
    { id: "deal-weighted", titleKey: "dealWeightedTitle", descKey: "dealWeightedDesc", ctaKey: "dealWeightedCta", href: "/deals" },
    { id: "deal-close", titleKey: "dealCloseTitle", descKey: "dealCloseDesc", ctaKey: "dealCloseCta", href: "/deals" },
    { id: "deal-team", titleKey: "dealTeamTitle", descKey: "dealTeamDesc", ctaKey: "dealTeamCta", href: "/deals" },
    { id: "deal-competitors", titleKey: "dealCompTitle", descKey: "dealCompDesc", ctaKey: "dealCompCta", href: "/deals" },
  ],
  tickets: [
    { id: "ticket-shortcuts", titleKey: "ticketShortTitle", descKey: "ticketShortDesc", ctaKey: "ticketShortCta", href: "/tickets" },
    { id: "ticket-macros", titleKey: "ticketMacroTitle", descKey: "ticketMacroDesc", ctaKey: "ticketMacroCta", href: "/settings/macros" },
    { id: "ticket-internal", titleKey: "ticketInternalTitle", descKey: "ticketInternalDesc", ctaKey: "ticketInternalCta", href: "/tickets" },
    { id: "ticket-sla", titleKey: "ticketSlaTitle", descKey: "ticketSlaDesc", ctaKey: "ticketSlaCta", href: "/settings/sla-policies" },
    { id: "ticket-handle", titleKey: "ticketHandleTitle", descKey: "ticketHandleDesc", ctaKey: "ticketHandleCta", href: "/reports" },
    { id: "ticket-auto-ack", titleKey: "ticketAutoTitle", descKey: "ticketAutoDesc", ctaKey: "ticketAutoCta", href: "/settings/ai-automation" },
    { id: "ticket-ai-draft", titleKey: "ticketDraftTitle", descKey: "ticketDraftDesc", ctaKey: "ticketDraftCta", href: "/knowledge-base" },
  ],
  leads: [
    { id: "lead-scoring", titleKey: "leadScoreTitle", descKey: "leadScoreDesc", ctaKey: "leadScoreCta", href: "/lead-scoring" },
    { id: "lead-convert", titleKey: "leadConvertTitle", descKey: "leadConvertDesc", ctaKey: "leadConvertCta", href: "/leads" },
    { id: "lead-age", titleKey: "leadAgeTitle", descKey: "leadAgeDesc", ctaKey: "leadAgeCta", href: "/leads" },
    { id: "lead-source", titleKey: "leadSourceTitle", descKey: "leadSourceDesc", ctaKey: "leadSourceCta", href: "/lead-scoring" },
    { id: "lead-assign", titleKey: "leadAssignTitle", descKey: "leadAssignDesc", ctaKey: "leadAssignCta", href: "/settings/lead-rules" },
  ],
  contacts: [
    { id: "contact-decay", titleKey: "contactDecayTitle", descKey: "contactDecayDesc", ctaKey: "contactDecayCta", href: "/contacts" },
    { id: "contact-weights", titleKey: "contactWeightsTitle", descKey: "contactWeightsDesc", ctaKey: "contactWeightsCta", href: "/contacts" },
    { id: "contact-call", titleKey: "contactCallTitle", descKey: "contactCallDesc", ctaKey: "contactCallCta", href: "/settings/voip" },
    { id: "contact-360", titleKey: "contact360Title", descKey: "contact360Desc", ctaKey: "contact360Cta", href: "/contacts" },
  ],
  companies: [
    { id: "company-churn", titleKey: "companyChurnTitle", descKey: "companyChurnDesc", ctaKey: "companyChurnCta", href: "/reports" },
    { id: "company-sla", titleKey: "companySlaTitle", descKey: "companySlaDesc", ctaKey: "companySlaCta", href: "/settings/sla-policies" },
    { id: "company-funnel", titleKey: "companyFunnelTitle", descKey: "companyFunnelDesc", ctaKey: "companyFunnelCta", href: "/companies" },
    { id: "company-kpi", titleKey: "companyKpiTitle", descKey: "companyKpiDesc", ctaKey: "companyKpiCta", href: "/companies" },
  ],
  tasks: [
    { id: "task-deal", titleKey: "taskDealTitle", descKey: "taskDealDesc", ctaKey: "taskDealCta", href: "/tasks" },
    { id: "task-views", titleKey: "taskViewsTitle", descKey: "taskViewsDesc", ctaKey: "taskViewsCta", href: "/tasks" },
    { id: "task-bulk", titleKey: "taskBulkTitle", descKey: "taskBulkDesc", ctaKey: "taskBulkCta", href: "/tasks" },
    { id: "task-calendar", titleKey: "taskCalTitle", descKey: "taskCalDesc", ctaKey: "taskCalCta", href: "/settings/integrations" },
  ],
  reports: [
    { id: "report-drill", titleKey: "reportDrillTitle", descKey: "reportDrillDesc", ctaKey: "reportDrillCta", href: "/reports" },
    { id: "report-forecast", titleKey: "reportForecastTitle", descKey: "reportForecastDesc", ctaKey: "reportForecastCta", href: "/reports" },
    { id: "report-summary", titleKey: "reportSummaryTitle", descKey: "reportSummaryDesc", ctaKey: "reportSummaryCta", href: "/reports" },
  ],
  campaigns: [
    { id: "campaign-ab", titleKey: "campAbTitle", descKey: "campAbDesc", ctaKey: "campAbCta", href: "/campaigns" },
    { id: "campaign-track", titleKey: "campTrackTitle", descKey: "campTrackDesc", ctaKey: "campTrackCta", href: "/campaigns" },
    { id: "campaign-segment", titleKey: "campSegTitle", descKey: "campSegDesc", ctaKey: "campSegCta", href: "/segments" },
    { id: "campaign-variant", titleKey: "campVarTitle", descKey: "campVarDesc", ctaKey: "campVarCta", href: "/campaigns" },
  ],
  journeys: [
    { id: "journey-vars", titleKey: "journeyVarsTitle", descKey: "journeyVarsDesc", ctaKey: "journeyVarsCta", href: "/journeys" },
    { id: "journey-condition", titleKey: "journeyCondTitle", descKey: "journeyCondDesc", ctaKey: "journeyCondCta", href: "/journeys" },
    { id: "journey-stats", titleKey: "journeyStatsTitle", descKey: "journeyStatsDesc", ctaKey: "journeyStatsCta", href: "/journeys" },
    { id: "journey-trigger", titleKey: "journeyTrigTitle", descKey: "journeyTrigDesc", ctaKey: "journeyTrigCta", href: "/journeys" },
  ],
  segments: [
    { id: "segment-dynamic", titleKey: "segDynTitle", descKey: "segDynDesc", ctaKey: "segDynCta", href: "/segments" },
    { id: "segment-campaign", titleKey: "segCampTitle", descKey: "segCampDesc", ctaKey: "segCampCta", href: "/campaigns" },
  ],
  inbox: [
    { id: "inbox-cross", titleKey: "inboxCrossTitle", descKey: "inboxCrossDesc", ctaKey: "inboxCrossCta", href: "/inbox" },
    { id: "inbox-ticket", titleKey: "inboxTicketTitle", descKey: "inboxTicketDesc", ctaKey: "inboxTicketCta", href: "/settings/channels" },
    { id: "inbox-davinci", titleKey: "inboxDavinciTitle", descKey: "inboxDavinciDesc", ctaKey: "inboxDavinciCta", href: "/ai-command-center" },
  ],
  invoices: [
    { id: "invoice-recurring", titleKey: "invRecTitle", descKey: "invRecDesc", ctaKey: "invRecCta", href: "/invoices/recurring" },
    { id: "invoice-partial", titleKey: "invPartTitle", descKey: "invPartDesc", ctaKey: "invPartCta", href: "/invoices" },
    { id: "invoice-journey", titleKey: "invJourneyTitle", descKey: "invJourneyDesc", ctaKey: "invJourneyCta", href: "/settings/ai-automation" },
  ],
  finance: [
    { id: "finance-aging", titleKey: "finAgingTitle", descKey: "finAgingDesc", ctaKey: "finAgingCta", href: "/finance?tab=receivables" },
    { id: "finance-approval", titleKey: "finApprTitle", descKey: "finApprDesc", ctaKey: "finApprCta", href: "/settings/finance-notifications" },
    { id: "finance-funds", titleKey: "finFundsTitle", descKey: "finFundsDesc", ctaKey: "finFundsCta", href: "/finance?tab=funds" },
  ],
  budgeting: [
  ],
  profitability: [
    { id: "profit-service", titleKey: "profSvcTitle", descKey: "profSvcDesc", ctaKey: "profSvcCta", href: "/profitability" },
    { id: "profit-overhead", titleKey: "profOhTitle", descKey: "profOhDesc", ctaKey: "profOhCta", href: "/profitability" },
    { id: "profit-ai", titleKey: "profAiTitle", descKey: "profAiDesc", ctaKey: "profAiCta", href: "/profitability" },
  ],
  projects: [
    { id: "project-deal", titleKey: "projDealTitle", descKey: "projDealDesc", ctaKey: "projDealCta", href: "/projects" },
    { id: "project-milestone", titleKey: "projMileTitle", descKey: "projMileDesc", ctaKey: "projMileCta", href: "/projects" },
    { id: "project-budget", titleKey: "projBudgTitle", descKey: "projBudgDesc", ctaKey: "projBudgCta", href: "/projects" },
  ],
  contracts: [
    { id: "contract-expiring", titleKey: "contrExpTitle", descKey: "contrExpDesc", ctaKey: "contrExpCta", href: "/contracts" },
    { id: "contract-mrr", titleKey: "contrMrrTitle", descKey: "contrMrrDesc", ctaKey: "contrMrrCta", href: "/contracts" },
  ],
  "contract-templates": [
    { id: "ct-variables", titleKey: "ctVarsTitle", descKey: "ctVarsDesc", ctaKey: "ctVarsCta", href: "/contracts/templates" },
    { id: "ct-approved-clauses", titleKey: "ctClausesTitle", descKey: "ctClausesDesc", ctaKey: "ctClausesCta", href: "/contracts/templates" },
    { id: "ct-generate-pdf", titleKey: "ctGenerateTitle", descKey: "ctGenerateDesc", ctaKey: "ctGenerateCta", href: "/contracts" },
  ],
  "contract-lifecycle": [
    { id: "lifecycle-bottleneck", titleKey: "lcBottleneckTitle", descKey: "lcBottleneckDesc", ctaKey: "lcBottleneckCta", href: "/contracts/lifecycle" },
    { id: "lifecycle-renewal-window", titleKey: "lcRenewalTitle", descKey: "lcRenewalDesc", ctaKey: "lcRenewalCta", href: "/contracts/lifecycle" },
  ],
  offers: [
    { id: "offer-chain", titleKey: "offerChainTitle", descKey: "offerChainDesc", ctaKey: "offerChainCta", href: "/offers" },
    { id: "offer-approval", titleKey: "offerApprTitle", descKey: "offerApprDesc", ctaKey: "offerApprCta", href: "/offers" },
  ],
  "knowledge-base": [
    { id: "kb-ai", titleKey: "kbAiTitle", descKey: "kbAiDesc", ctaKey: "kbAiCta", href: "/knowledge-base" },
    { id: "kb-portal", titleKey: "kbPortalTitle", descKey: "kbPortalDesc", ctaKey: "kbPortalCta", href: "/knowledge-base" },
  ],
  products: [
    { id: "products-offers", titleKey: "prodTitle", descKey: "prodDesc", ctaKey: "prodCta", href: "/products" },
  ],
  events: [
    { id: "events-calendar", titleKey: "eventsTitle", descKey: "eventsDesc", ctaKey: "eventsCta", href: "/events" },
  ],
  settings: [
    { id: "settings-validation", titleKey: "setValTitle", descKey: "setValDesc", ctaKey: "setValCta", href: "/settings/pipelines" },
    { id: "settings-perms", titleKey: "setPermTitle", descKey: "setPermDesc", ctaKey: "setPermCta", href: "/settings/field-permissions" },
  ],
  macros: [
    { id: "macro-shortcuts", titleKey: "macroShortTitle", descKey: "macroShortDesc", ctaKey: "macroShortCta", href: "/tickets" },
    { id: "macro-categories", titleKey: "macroCatTitle", descKey: "macroCatDesc", ctaKey: "macroCatCta", href: "/settings/macros" },
    { id: "macro-order", titleKey: "macroOrderTitle", descKey: "macroOrderDesc", ctaKey: "macroOrderCta", href: "/settings/macros" },
  ],
  "social-monitoring": [
    { id: "smm-ai-reply", titleKey: "smmAiReplyTitle", descKey: "smmAiReplyDesc", ctaKey: "smmAiReplyCta", href: "/settings/ai-automation" },
    { id: "smm-viral-alert", titleKey: "smmViralTitle", descKey: "smmViralDesc", ctaKey: "smmViralCta", href: "/settings/ai-automation" },
    { id: "smm-keywords", titleKey: "smmKeywordsTitle", descKey: "smmKeywordsDesc", ctaKey: "smmKeywordsCta", href: "/social-monitoring" },
  ],
  loyalty: [
    { id: "loyalty-stale-priority", titleKey: "loyaltyStaleTitle", descKey: "loyaltyStaleDesc", ctaKey: "loyaltyStaleCta", href: "/loyalty/dashboard" },
    { id: "loyalty-tier-bars", titleKey: "loyaltyTiersTitle", descKey: "loyaltyTiersDesc", ctaKey: "loyaltyTiersCta", href: "/loyalty/dashboard" },
    { id: "loyalty-expiry-watch", titleKey: "loyaltyExpiryTitle", descKey: "loyaltyExpiryDesc", ctaKey: "loyaltyExpiryCta", href: "/loyalty/dashboard" },
    { id: "loyalty-top-savers", titleKey: "loyaltyTopTitle", descKey: "loyaltyTopDesc", ctaKey: "loyaltyTopCta", href: "/loyalty/dashboard" },
  ],
  "ai-automation": [
    { id: "ai-autom-hero", titleKey: "aiAutoHeroTitle", descKey: "aiAutoHeroDesc", ctaKey: "aiAutoHeroCta", href: "/settings/ai-automation" },
    { id: "ai-autom-wave", titleKey: "aiAutoWaveTitle", descKey: "aiAutoWaveDesc", ctaKey: "aiAutoWaveCta", href: "/settings/ai-automation" },
    { id: "ai-autom-budget", titleKey: "aiAutoBudgetTitle", descKey: "aiAutoBudgetDesc", ctaKey: "aiAutoBudgetCta", href: "/settings/ai-automation" },
    { id: "ai-autom-language", titleKey: "aiAutoLangTitle", descKey: "aiAutoLangDesc", ctaKey: "aiAutoLangCta", href: "/contacts" },
    { id: "ai-autom-sentiment", titleKey: "aiAutoSentTitle", descKey: "aiAutoSentDesc", ctaKey: "aiAutoSentCta", href: "/settings/ai-automation" },
  ],
}

function getDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch { return new Set() }
}

function saveDismissed(dismissed: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed])) } catch {}
}

export function DidYouKnow({
  page,
  className = "",
  variant = "default",
  density = "default",
}: {
  page: string
  className?: string
  variant?: "default" | "glass"
  density?: "default" | "compact"
}) {
  const t = useTranslations("tips")
  const router = useRouter()
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed())
  const [currentIdx, setCurrentIdx] = useState(0)
  const [direction, setDirection] = useState(0)

  const pageTips = TIPS[page] || []
  const available = pageTips.filter(tip => !dismissed.has(tip.id))
  if (available.length === 0) return null

  const safeIdx = Math.min(currentIdx, available.length - 1)
  const tip = available[safeIdx]

  const handleDismiss = () => {
    const next = new Set(dismissed)
    next.add(tip.id)
    setDismissed(next)
    saveDismissed(next)
    if (safeIdx >= available.length - 1) setCurrentIdx(Math.max(0, safeIdx - 1))
  }

  const goNext = () => { setDirection(1); setCurrentIdx(i => Math.min(i + 1, available.length - 1)) }
  const goPrev = () => { setDirection(-1); setCurrentIdx(i => Math.max(i - 1, 0)) }

  let title: string, desc: string, cta: string
  try { title = t(tip.titleKey); desc = t(tip.descKey); cta = t(tip.ctaKey) }
  catch { title = tip.titleKey; desc = tip.descKey; cta = tip.ctaKey }

  return (
    <div className={`relative rounded-xl ${density === "compact" ? "p-3" : "p-5"} shadow-sm ${
      variant === "glass"
        ? "border border-white/15 bg-black/55 backdrop-blur-xl text-white"
        : "border border-amber-300 dark:border-amber-800/50 bg-gradient-to-r from-amber-50 to-orange-50/80 dark:from-amber-950/30 dark:to-orange-950/20"
    } ${className}`}>
      {/* Dismiss current tip */}
      <button onClick={handleDismiss} className={`absolute top-3 right-3 p-1 rounded-md transition-colors z-10 ${
        variant === "glass" ? "text-white/40 hover:text-white hover:bg-white/10" : "text-amber-500 hover:text-amber-700 hover:bg-amber-200/50 dark:hover:bg-amber-800/40"
      }`}>
        <X className="h-4 w-4" />
      </button>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tip.id}
          initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
          transition={{ duration: 0.2 }}
          className={`flex items-start ${density === "compact" ? "gap-3 pr-7" : "gap-3.5 pr-8"}`}
        >
          <div className={`flex ${density === "compact" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl"} items-center justify-center shrink-0 mt-0.5 shadow-sm ${
            variant === "glass" ? "bg-white/15" : "bg-amber-100 dark:bg-amber-800/40"
          }`}>
            <Lightbulb className={`${density === "compact" ? "h-4 w-4" : "h-5 w-5"} ${variant === "glass" ? "text-amber-300" : "text-amber-600 dark:text-amber-400"}`} />
          </div>
          <div className={`${density === "compact" ? "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1" : "min-w-0 space-y-2"}`}>
            <p className={`text-sm font-bold ${variant === "glass" ? "text-white/80" : "text-amber-900 dark:text-amber-200"}`}>
              {t("prefix")} <span className={variant === "glass" ? "text-white" : "text-foreground"}>{title}</span>
            </p>
            <p className={`${density === "compact" ? "min-w-0 flex-1 truncate text-xs sm:min-w-[18rem]" : "text-[13px] leading-relaxed"} ${variant === "glass" ? "text-white/60" : "text-foreground/70 dark:text-foreground/60"}`}>{desc}</p>
            {tip.href && (
              <Button
                variant="outline"
                size="sm"
                className={`${density === "compact" ? "h-6 px-2.5" : "h-7 px-3"} text-xs font-medium shadow-sm ${
                  variant === "glass"
                    ? "border-white/20 text-white bg-white/10 hover:bg-white/20"
                    : "border-amber-300 text-amber-800 bg-white hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-900/20 dark:hover:bg-amber-800/30"
                }`}
                onClick={() => router.push(tip.href)}
              >
                {cta} <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Navigation: ← counter → */}
      {available.length > 1 && (
        <div className={`flex items-center justify-center gap-3 ${density === "compact" ? "mt-2 pt-2" : "mt-3 pt-2.5"} border-t ${
          variant === "glass" ? "border-white/10" : "border-amber-200/50 dark:border-amber-800/30"
        }`}>
          <button
            onClick={goPrev}
            disabled={safeIdx === 0}
            className={`h-7 w-7 flex items-center justify-center rounded-md border disabled:opacity-25 disabled:cursor-not-allowed transition-colors shadow-sm ${
              variant === "glass"
                ? "border-white/20 bg-white/10 hover:bg-white/20"
                : "border-amber-300 dark:border-amber-700 bg-white dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-800/40"
            }`}
          >
            <ChevronLeft className={`h-4 w-4 ${variant === "glass" ? "text-white/70" : "text-amber-600 dark:text-amber-400"}`} />
          </button>
          <span className={`text-xs font-medium min-w-[3rem] text-center ${
            variant === "glass" ? "text-white/50" : "text-amber-600 dark:text-amber-400"
          }`}>
            {safeIdx + 1} / {available.length}
          </span>
          <button
            onClick={goNext}
            disabled={safeIdx >= available.length - 1}
            className={`h-7 w-7 flex items-center justify-center rounded-md border disabled:opacity-25 disabled:cursor-not-allowed transition-colors shadow-sm ${
              variant === "glass"
                ? "border-white/20 bg-white/10 hover:bg-white/20"
                : "border-amber-300 dark:border-amber-700 bg-white dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-800/40"
            }`}
          >
            <ChevronRight className={`h-4 w-4 ${variant === "glass" ? "text-white/70" : "text-amber-600 dark:text-amber-400"}`} />
          </button>
        </div>
      )}
    </div>
  )
}
