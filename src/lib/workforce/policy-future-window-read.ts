import type { Prisma } from "@prisma/client"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { previewWorkforcePolicyFutureWindow, WORKFORCE_POLICY_WINDOW_LIMIT } from "./policy-future-window-preview"
import type { WorkforcePolicyComparisonRecord } from "./policy-version-comparison"

const select = { id: true, organizationId: true, teamId: true, version: true, status: true, name: true,
  effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true } as const

/** Caller supplies its authorized, repeatable-read transaction; this function only reads. */
export async function readWorkforcePolicyFutureWindow(tx: Prisma.TransactionClient, input: {
  organizationId: string; policyId: string; observedAt: Date
}) {
  const draft: WorkforcePolicyComparisonRecord | null = await tx.workforcePolicy.findFirst({
    where: { id: input.policyId, organizationId: input.organizationId }, select,
  })
  if (!draft) return null
  const timezoneSetting: { value: unknown } | null = await tx.mtmSetting.findFirst({
    where: { organizationId: input.organizationId, key: "timezone" }, select: { value: true },
  })
  // Preserve canonical activation's default/string/invalid->UTC rules.
  const configuredTimezone = typeof timezoneSetting?.value === "string" ? timezoneSetting.value : MTM_SETTING_DEFAULTS.timezone
  const timezone = isValidTimezone(configuredTimezone) ? configuredTimezone : "UTC"
  const published: WorkforcePolicyComparisonRecord[] = await tx.workforcePolicy.findMany({
    where: { organizationId: input.organizationId, teamId: draft.teamId, status: "ACTIVE" }, select,
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: WORKFORCE_POLICY_WINDOW_LIMIT + 1,
  })
  return { ...previewWorkforcePolicyFutureWindow({ organizationId: input.organizationId,
    currentDate: currentDateKey(input.observedAt, timezone), draft, published }), timezone, observedAt: input.observedAt.toISOString() }
}
