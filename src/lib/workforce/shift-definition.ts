import { createHash } from "node:crypto"
import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const WorkforcePlannedBreakSchema = z.object({
  startTime: z.string().regex(LOCAL_TIME, "planned break startTime must be HH:mm"),
  endTime: z.string().regex(LOCAL_TIME, "planned break endTime must be HH:mm"),
}).strict()

/**
 * The first supported schedule contract is deliberately small and explicit.
 * Weekdays use ISO numbering: Monday = 1 through Sunday = 7. Planned breaks
 * are immutable display metadata: they do not automatically deduct time or
 * create an attendance exception. Overnight shifts are not inferred; a later
 * owner decision can extend this contract safely.
 */
export const WorkforceShiftDefinitionSchema = z.object({
  startTime: z.string().regex(LOCAL_TIME, "startTime must be HH:mm"),
  endTime: z.string().regex(LOCAL_TIME, "endTime must be HH:mm"),
  timezone: z.string().refine(isValidTimezone, "timezone must be a valid IANA timezone"),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, "daysOfWeek must not contain duplicates"),
  // Optional rather than defaulted: historical, signed definitions predate
  // this metadata and must continue to verify against their original hash.
  plannedBreaks: z.array(WorkforcePlannedBreakSchema).max(8).optional(),
}).strict().superRefine((value, context) => {
  if (value.endTime <= value.startTime) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "overnight shifts are not supported; endTime must be after startTime",
    })
  }

  for (const [index, plannedBreak] of (value.plannedBreaks ?? []).entries()) {
    if (plannedBreak.endTime <= plannedBreak.startTime) {
      context.addIssue({
        code: "custom",
        path: ["plannedBreaks", index, "endTime"],
        message: "planned break endTime must be after startTime",
      })
    }
    if (plannedBreak.startTime <= value.startTime || plannedBreak.endTime >= value.endTime) {
      context.addIssue({
        code: "custom",
        path: ["plannedBreaks", index],
        message: "planned break must be strictly inside the shift window",
      })
    }
    const previous = value.plannedBreaks?.[index - 1]
    if (previous && plannedBreak.startTime < previous.endTime) {
      context.addIssue({
        code: "custom",
        path: ["plannedBreaks", index, "startTime"],
        message: "planned breaks must be chronological and non-overlapping",
      })
    }
  }
})

export type WorkforceShiftDefinition = z.infer<typeof WorkforceShiftDefinitionSchema>

export class WorkforceShiftDefinitionError extends Error {
  readonly code = "WORKFORCE_SHIFT_DEFINITION_INVALID"
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  )
}

export function canonicalWorkforceShiftJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function workforceShiftDefinitionHash(value: unknown): string {
  return createHash("sha256").update(canonicalWorkforceShiftJson(value)).digest("hex")
}

export type WorkforceResolvedShift = {
  workDate: string
  timezone: string
  plannedStartAt: string
  plannedEndAt: string
}

export function parseWorkforceShiftDefinition(value: unknown): WorkforceShiftDefinition {
  const parsed = WorkforceShiftDefinitionSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new WorkforceShiftDefinitionError(issue?.message ?? "Workforce shift definition is invalid")
  }
  return parsed.data
}

/**
 * Resolve a template definition for one organization-local work date. A
 * non-working weekday returns null; matching days return canonical UTC
 * instants suitable for the immutable shift snapshot and calculation engine.
 */
export function resolveWorkforceShiftDay(input: {
  workDate: string
  definition: unknown
  templateTimezone?: string
}): WorkforceResolvedShift | null {
  if (!isDateKey(input.workDate)) {
    throw new WorkforceShiftDefinitionError("workDate must be YYYY-MM-DD")
  }
  const definition = parseWorkforceShiftDefinition(input.definition)
  if (input.templateTimezone && input.templateTimezone !== definition.timezone) {
    throw new WorkforceShiftDefinitionError("template timezone must match its shift definition timezone")
  }

  const utcDate = new Date(input.workDate + "T00:00:00.000Z")
  const isoWeekday = utcDate.getUTCDay() === 0 ? 7 : utcDate.getUTCDay()
  if (!definition.daysOfWeek.includes(isoWeekday)) return null

  let plannedStartAt: Date
  let plannedEndAt: Date
  try {
    plannedStartAt = localDateTimeToUnambiguousUtc(
      input.workDate + "T" + definition.startTime,
      definition.timezone,
    )
    plannedEndAt = localDateTimeToUnambiguousUtc(
      input.workDate + "T" + definition.endTime,
      definition.timezone,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid local time"
    throw new WorkforceShiftDefinitionError(`shift ${message.toLowerCase()}`)
  }
  if (plannedEndAt <= plannedStartAt) {
    throw new WorkforceShiftDefinitionError("resolved shift must end after it starts")
  }

  return {
    workDate: input.workDate,
    timezone: definition.timezone,
    plannedStartAt: plannedStartAt.toISOString(),
    plannedEndAt: plannedEndAt.toISOString(),
  }
}
