import { z } from "zod"
import { DEMO_MODULE_IDS, isDemoModuleId } from "@/lib/demo-center/catalog"
import { isCorporateEmail, normalizeEmail } from "@/lib/demo-center/security"

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""))

export const demoRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(160),
  jobTitle: optionalText(120),
  email: z.string().trim().email().max(254).transform(normalizeEmail),
  phone: optionalText(40),
  message: optionalText(2_000),
  requestedModules: z.array(z.string()).max(DEMO_MODULE_IDS.length).default([])
    .transform((values) => [...new Set(values.filter(isDemoModuleId))]),
  locale: z.enum(["az", "ru", "en"]).default("az"),
  consent: z.literal(true),
  // Honeypot input is intentionally accepted here so bots receive the same
  // generic success response instead of learning which anti-spam check fired.
  website: z.string().max(500).optional(),
}).superRefine((value, context) => {
  if (!isCorporateEmail(value.email)) {
    context.addIssue({
      code: "custom",
      path: ["email"],
      message: "Korporativ e-poçt ünvanından istifadə edin",
    })
  }
})

export const demoGrantIssueSchema = z.object({
  moduleIds: z.array(z.string()).min(1).max(DEMO_MODULE_IDS.length)
    .transform((values, context) => {
      const unique = [...new Set(values)]
      const invalid = unique.find((value) => !isDemoModuleId(value))
      if (invalid) {
        context.addIssue({ code: "custom", message: `Unknown demo module: ${invalid}` })
        return z.NEVER
      }
      return unique
    }),
  linkValidDays: z.number().int().min(1).max(30).default(7),
  sessionDurationMinutes: z.number().int().min(15).max(240).default(120),
  inactivityMinutes: z.number().int().min(5).max(60).default(30),
  locale: z.enum(["az", "ru", "en"]).default("az"),
})

export const demoOtpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
})

export const demoEventSchema = z.object({
  eventType: z.enum(["MODULE_OPENED", "STEP_VIEWED", "COMPLETED"]),
  moduleId: z.string().optional(),
  stepId: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).superRefine((event, context) => {
  if (event.eventType !== "COMPLETED" && (!event.moduleId || !isDemoModuleId(event.moduleId))) {
    context.addIssue({ code: "custom", path: ["moduleId"], message: "A valid module is required" })
  }
})

export const demoRejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})
