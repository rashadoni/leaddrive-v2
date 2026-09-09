import { earnPreview, type PreviewEarnRule, type PreviewTier } from "./preview"

export type LaunchStatus = "needs_setup" | "ready_to_test" | "live" | "needs_attention"
export type LaunchStepKey = "tiers" | "earning" | "rewards" | "portal" | "autoEarn" | "pos" | "members"

export interface LoyaltySettingsState {
  memberPortalEnabled: boolean
  autoEarnEnabled: boolean
  autoEarnSkipped?: boolean
}

export interface LoyaltyOverviewLike {
  totalAccounts: number
  thirtyDayTotals?: {
    earn: number
    redeem: number
    expire: number
    adjustmentNet?: number
    totalTransactions: number
  }
  recentTransactions?: Array<{
    type: string
    delta: number
    createdAt?: string
  }>
}

export interface LaunchStepState {
  key: LaunchStepKey
  complete: boolean
  recommended: boolean
  skipped?: boolean
}

export interface LaunchReadiness {
  status: LaunchStatus
  score: number
  steps: LaunchStepState[]
  nextStep: LaunchStepKey | null
  canRunPosTest: boolean
}

export interface LaunchReadinessInput {
  tiersCount: number
  earnRulesCount: number
  rewardsCount: number
  settings: LoyaltySettingsState
  overview?: LoyaltyOverviewLike | null
}

export interface LoyaltyInsight {
  id:
    | "no_members"
    | "no_rules"
    | "no_rewards"
    | "portal_disabled"
    | "auto_earn_disabled"
    | "ready_for_pos_test"
    | "no_recent_transactions"
    | "low_redemption"
    | "expiring_points"
  severity: "critical" | "warning" | "info" | "success"
  ctaHref: string
}

export interface LoyaltyHealthScore {
  total: number
  setup: number
  activity: number
  redemption: number
  memberGrowth: number
}

export interface LoyaltyInsightsResult {
  health: LoyaltyHealthScore
  insights: LoyaltyInsight[]
}

export interface PosSuggestionInput {
  amount: number
  currency: string
  memberTier: string | null
  rules: readonly PreviewEarnRule[]
  tiers: readonly PreviewTier[]
}

export interface PosSuggestion {
  points: number
  base: number
  multiplier: number
  ruleName: string | null
  source: "flat" | "rate" | "no_rule"
  formula: {
    amount: number
    base: number
    multiplier: number
  }
}

export type EarnRuleWizardScenario = "purchase" | "signup" | "referral" | "birthday" | "review" | "survey" | "custom"
export type EarnRuleWizardAwardType = "rate" | "flat"

export interface EarnRuleWizardInput {
  name: string
  scenario: EarnRuleWizardScenario
  awardType: EarnRuleWizardAwardType
  pointsRate?: number | null
  pointsFlat?: number | null
  minOrderAmount?: number | null
  productCategory?: string | null
  priority?: number
  applyTierMultiplier?: boolean
  isActive?: boolean
  validFrom?: string | null
  validUntil?: string | null
}

export interface EarnRuleWizardPayload {
  name: string
  trigger: EarnRuleWizardScenario
  pointsRate: number | null
  pointsFlat: number | null
  minOrderAmount: number | null
  productCategory: string | null
  priority: number
  applyTierMultiplier: boolean
  isActive: boolean
  validFrom: string | null
  validUntil: string | null
}

const STEP_ORDER: LaunchStepKey[] = ["tiers", "earning", "rewards", "portal", "autoEarn", "pos", "members"]

export function inferPosTestCompleted(overview?: LoyaltyOverviewLike | null): boolean {
  if (!overview) return false
  return (overview.recentTransactions ?? []).some((tx) => tx.type === "earn" && tx.delta > 0)
}

export function computeLaunchReadiness(input: LaunchReadinessInput): LaunchReadiness {
  const hasTiers = input.tiersCount > 0
  const hasRules = input.earnRulesCount > 0
  const hasRewards = input.rewardsCount > 0
  const hasPortal = input.settings.memberPortalEnabled
  const hasAutoEarn = input.settings.autoEarnEnabled
  const hasAutoEarnDecision = hasAutoEarn || input.settings.autoEarnSkipped === true
  const hasPosTest = inferPosTestCompleted(input.overview)
  const hasMembers = (input.overview?.totalAccounts ?? 0) > 0

  const recommended: Record<LaunchStepKey, boolean> = {
    tiers: true,
    earning: true,
    rewards: true,
    portal: true,
    autoEarn: true,
    pos: hasTiers && hasRules,
    members: hasTiers && hasRules,
  }
  const completeByKey: Record<LaunchStepKey, boolean> = {
    tiers: hasTiers,
    earning: hasRules,
    rewards: hasRewards,
    portal: hasPortal,
    autoEarn: hasAutoEarnDecision,
    pos: hasPosTest,
    members: hasMembers,
  }
  const steps = STEP_ORDER.map((key) => ({
    key,
    complete: completeByKey[key],
    recommended: recommended[key],
    skipped: key === "autoEarn" && !hasAutoEarn && input.settings.autoEarnSkipped === true,
  }))
  const completed = steps.filter((step) => step.complete).length
  const score = Math.round((completed / steps.length) * 100)
  const nextStep = steps.find((step) => !step.complete)?.key ?? null
  const minimumSetupReady = hasTiers && hasRules && hasRewards

  let status: LaunchStatus = "needs_setup"
  if (minimumSetupReady && hasPortal && hasAutoEarnDecision && hasPosTest && hasMembers) {
    status = "live"
  } else if (minimumSetupReady && hasPortal) {
    status = hasMembers && !hasPosTest ? "needs_attention" : "ready_to_test"
  } else if (hasMembers && (!hasRewards || !hasPortal || !hasRules)) {
    status = "needs_attention"
  }

  return {
    status,
    score,
    steps,
    nextStep,
    canRunPosTest: minimumSetupReady,
  }
}

