import { Prisma } from "@prisma/client"
import { z } from "zod"
import {
  PHARMACY_PROMOTION_AMOUNT_MODES,
  PHARMACY_PROMOTION_DATE_MODES,
  PHARMACY_PROMOTION_EXECUTION_STATUSES,
  PHARMACY_PROMOTION_PAGE_SIZES,
  PHARMACY_PROMOTION_READINESS,
  PHARMACY_PROMOTION_REVIEW_STATES,
  PHARMACY_PROMOTION_SORTS,
  PHARMACY_PROMOTION_VIEWS,
  PHARMACY_PROMOTION_VISIT_STATUSES,
  pharmacyPromotionFilterValidationError,
  pharmacyPromotionFiltersFromSearchParams,
  type PharmacyPromotionFilters,
} from "@/lib/mtm/pharmacy-promotion"

export const PHARMACY_PROMOTION_EXECUTION_VIEW_ENTITY = "mtm_pharmacy_promotion_executions"

const optionalText = (max = 120) => z.string().trim().max(max).optional()
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.literal(""), z.enum(values)]).optional()

const optionalDecimal = z.union([
  z.literal(""),
  z.number().finite(),
  z.string().trim().min(1).max(100),
]).transform((value, context) => {
  if (value === "") return ""
  try {
    const raw = String(value)
    if (!/^-?\d{1,14}(?:\.\d{1,4})?$/.test(raw)) throw new Error("outside Decimal(18,4)")
    const decimal = new Prisma.Decimal(raw)
    if (!decimal.isFinite()) throw new Error("not finite")
    return decimal.toString()
  } catch {
    context.addIssue({ code: "custom", message: "Expected a finite decimal value" })
    return z.NEVER
  }
}).optional()

const optionalDate = z.union([z.literal(""), z.string().date()]).optional()

const columnList = z.string().trim().max(500).refine(
  (value) => !value || value.split(",").every((column) => /^[A-Za-z0-9_.-]{1,64}$/.test(column)),
  "Columns must be a comma-separated list of identifiers",
).optional()

const pageSize = z.number().int().refine(
  (value) => PHARMACY_PROMOTION_PAGE_SIZES.includes(
    value as (typeof PHARMACY_PROMOTION_PAGE_SIZES)[number],
  ),
  `Page size must be one of ${PHARMACY_PROMOTION_PAGE_SIZES.join(", ")}`,
).optional()

/**
 * The API persists the registry's own URL-state contract, rather than an
 * arbitrary JSON blob. This makes a view safe to restore after a deploy and
 * prevents unsupported query keys from being smuggled into the list page.
 */
const PharmacyPromotionSavedFiltersInputSchema = z.object({
  q: optionalText(100),
  departmentId: optionalText(),
  employeeId: optionalText(),
  promotionId: optionalText(),
  promotionType: optionalText(),
  code: optionalText(),
  executionStatus: optionalEnum(PHARMACY_PROMOTION_EXECUTION_STATUSES),
  controlledVisitStatus: optionalEnum(PHARMACY_PROMOTION_VISIT_STATUSES),
  l1Status: optionalEnum(PHARMACY_PROMOTION_REVIEW_STATES),
  l2Status: optionalEnum(PHARMACY_PROMOTION_REVIEW_STATES),
  ready: optionalEnum(PHARMACY_PROMOTION_READINESS),
  dateMode: z.enum(PHARMACY_PROMOTION_DATE_MODES).optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  amountMode: z.enum(PHARMACY_PROMOTION_AMOUNT_MODES).optional(),
  amountMin: optionalDecimal,
  amountMax: optionalDecimal,
  regionId: optionalText(),
  localityId: optionalText(),
  territoryId: optionalText(),
  contactId: optionalText(),
  managerId: optionalText(),
  userGroupId: optionalText(),
  sort: z.enum(PHARMACY_PROMOTION_SORTS).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().positive().max(1_000_000).optional(),
  pageSize,
  columns: columnList,
  density: z.enum(["compact", "comfortable"]).optional(),
  view: z.enum(PHARMACY_PROMOTION_VIEWS).optional(),
}).strict().superRefine((value, context) => {
  if ((value.dateFrom || value.dateTo) && (!value.dateMode || value.dateMode === "NONE")) {
    context.addIssue({ code: "custom", path: ["dateMode"], message: "A date mode is required for a date range" })
  }
  if (
    ((value.amountMin !== undefined && value.amountMin !== "")
      || (value.amountMax !== undefined && value.amountMax !== ""))
    && (!value.amountMode || value.amountMode === "NONE")
  ) {
    context.addIssue({ code: "custom", path: ["amountMode"], message: "An amount mode is required for an amount range" })
  }
})

export const PharmacyPromotionSavedViewCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: PharmacyPromotionSavedFiltersInputSchema,
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
}).strict()

export const PharmacyPromotionSavedViewUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filters: PharmacyPromotionSavedFiltersInputSchema.optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
})

type SavedFiltersInput = z.infer<typeof PharmacyPromotionSavedFiltersInputSchema>

function append(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === "") return
  params.set(key, String(value))
}

export function canonicalPromotionSavedFilters(input: SavedFiltersInput):
  | { ok: true; filters: PharmacyPromotionFilters }
  | { ok: false; field: string; code: string } {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) append(params, key, value)

  // A saved view restores a result set, not a transient pagination cursor.
  // The page size remains user-controlled, while every restore starts at 1.
  params.set("page", "1")
  const filters = pharmacyPromotionFiltersFromSearchParams(params)
  const validation = pharmacyPromotionFilterValidationError(filters)
  if (validation) return { ok: false, ...validation }
  return { ok: true, filters }
}

export function canonicalStoredPromotionSavedFilters(value: unknown) {
  const parsed = PharmacyPromotionSavedFiltersInputSchema.safeParse(value)
  if (!parsed.success) return null
  const canonical = canonicalPromotionSavedFilters(parsed.data)
  return canonical.ok ? canonical.filters : null
}

export function savedFiltersJson(filters: PharmacyPromotionFilters): Prisma.InputJsonValue {
  return filters as unknown as Prisma.InputJsonValue
}

export const pharmacyPromotionSavedViewSelect = {
  id: true,
  organizationId: true,
  userId: true,
  name: true,
  filters: true,
  isDefault: true,
  isShared: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SavedViewSelect

type SavedViewProjection = Prisma.SavedViewGetPayload<{
  select: typeof pharmacyPromotionSavedViewSelect
}>

export function publicPromotionSavedView(view: SavedViewProjection) {
  return {
    id: view.id,
    name: view.name,
    filters: view.filters,
    isDefault: view.isDefault,
    sortOrder: view.sortOrder,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }
}
