import { z } from "zod"

/** Private administrator review only; never a capability to adopt a profile. */
export const IdentitySelfBootstrapConflicts = z.array(z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(["crm", "field", "time"]),
  name: z.string().max(200),
  active: z.boolean(),
  ownerName: z.string().max(200).nullable(),
}).strict()).max(6)
export type IdentitySelfBootstrapConflict = z.infer<typeof IdentitySelfBootstrapConflicts>[number]
