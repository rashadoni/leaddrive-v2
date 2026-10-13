import { z } from "zod"

export const ATTENDANCE_SYSTEM_DAY_KINDS = ["WORKED", "OPEN", "MISSING_FINISH", "ABSENT", "WEEKEND", "HOLIDAY", "UPCOMING", "INVALID_FACTS"] as const
export const ATTENDANCE_DAY_GROUPS = ["WORK", "PAID_LEAVE", "UNPAID_LEAVE", "VIOLATION", "CALENDAR", "EMPLOYER"] as const
export const AttendanceDayKindSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  code: z.string().trim().regex(/^[\p{L}\p{N}?!·~]{1,6}$/u),
  names: z.object({ az: z.string().trim().min(1).max(80), ru: z.string().trim().min(1).max(80), en: z.string().trim().min(1).max(80) }).strict(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  group: z.enum(ATTENDANCE_DAY_GROUPS),
  paid: z.boolean().nullable(),
  unit: z.enum(["DAYS", "HOURS"]),
  countsAsWorked: z.boolean(),
  archived: z.boolean(),
}).strict()
export type AttendanceDayKind = z.infer<typeof AttendanceDayKindSchema>
export const AttendanceDayKindsSchema = z.array(AttendanceDayKindSchema).min(8).max(64).superRefine((items, context) => {
  if (new Set(items.map((item) => item.key)).size !== items.length) context.addIssue({ code: "custom", message: "Duplicate key" })
  if (new Set(items.filter((item) => !item.archived).map((item) => item.code.toLocaleUpperCase("az"))).size !== items.filter((item) => !item.archived).length) {
    context.addIssue({ code: "custom", message: "Duplicate code" })
  }
  for (const key of ATTENDANCE_SYSTEM_DAY_KINDS) {
    if (!items.some((item) => item.key === key && !item.archived)) context.addIssue({ code: "custom", message: `System day kind required: ${key}` })
  }
})
export const AttendanceDayKindsUpdateSchema = z.object({ version: z.string().datetime().nullable(), items: AttendanceDayKindsSchema }).strict()
export type AttendanceDayCatalogue = { items: AttendanceDayKind[]; version: string | null }
export function isSystemAttendanceDayKind(key: string) { return (ATTENDANCE_SYSTEM_DAY_KINDS as readonly string[]).includes(key) }

// These are editable company labels, not statutory codes or legal entitlements.
// Pay treatment starts unspecified; no legal rates or leave balances are seeded.
type Seed = [string, string, string, AttendanceDayKind["group"], AttendanceDayKind["unit"], boolean]
export const ATTENDANCE_DAY_KIND_SEEDS: Seed[] = [
  ["WORKED", "Я", "İ", "WORK", "HOURS", true],
  ["OPEN", "~", "~", "WORK", "HOURS", true],
  ["MISSING_FINISH", "!", "!", "VIOLATION", "HOURS", false],
  ["ABSENT", "НН", "Q", "VIOLATION", "DAYS", false],
  ["WEEKEND", "В", "B", "CALENDAR", "DAYS", false],
  ["HOLIDAY", "П", "E", "CALENDAR", "DAYS", false],
  ["UPCOMING", "·", "·", "CALENDAR", "DAYS", false],
  ["INVALID_FACTS", "?", "?", "VIOLATION", "HOURS", false],
  ["ANNUAL_LEAVE", "ОТ", "M", "PAID_LEAVE", "DAYS", false],
  ["ADDITIONAL_LEAVE", "ОД", "ƏM", "PAID_LEAVE", "DAYS", false],
  ["SICK_LEAVE", "Б", "X", "PAID_LEAVE", "DAYS", false],
  ["PARENTAL_LEAVE", "Р", "UM", "PAID_LEAVE", "DAYS", false],
  ["STUDY_LEAVE", "УЧ", "TM", "PAID_LEAVE", "DAYS", false],
  ["PUBLIC_DUTY", "Г", "DV", "PAID_LEAVE", "DAYS", false],
  ["MEDICAL_EXAM", "ОВ", "MM", "PAID_LEAVE", "DAYS", false],
  ["PAID_HOURS", "ПЧ", "ÖS", "PAID_LEAVE", "HOURS", false],
  ["UNPAID_LEAVE", "ДО", "ÖM", "UNPAID_LEAVE", "DAYS", false],
  ["TIME_OFF", "НВ", "ƏB", "UNPAID_LEAVE", "DAYS", false],
  ["HOURLY_ABSENCE", "Ч", "S", "UNPAID_LEAVE", "HOURS", false],
  ["UNPAID_SICK", "Т", "ÖX", "UNPAID_LEAVE", "DAYS", false],
  ["PERSONAL_LEAVE", "ОЗ", "ŞM", "UNPAID_LEAVE", "DAYS", false],
  ["BUSINESS_TRIP", "К", "EZ", "WORK", "DAYS", true],
  ["REMOTE_WORK", "У", "Uİ", "WORK", "DAYS", true],
  ["TRAINING", "ПК", "T", "WORK", "HOURS", true],
  ["OVERTIME", "С", "Əİ", "WORK", "HOURS", true],
  ["DAY_OFF_WORK", "РВ", "Bİ", "WORK", "HOURS", true],
  ["NIGHT_WORK", "Н", "Gİ", "WORK", "HOURS", true],
  ["DOWNTIME", "РП", "BD", "EMPLOYER", "HOURS", false],
  ["SUSPENSION", "НО", "K", "EMPLOYER", "DAYS", false],
  ["COMPANY_SHORT_DAY", "НС", "Qİ", "EMPLOYER", "HOURS", true],
  ["UNEXCUSED_ABSENCE", "ПР", "ÜQ", "VIOLATION", "DAYS", false],
  ["NOT_EMPLOYED", "НП", "İY", "CALENDAR", "DAYS", false],
]

const COLORS: Record<AttendanceDayKind["group"], string> = { WORK: "#047857", PAID_LEAVE: "#0369a1", UNPAID_LEAVE: "#6d28d9", VIOLATION: "#be123c", CALENDAR: "#52525b", EMPLOYER: "#b45309" }
export function attendanceDayKindPresetCodes(items: readonly AttendanceDayKind[], preset: "AZ" | "RU"): AttendanceDayKind[] {
  const codes = new Map(ATTENDANCE_DAY_KIND_SEEDS.map(([key, ru, az]) => [key, preset === "AZ" ? az : ru]))
  return items.map((item) => ({ ...item, code: codes.get(item.key) ?? item.code }))
}
export function defaultAttendanceDayKinds(names: (key: string) => AttendanceDayKind["names"]): AttendanceDayKind[] {
  return ATTENDANCE_DAY_KIND_SEEDS.map(([key, , code, group, unit, countsAsWorked]) => ({
    key, code, names: names(key), group, unit, countsAsWorked, color: COLORS[group], paid: null, archived: false,
  }))
}

/** The same cell and legend for the grid, XLSX and PDF. */
export function attendanceDayKindLabel(kind: AttendanceDayKind, locale: string) {
  return kind.names[locale === "az" || locale === "ru" ? locale : "en"]
}
