import { z } from "zod"
import { IdentityTimeEnrollmentMetadata } from "./time-enrollment-contract"
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
export const IdentityTimeOnboardingInput = z.object({
  userId: id, phone: z.string().min(7).max(40), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  preserveCrm: z.boolean(), requestId: z.string().uuid(), timeEnrollment: IdentityTimeEnrollmentMetadata,
}).strict()
