import { z } from "zod"
import { isPlausibleLeadPhone } from "@/lib/inbox/customer-phone"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const optionalPhone = z.string().max(50).refine(
  (value) => !value.trim() || isPlausibleLeadPhone(value),
  "Phone number must contain at least 10 digits and be valid",
)

export const createLeadCommandSchema = z.strictObject({
  contactName: z.string().min(1).max(200),
  companyName: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: optionalPhone.optional(),
  phoneWhatsApp: optionalPhone.optional(),
  telegramHandle: z.string().max(100).optional(),
  source: z.string().max(50).optional(),
  sourceDetail: z.string().max(200).optional(),
  sourceProfileUrl: z.string().url().max(1000).optional().or(z.literal("")),
  interest: z.string().max(2000).optional(),
  brand: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  status: z.enum(["new", "contacted", "qualified", "converted", "lost"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  estimatedValue: nonNegativeFinancialAmountSchema.optional(),
  assignedTo: z.string().min(1).optional(),
  pipelineId: z.string().min(1).optional(),
  notes: z.string().max(5000).optional(),
})

export type CreateLeadCommandInput = z.infer<typeof createLeadCommandSchema>
