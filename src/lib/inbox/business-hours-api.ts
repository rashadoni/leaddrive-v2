import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  BUSINESS_HOURS_CHANNEL_TYPES,
  buildBusinessHoursReplyFlowGraph,
  isValidTimeZone,
} from "@/lib/inbox/business-hours";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);
const intervalSchema = z
  .object({
    start: timeSchema,
    end: timeSchema,
  })
  .strict()
  .refine((interval) => interval.start < interval.end, {
    message: "interval end must be after start",
  });

const daySchema = z
  .object({
    enabled: z.boolean(),
    intervals: z.array(intervalSchema).max(8),
  })
  .strict();

const scheduleSchema = z
  .object({
    mon: daySchema.optional(),
    tue: daySchema.optional(),
    wed: daySchema.optional(),
    thu: daySchema.optional(),
    fri: daySchema.optional(),
    sat: daySchema.optional(),
    sun: daySchema.optional(),
  })
  .strict();

const holidaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().max(120).optional(),
    closed: z.boolean().optional(),
    intervals: z.array(intervalSchema).max(8).optional(),
  })
  .strict();

const channelSchema = z.enum(BUSINESS_HOURS_CHANNEL_TYPES);

const DEFAULT_API_SCHEDULE: z.input<typeof scheduleSchema> = {
  mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  tue: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  wed: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  thu: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  fri: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  sat: { enabled: false, intervals: [] },
  sun: { enabled: false, intervals: [] },
};

export const businessHoursUpsertSchema = z
  .object({
    channelType: channelSchema.default("all"),
    timezone: z.string().trim().min(1).max(100).default("UTC").refine(isValidTimeZone, {
      message: "invalid timezone",
    }),
    schedule: scheduleSchema.default(DEFAULT_API_SCHEDULE),
    holidays: z.array(holidaySchema).max(120).default([]),
    isActive: z.boolean().default(true),
    welcomeMessage: z.string().trim().max(2000).nullable().optional(),
    awayMessage: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export type BusinessHoursUpsert = z.output<typeof businessHoursUpsertSchema>;

function cleanNullableText(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

export function serializeBusinessHours(row: {
  id: string;
  organizationId: string;
  channelType: string;
  timezone: string;
  schedule: unknown;
  holidays: unknown;
  isActive: boolean;
  welcomeMessage: string | null;
  awayMessage: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    templateGraph: buildBusinessHoursReplyFlowGraph({
      welcomeText: row.welcomeMessage,
      awayText: row.awayMessage,
    }),
  };
}

export async function upsertBusinessHours(params: {
  organizationId: string;
  userId: string | null;
  input: BusinessHoursUpsert;
}) {
  const { organizationId, userId, input } = params;
  const data = {
    timezone: input.timezone,
    schedule: input.schedule as Prisma.InputJsonValue,
    holidays: input.holidays as Prisma.InputJsonValue,
    isActive: input.isActive,
    welcomeMessage: cleanNullableText(input.welcomeMessage),
    awayMessage: cleanNullableText(input.awayMessage),
  };

  return prisma.businessHours.upsert({
    where: {
      organizationId_channelType: {
        organizationId,
        channelType: input.channelType,
      },
    },
    update: data,
    create: {
      organizationId,
      channelType: input.channelType,
      createdBy: userId,
      ...data,
    },
  });
}
