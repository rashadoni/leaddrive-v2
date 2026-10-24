import { z } from "zod"

export const bookSchema = z.object({
  locale: z.enum(["az", "ru", "en"]).optional(),
  idempotencyKey: z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  recoverySecret: z.string().min(32).max(200).regex(/^[a-zA-Z0-9_-]+$/),
  startsAt: z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Invalid time"),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{7,24}$/, "Invalid phone"),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(1000).optional(),
  // Left empty by people; filled by form-filling bots.
  website: z.string().max(200).optional(),
  // Ad click ids and UTM tags from the page address (src/lib/ad-conversions).
  attribution: z.unknown().optional(),
})
