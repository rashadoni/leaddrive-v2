/**
 * The booking-page form as the settings API accepts it. One schema for create
 * and update, so a page can never be saved in a shape the public page cannot
 * compute free time from.
 */
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { parseWeeklyHours } from "./availability"

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
  weekly: z.unknown().transform((value, ctx) => {
    const parsed = parseWeeklyHours(value)
    if (!parsed) ctx.addIssue({ code: "custom", message: "INVALID_HOURS" })
    return parsed ?? z.NEVER
  }),
  isActive: z.boolean(),
}).strict()

export type BookingPageInput = z.infer<typeof bookingPageSchema>

/** Slugs are unique across organizations (the URL names no tenant). */
export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const row = await runWithRlsBypass(() => prisma.bookingPage.findUnique({ where: { slug }, select: { id: true } }))
  return Boolean(row && row.id !== exceptId)
}
