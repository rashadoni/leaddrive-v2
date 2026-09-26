import { z } from "zod"
import { isPlausibleLeadPhone } from "@/lib/inbox/customer-phone"
import {
  LEAD_REPORTED_CUSTOMER_STAGES,
  normalizeLeadReportedCustomerStages,
  validateLeadReportedCustomerStages,
} from "@/lib/inbox/customer-stage"
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

const updatePhone = z.string().refine(
  (value) => !value.trim() || isPlausibleLeadPhone(value),
  "Phone number must contain at least 10 digits and be valid",
)

export const updateLeadCommandSchema = z.strictObject({
  contactName: z.string().min(1).max(255).optional(),
  companyName: z.string().nullable().optional(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: updatePhone.nullable().optional(),
  phoneWhatsApp: updatePhone.nullable().optional(),
  telegramHandle: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  sourceDetail: z.string().max(200).nullable().optional(),
  sourceProfileUrl: z.string().url().max(1000).nullable().optional().or(z.literal("")),
  interest: z.string().max(2000).nullable().optional(),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  score: z.number().int().min(0).max(100).optional(),
  assignedTo: z.string().nullable().optional(),
  pipelineId: z.string().nullable().optional(),
  estimatedValue: nonNegativeFinancialAmountSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  customerStage: z.enum(LEAD_REPORTED_CUSTOMER_STAGES).optional(),
  salesCallOutcomes: z.array(z.enum(LEAD_REPORTED_CUSTOMER_STAGES)).max(7).optional(),
  customerStageReason: z.string().max(2000).nullable().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, context) => {
  const outcomes = value.salesCallOutcomes
    ?? (value.customerStage ? [value.customerStage] : undefined)
  if (outcomes && !value.customerStageReason?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["customerStageReason"],
      message: "A short lead qualification note is required",
    })
  }
  if (outcomes && !validateLeadReportedCustomerStages(normalizeLeadReportedCustomerStages(outcomes))) {
    context.addIssue({
      code: "custom",
      path: ["salesCallOutcomes"],
      message: "Choose at least one compatible qualification signal",
    })
  }
})

export type UpdateLeadCommandInput = z.infer<typeof updateLeadCommandSchema>

export const convertLeadToDealCommandSchema = z.strictObject({
  dealTitle: z.string().min(1).max(200),
  dealStage: z.string().min(1).max(100).optional(),
  dealValue: nonNegativeFinancialAmountSchema.optional(),
  createCompany: z.boolean().optional(),
  pipelineId: z.string().min(1).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export type ConvertLeadToDealCommandInput = z.infer<typeof convertLeadToDealCommandSchema>
