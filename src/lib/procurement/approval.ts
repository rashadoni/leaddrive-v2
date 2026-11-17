import { z } from "zod"
import { isAdmin, type Role } from "@/lib/permissions"

/**
 * Who approves a purchase order (docs/sales-procurement/README.md, task 3.4).
 *
 * The organization keeps a list of bands in `settings.procurement.approvalRules`:
 * "from `minAmount` up to (not including) `maxAmount` — these approvers, in this
 * order". An order takes the band its total falls into. No band, or no rules at
 * all, means one step by a manager: an order is never sent without a second
 * person, whatever was configured.
 *
 * An approver is a role (any person with it) or one named person. An
 * administrator may act on any step — in an organization where one person runs
 * purchasing, a strict chain would stop every order.
 */
export const APPROVER_ROLES = ["manager", "finance", "procurement", "admin"] as const
export type ApproverRole = (typeof APPROVER_ROLES)[number]

const approverSchema = z.union([
  z.object({ role: z.enum(APPROVER_ROLES) }).strict(),
  z.object({ userId: z.string().min(1).max(64) }).strict(),
])
export type Approver = z.infer<typeof approverSchema>

export const approvalRuleSchema = z.object({
  minAmount: z.number().min(0).max(1e12),
  maxAmount: z.number().min(0).max(1e12).nullable(),
  approvers: z.array(approverSchema).min(1).max(5),
}).strict().refine((rule) => rule.maxAmount === null || rule.maxAmount > rule.minAmount, "maxAmount must exceed minAmount")
export type ApprovalRule = z.infer<typeof approvalRuleSchema>

export const approvalRulesSchema = z.array(approvalRuleSchema).max(10).superRefine((rules, ctx) => {
  const sorted = [...rules].sort((a, b) => a.minAmount - b.minAmount)
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]
    if (previous.maxAmount === null || previous.maxAmount > sorted[i].minAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bands overlap" })
      return
    }
  }
})

export const DEFAULT_APPROVERS: readonly Approver[] = [{ role: "manager" }]

/** The rules as stored, or [] when the stored value is not a valid list. */
export function readApprovalRules(settings: unknown): ApprovalRule[] {
  const value = (settings as { procurement?: { approvalRules?: unknown } } | null)?.procurement?.approvalRules
  const parsed = approvalRulesSchema.safeParse(value ?? [])
  return parsed.success ? parsed.data : []
}

/** The approvers, in order, for an order of this total. */
export function approversFor(total: number, rules: readonly ApprovalRule[]): Approver[] {
  const band = rules.find((rule) => total >= rule.minAmount && (rule.maxAmount === null || total < rule.maxAmount))
  return band ? band.approvers.map((approver) => ({ ...approver })) : DEFAULT_APPROVERS.map((approver) => ({ ...approver }))
}

/**
 * May this person act on this step of this order?
 * - the step must be the order's current one (the lowest pending);
 * - the author of the order never approves it, unless an administrator;
 * - an administrator may act on any step; otherwise the role or the named person must match.
 */
export function mayActOnStep(
  step: { approverRole: string | null; approverUserId: string | null },
  order: { createdById: string | null },
  actor: { userId: string; role: string },
): boolean {
  const admin = isAdmin(actor.role as Role)
  if (!admin && order.createdById && order.createdById === actor.userId) return false
  if (admin) return true
  if (step.approverUserId) return step.approverUserId === actor.userId
  return step.approverRole === actor.role
}
