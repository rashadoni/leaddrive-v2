import { z } from "zod"

export const createDealCommandSchema = z.strictObject({
  name: z.string().min(1).max(200),
  companyId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  stage: z.string().min(1).max(100).optional(),
  pipelineId: z.string().min(1).optional(),
  valueAmount: z.number().finite().min(0).max(999_999_999).optional(),
  currency: z.string().max(5).optional(),
  probability: z.number().finite().min(0).max(100).optional(),
  expectedClose: z.string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid expectedClose")
    .optional(),
  assignedTo: z.string().min(1).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
})

export type CreateDealCommandInput = z.infer<typeof createDealCommandSchema>