export function buildLoyaltyInsights(input: LaunchReadinessInput): LoyaltyInsightsResult {
  const readiness = computeLaunchReadiness(input)
  const totals = input.overview?.thirtyDayTotals
  const earned = totals?.earn ?? 0
  const redeemed = totals?.redeem ?? 0
  const expired = totals?.expire ?? 0
  const transactions = totals?.totalTransactions ?? 0
  const hasRecentEarn = inferPosTestCompleted(input.overview)

  const setup = readiness.score
  const activity = Math.min(100, transactions * 20)
  const redemption = earned > 0 ? Math.min(100, Math.round((redeemed / earned) * 100)) : input.rewardsCount > 0 ? 40 : 0
  const memberGrowth = Math.min(100, (input.overview?.totalAccounts ?? 0) * 10)
  const health = {
    setup,
    activity,
    redemption,
    memberGrowth,
    total: Math.round(setup * 0.4 + activity * 0.25 + redemption * 0.2 + memberGrowth * 0.15),
  }

  const insights: LoyaltyInsight[] = []
  if ((input.overview?.totalAccounts ?? 0) === 0) {
    insights.push({ id: "no_members", severity: "critical", ctaHref: "/loyalty/pos" })
  }
  if (input.earnRulesCount === 0) {
    insights.push({ id: "no_rules", severity: "critical", ctaHref: "/loyalty/builder" })
  }
  if (input.rewardsCount === 0) {
    insights.push({ id: "no_rewards", severity: "warning", ctaHref: "/loyalty/builder" })
  }
  if (!input.settings.memberPortalEnabled) {
    insights.push({ id: "portal_disabled", severity: "warning", ctaHref: "/loyalty/builder" })
  }
  if (!input.settings.autoEarnEnabled && input.settings.autoEarnSkipped !== true && input.earnRulesCount > 0) {
    insights.push({ id: "auto_earn_disabled", severity: "info", ctaHref: "/loyalty/builder" })
  }
  if (readiness.canRunPosTest && !hasRecentEarn) {
    insights.push({ id: "ready_for_pos_test", severity: "info", ctaHref: "/loyalty/pos" })
  }
  if ((input.overview?.totalAccounts ?? 0) > 0 && transactions === 0) {
    insights.push({ id: "no_recent_transactions", severity: "warning", ctaHref: "/loyalty/pos" })
  }
  if (earned >= 100 && redeemed === 0 && input.rewardsCount > 0) {
    insights.push({ id: "low_redemption", severity: "warning", ctaHref: "/loyalty/builder" })
  }
  if (expired > 0 && redeemed === 0) {
    insights.push({ id: "expiring_points", severity: "info", ctaHref: "/loyalty/dashboard" })
  }

  if (insights.length === 0) {
    insights.push({ id: "ready_for_pos_test", severity: "success", ctaHref: "/loyalty/pos" })
  }

  return { health, insights: insights.slice(0, 4) }
}

export function suggestPosAward(input: PosSuggestionInput): PosSuggestion {
  const amount = Number.isFinite(input.amount) && input.amount > 0 ? input.amount : 0
  const rows = earnPreview(input.rules, input.tiers, {
    trigger: "purchase",
    orderAmount: amount,
    currency: input.currency,
  })
  const exactTier = rows.find((row) => row.tierCode === input.memberTier)
  const fallbackTier = rows.find((row) => row.tierCode !== null) ?? rows[0]
  const row = exactTier ?? fallbackTier
  if (!row) {
    return {
      points: 0,
      base: 0,
      multiplier: 1,
      ruleName: null,
      source: "no_rule",
      formula: { amount, base: 0, multiplier: 1 },
    }
  }
  return {
    points: row.award,
    base: row.base,
    multiplier: row.multiplier,
    ruleName: row.ruleName,
    source: row.source,
    formula: { amount, base: row.base, multiplier: row.multiplier },
  }
}

export function buildEarnRuleWizardPayload(input: EarnRuleWizardInput): EarnRuleWizardPayload {
  const purchaseLike = input.scenario === "purchase"
  return {
    name: input.name.trim(),
    trigger: input.scenario,
    pointsRate: input.awardType === "rate" ? input.pointsRate ?? 1 : null,
    pointsFlat: input.awardType === "flat" ? input.pointsFlat ?? 100 : null,
    minOrderAmount: purchaseLike ? input.minOrderAmount ?? null : null,
    productCategory: input.productCategory?.trim() || null,
    priority: input.priority ?? 0,
    applyTierMultiplier: input.applyTierMultiplier ?? purchaseLike,
    isActive: input.isActive ?? true,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
  }
}
