import { prisma } from "@/lib/prisma"
import { MONTHLY_BUDGET_SECONDS } from "./config"

/**
 * The monthly voice budget, per organisation.
 *
 * This used to be one environment variable for the whole deployment, which
 * meant raising a single customer's ceiling required a release — and the
 * customer's own reading of "I topped up my balance" had nothing to do with it,
 * because the provider balance and this budget are unrelated numbers.
 *
 * The environment value stays as the default for organisations that have not
 * set their own, so nothing changes for anyone until an administrator says so.
 */
export const VOICE_MONTHLY_MINUTES_KEY = "voiceMonthlyMinutes"

/** Nobody should be able to set a ceiling that is zero, absurd, or fractional. */
export const MIN_VOICE_MONTHLY_MINUTES = 1
export const MAX_VOICE_MONTHLY_MINUTES = 100_000

export function normalizeMonthlyMinutes(value: unknown): number | null {
  const minutes = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10)
  if (!Number.isInteger(minutes)) return null
  if (minutes < MIN_VOICE_MONTHLY_MINUTES || minutes > MAX_VOICE_MONTHLY_MINUTES) return null
  return minutes
}

/**
 * Seconds this organisation may spend this month, falling back to the
 * deployment default. A malformed stored value falls back too rather than
 * failing the call: a settings typo must not take voice away from everyone.
 */
export async function monthlyBudgetSeconds(organizationId: string): Promise<number> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    })
    const settings = (org?.settings ?? {}) as Record<string, unknown>
    const minutes = normalizeMonthlyMinutes(settings[VOICE_MONTHLY_MINUTES_KEY])
    return minutes === null ? MONTHLY_BUDGET_SECONDS : minutes * 60
  } catch {
    // Reading a setting must never be the reason nobody can call. The whole
    // point of this lookup is a per-tenant ceiling; if it cannot be read, the
    // deployment default is the honest answer, not an outage.
    return MONTHLY_BUDGET_SECONDS
  }
}
