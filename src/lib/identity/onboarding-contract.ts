import { z } from "zod"
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
const revision = z.number().int().positive().max(2_147_483_640)
export const IdentityOnboardingPlan = z.object({
  application: z.enum(["CRM", "TIME", "ROUTE_FIELD"]), role: z.string().max(50).nullable(), status: z.enum(["ACTIVE", "REVOKED"]),
  grantVersion: revision, actorId: id.nullable(), membershipVersion: z.number().int().min(0).max(2_147_483_640),
  membershipStatus: z.enum(["ACTIVE", "REVOKED"]).nullable(),
}).strict()
export const IdentityOnboardingInput = z.object({
  userId: id, phone: z.string().min(7).max(40), application: z.enum(["TIME", "ROUTE_FIELD"]),
  expectedAccountVersion: revision, expectedCredentialEpoch: revision, expectedContactRevision: revision,
  applications: z.array(IdentityOnboardingPlan).min(1).max(3), reviewReference: id, requestId: id,
}).strict().refine(value => new Set(value.applications.map(p => p.application)).size === value.applications.length
  && value.applications.some(p => p.application === value.application && p.status === "ACTIVE" && p.actorId && p.membershipStatus === "ACTIVE"))
export type OnboardingPlan = z.infer<typeof IdentityOnboardingPlan>
export const orderedOnboardingPlans = (plans: OnboardingPlan[]) => [...plans].sort((a, b) => a.application.localeCompare(b.application))
