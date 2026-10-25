import { z } from "zod"
import { isDateKey } from "../mtm/mobile-week"
const id = z.string().min(1).max(128)
export const IdentityTimeEnrollmentFields = z.object({
  position: z.string().trim().max(120).nullable(), teamId: id.nullable(), newTeamName: z.string().trim().min(1).max(120).optional(),
  departmentId: id.nullable(), newDepartmentName: z.string().trim().min(1).max(120).optional(),
  hireDate: z.string().refine(isDateKey).nullable(),
}).strict()
const consistentUnit = (value: z.infer<typeof IdentityTimeEnrollmentFields>) => !(value.teamId && value.newTeamName) && !(value.departmentId && value.newDepartmentName)
export const IdentityTimeEnrollmentMetadata = IdentityTimeEnrollmentFields.refine(consistentUnit)
export const IdentityTimeEnrollmentInput = IdentityTimeEnrollmentFields.extend({
  userId: id, expectedClaimId: id, expectedAccountVersion: z.number().int().positive().max(2_147_483_640), requestId: z.string().uuid(),
}).strict().refine(consistentUnit)
export type IdentityTimeEnrollmentRequest = z.infer<typeof IdentityTimeEnrollmentInput>
export const IdentityLegacyTimeCandidate = z.object({
  kind: z.literal("legacy"), userId: id, name: z.string().max(200), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  fieldActorId: id.nullable(), fieldRole: z.string().max(50).nullable(), crmRole: z.string().max(50),
})

export const IdentityTimePersonResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  IdentityLegacyTimeCandidate,
  z.object({ kind: z.literal("administrator_setup") }),
  z.object({ kind: z.literal("canonical"), userId: id, name: z.string().max(200), claimId: id,
    accountVersion: z.number().int().positive(), timeActorId: id.nullable() }),
])
export type IdentityTimePerson = z.infer<typeof IdentityTimePersonResult>
