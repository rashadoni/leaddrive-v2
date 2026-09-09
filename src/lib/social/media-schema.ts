import { z } from "zod"

export const discoveryLeadSchema = z.object({
  subjectId: z.string().trim().min(1).max(255).nullable().optional(),
  sourceId: z.string().trim().min(1).max(255).nullable().optional(),
  leadType: z.enum(["MANUAL_URL", "IMAGE_SEARCH_RESULT", "MANUAL_UPLOAD"]).optional(),
  submittedUrl: z.string().trim().url().max(2048),
  platformHint: z.string().trim().max(40).nullable().optional(),
  mediaType: z.enum(["AUTO", "IMAGE", "VIDEO", "AUDIO"]).optional(),
  title: z.string().trim().max(500).nullable().optional(),
  thumbnailUrl: z.string().trim().url().max(2048).nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
}).strict()

export const mediaPolicySchema = z.object({
  enabled: z.boolean().optional(),
  coverOcrEnabled: z.boolean().optional(),
  frameOcrEnabled: z.boolean().optional(),
  asrEnabled: z.boolean().optional(),
  multimodalEnabled: z.boolean().optional(),
  preferPlatformTranscript: z.boolean().optional(),
  dailyBudgetUsd: z.number().min(0).max(100_000).optional(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).optional(),
  perObservationBudgetUsd: z.number().min(0).max(1_000).optional(),
  maxFramesPerVideo: z.number().int().min(1).max(24).optional(),
  frameCandidatePercent: z.number().min(0).max(100).optional(),
  asrCandidatePercent: z.number().min(0).max(100).optional(),
  multimodalCandidatePercent: z.number().min(0).max(100).optional(),
  mediaRetentionDays: z.number().int().min(1).max(180).optional(),
  signalRetentionDays: z.number().int().min(1).max(730).optional(),
}).strict()

export const visualReferenceSchema = z.object({
  subjectId: z.string().trim().min(1).max(255),
  referenceType: z.enum(["LOGO", "PRODUCT_PACKAGING", "NAME_CARD", "MANUAL_CONTEXT"]),
  label: z.string().trim().min(1).max(200),
  imageUrl: z.string().trim().url().max(2048),
  notes: z.string().trim().max(1_000).nullable().optional(),
}).strict()
