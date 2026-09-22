import { z } from "zod"
import { DEMO_MODULE_IDS, isDemoModuleId } from "@/lib/demo-center/catalog"
import { DEMO_JOURNEY_STATES, JOURNEY_REPORT_NAMES, getDemoJourneyScenario } from "@/lib/demo-center/journey"
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

/**
 * A grant is issued for EITHER a guided scenario OR a module playlist, never
 * both and never neither. Accepting both would leave the player choosing
 * which one the prospect was actually granted, and accepting neither would
 * issue a link that opens nothing.
 */
export const demoGrantIssueSchema = z.object({
  scenarioId: z.string().trim().min(1).max(120).optional(),
  moduleIds: z.array(z.string()).max(DEMO_MODULE_IDS.length).default([])
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
  /** A real AI call to the prospect's proven phone. Only in a guided scenario. */
  liveCallEnabled: z.boolean().default(false),
}).superRefine((value, context) => {
  const hasScenario = !!value.scenarioId
  if (value.liveCallEnabled && !hasScenario) {
    context.addIssue({ code: "custom", path: ["liveCallEnabled"], message: "A live call needs a guided scenario" })
  }
  const hasModules = value.moduleIds.length > 0
  if (hasScenario && hasModules) {
    context.addIssue({ code: "custom", path: ["scenarioId"], message: "Choose a scenario or modules, not both" })
  }
  if (!hasScenario && !hasModules) {
    context.addIssue({ code: "custom", path: ["moduleIds"], message: "Choose a scenario or at least one module" })
  }
  if (hasScenario && !isApprovedDemoScenario(value.scenarioId!)) {
    context.addIssue({ code: "custom", path: ["scenarioId"], message: `Unknown demo scenario: ${value.scenarioId}` })
  }
})

export const demoOtpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
})

/** The AI calls only the phone the prospect gave on the request form (owner
 *  decision 2026-09-22): the browser cannot name any other number, so a demo
 *  cannot be used to point the agent at somebody else's phone. */
export const demoPhoneCodeSchema = z.object({ useRequestPhone: z.literal(true) }).strict()

export const demoPhoneVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
  consent: z.boolean(),
}).strict()

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

/** A guided story's progress report (journey/telemetry.ts). Strict: an extra
 *  field is refused rather than silently dropped. */
export const demoJourneyReportSchema = z.object({
  eventType: z.literal("JOURNEY"),
  name: z.enum(JOURNEY_REPORT_NAMES),
  sectionId: z.string().min(1).max(64),
  stepId: z.string().min(1).max(120).optional(),
  to: z.enum(DEMO_JOURNEY_STATES).optional(),
}).strict()

export const demoRejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

/** A scenario the server itself approves — never a free-form id from a form. */
function isApprovedDemoScenario(scenarioId: string): boolean {
  return getDemoJourneyScenario(scenarioId) !== null
}
