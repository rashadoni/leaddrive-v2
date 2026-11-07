/**
 * The booking-page form as the settings API accepts it. One schema for create
 * and update, so a page can never be saved in a shape the public page cannot
 * compute free time from.
 */
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { bookingDb as prisma } from "./db"
import { runWithRlsBypass } from "@/lib/rls-context"
import { parseWeeklyHours } from "./availability"
import { normalizeAddOns } from "./add-ons"
import { bookingPhotoPath } from "./service-photo"
import { normalizeHostVariants } from "./host-variants"
import { resolveOrgDefaultCurrency } from "@/lib/org-default-currency"

export const bookingPageSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/, "INVALID_SLUG"),
  description: z.string().trim().max(2000).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480),
  bufferMinutes: z.number().int().min(0).max(240),
  minNoticeMinutes: z.number().int().min(0).max(20160),
  maxDaysAhead: z.number().int().min(1).max(120),
  locationType: z.enum(["office", "phone", "online"]),
  locationText: z.string().trim().max(300).optional().nullable(),
  hostIds: z.array(z.string().min(1).max(64)).min(1, "HOSTS_REQUIRED").max(20),
  /**
   * What single masters charge and how long they take, when they differ from
   * the service. Shape only here: which masters count and what counts as a
   * difference is `normalizeHostVariants`, so the rule lives in one place.
   */
  hostVariants: z.record(z.string().min(1).max(64), z.object({
    price: z.union([z.string().max(20), z.number()]).nullable().optional(),
    durationMinutes: z.number().int().nullable().optional(),
  })).nullable().optional(),
  /** A path under /uploads/booking-photos; `bookingPhotoPath` is the rule. */
  photoUrl: z.string().max(300).nullable().optional(),
  /** Extras the customer may add; shape only — `normalizeAddOns` is the rule. */
  addOns: z.array(z.object({
    id: z.string().min(1).max(40),
    name: z.string().max(60),
    price: z.union([z.string().max(20), z.number()]).nullable().optional(),
    durationMinutes: z.number().int().optional(),
  })).max(12).nullable().optional(),
  /** What the service costs. The currency is not the form's business — the route stamps the organisation's own. */
  price: z.number().min(0).max(1_000_000_000).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  /** Days until the client is usually back for this service; null = no cycle. */
  repeatCycleDays: z.number().int().min(1).max(365).nullable().optional(),
  weekly: z.unknown().transform((value, ctx) => {
    const parsed = parseWeeklyHours(value)
    if (!parsed) ctx.addIssue({ code: "custom", message: "INVALID_HOURS" })
    return parsed ?? z.NEVER
  }),
  isActive: z.boolean(),
}).strict()

export type BookingPageInput = z.infer<typeof bookingPageSchema>

/**
 * The money part of a page as the database takes it: the amount plus the
 * organisation's own currency code, stamped at save time so no screen has to
 * guess which currency a number is in. No price, no code.
 */
export async function pagePriceData(orgId: string, price: number | null | undefined): Promise<{ price: number | null; priceCurrency: string | null }> {
  if (price === null || price === undefined) return { price: null, priceCurrency: null }
  return { price, priceCurrency: await resolveOrgDefaultCurrency(orgId) }
}

/**
 * The per-master differences as the column should hold them: only masters who
 * still take this service, and only where they really differ from it. A
 * service where everybody agrees stores SQL NULL, so «no differences» looks
 * the same as it did before this column existed.
 */
export function pageHostVariantsData(input: BookingPageInput): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const variants = normalizeHostVariants(input.hostVariants, input.hostIds, {
    price: input.price === null || input.price === undefined ? null : String(input.price),
    durationMinutes: input.durationMinutes,
  })
  return Object.keys(variants).length > 0 ? (variants as Prisma.InputJsonValue) : Prisma.DbNull
}

/** The picture, or none: never an address this CRM did not write itself. */
export function pagePhotoData(input: BookingPageInput): string | null {
  return bookingPhotoPath(input.photoUrl)
}

/** The extras as the column should hold them; nothing to add means SQL NULL. */
export function pageAddOnsData(input: BookingPageInput): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const addOns = normalizeAddOns(input.addOns)
  return addOns.length > 0 ? (addOns as unknown as Prisma.InputJsonValue) : Prisma.DbNull
}

/** Slugs are unique across organizations (the URL names no tenant). */
export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const row = await runWithRlsBypass(() => prisma.bookingPage.findUnique({ where: { slug }, select: { id: true } }))
  return Boolean(row && row.id !== exceptId)
}
