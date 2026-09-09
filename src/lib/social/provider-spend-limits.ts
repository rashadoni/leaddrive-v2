/**
 * Non-configurable safety ceiling for paid Social Monitoring providers.
 *
 * Tenant/source budgets may be lower, but never higher. The ceiling is shared
 * across providers so switching from Bright Data to Apify cannot multiply the
 * same tenant's exposure. Raising it requires a reviewed code/deploy change.
 */
export const PAID_SOCIAL_HARD_MAX_PER_RUN_USD = 4
export const PAID_SOCIAL_HARD_DAILY_BUDGET_USD = 4
export const PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD = 120

/**
 * One-request provider fuse for an explicit administrator-triggered,
 * client-funded manual run. This is not a tenant quota or a recurring budget:
 * it only prevents a malformed provider request from becoming unbounded.
 * Automatic/scheduled collection never receives this allowance.
 */
export const CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD = 100

const MICRO_USD_PER_USD = 1_000_000
const MIN_PROVIDER_ALLOCATION_MICRO_USD = 10_000

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

export function boundedPaidSocialRunChargeUsd(requested: number): number {
  return Math.min(Math.max(0, requested), PAID_SOCIAL_HARD_MAX_PER_RUN_USD)
}

export function boundedClientFundedManualChargeUsd(requested: number): number {
  return Math.min(Math.max(0, requested), CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD)
}

export type ClientFundedSourceCapsUsd = Readonly<{
  discoveryUsd: number
  commentsUsd: number | null
}>

/**
 * Statically divides one client-authorized source cap between discovery and
 * its dependent comments request. The result is rounded down to micro-USD so
 * its allocations can never exceed the authorization.
 *
 * Instagram may divide the discovery allocation again between its paired
 * posts and reels requests; that provider-specific split belongs to the
 * caller.
 */
export function allocateClientFundedSourceCapsUsd(input: {
  authorizedTotalUsd: number
  includeDependentComments: boolean
}): ClientFundedSourceCapsUsd | null {
  const { authorizedTotalUsd, includeDependentComments } = input
  if (
    !Number.isFinite(authorizedTotalUsd)
    || authorizedTotalUsd <= 0
    || authorizedTotalUsd > CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD
  ) {
    return null
  }

  const authorizedMicroUsd = Math.floor(authorizedTotalUsd * MICRO_USD_PER_USD)
  const fuseMicroUsd = CLIENT_FUNDED_MANUAL_PROVIDER_FUSE_USD * MICRO_USD_PER_USD
  if (
    !Number.isSafeInteger(authorizedMicroUsd)
    || authorizedMicroUsd <= 0
    || authorizedMicroUsd > fuseMicroUsd
  ) {
    return null
  }

  if (!includeDependentComments) {
    return Object.freeze({
      discoveryUsd: authorizedMicroUsd / MICRO_USD_PER_USD,
      commentsUsd: null,
    })
  }

  if (authorizedMicroUsd < MIN_PROVIDER_ALLOCATION_MICRO_USD * 2) {
    return null
  }

  const commentsMicroUsd = Math.floor(authorizedMicroUsd / 2)
  const discoveryMicroUsd = authorizedMicroUsd - commentsMicroUsd
  if (
    discoveryMicroUsd < MIN_PROVIDER_ALLOCATION_MICRO_USD
    || commentsMicroUsd < MIN_PROVIDER_ALLOCATION_MICRO_USD
  ) {
    return null
  }

  return Object.freeze({
    discoveryUsd: discoveryMicroUsd / MICRO_USD_PER_USD,
    commentsUsd: commentsMicroUsd / MICRO_USD_PER_USD,
  })
}

export function effectivePaidSocialPeriodLimits(input: {
  configuredDailyUsd?: number | null
  configuredMonthlyUsd?: number | null
}) {
  const configuredDaily = positive(input.configuredDailyUsd)
  const configuredMonthly = positive(input.configuredMonthlyUsd)
  return {
    dailyUsd: Math.min(configuredDaily ?? PAID_SOCIAL_HARD_DAILY_BUDGET_USD, PAID_SOCIAL_HARD_DAILY_BUDGET_USD),
    monthlyUsd: Math.min(configuredMonthly ?? PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD, PAID_SOCIAL_HARD_MONTHLY_BUDGET_USD),
  }
}
