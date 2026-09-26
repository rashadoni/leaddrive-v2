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

/**
 * A partial deal update — the PUT/PATCH /api/v1/deals/:id contract, moved here
 * so the REST route and a voice receipt run the same command (roadmap C1.13).
 * `expectedUpdatedAt` is the optimistic lock a reviewed voice draft carries.
 */
export const updateDealCommandSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  companyId: z.string().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  pipelineId: z.string().nullable().optional(),
  stage: z.string().optional(),
  valueAmount: z.number().min(0).max(999999999).optional(),
  currency: z.string().max(5).optional(),
  probability: z.number().min(0).max(100).optional(),
  expectedClose: z.string().nullable().optional(),
  assignedTo: z.string().optional(),
  lostReason: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  confidenceLevel: z.number().min(0).max(100).optional(),
  contactId: z.string().nullable().optional(),
  customerNeed: z.string().max(500).optional(),
  salesChannel: z.string().max(100).optional(),
  // D1 MEDDPICC — free-form object; normalised via parseMeddpicc in the
  // command so only the 8 known blocks with valid scores/bounded strings are stored.
  meddpicc: z.record(z.string(), z.unknown()).nullable().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export type UpdateDealCommandInput = z.infer<typeof updateDealCommandSchema>
