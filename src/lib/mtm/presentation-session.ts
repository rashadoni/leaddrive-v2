import { z } from "zod"

const CoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict()

const PageEventSchema = z.object({
  page: z.number().int().positive().max(10_000),
  viewedAt: z.string().datetime({ offset: true }),
}).strict()

export const PresentationSessionOpenSchema = z.object({
  clientSessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  visitId: z.string().trim().min(1).max(128),
  productId: z.string().trim().min(1).max(128),
  openedAt: z.string().datetime({ offset: true }),
  location: CoordinateSchema.nullish(),
  pageCount: z.number().int().positive().max(10_000).nullish(),
}).strict()

export const PresentationSessionProgressSchema = z.object({
  lastViewedAt: z.string().datetime({ offset: true }),
  activeDurationSeconds: z.number().int().nonnegative().max(24 * 60 * 60),
  pageCount: z.number().int().positive().max(10_000).nullish(),
  lastPage: z.number().int().positive().max(10_000).nullish(),
  pagesViewed: z.array(z.number().int().positive().max(10_000)).max(10_000).default([]),
  pageEvents: z.array(PageEventSchema).max(500).default([]),
  closedAt: z.string().datetime({ offset: true }).nullish(),
  closeLocation: CoordinateSchema.nullish(),
}).strict().superRefine((value, context) => {
  const pageCount = value.pageCount ?? null
  if (pageCount && value.lastPage && value.lastPage > pageCount) {
    context.addIssue({ code: "custom", path: ["lastPage"], message: "lastPage exceeds pageCount" })
  }
  if (pageCount && value.pagesViewed.some((page) => page > pageCount)) {
    context.addIssue({ code: "custom", path: ["pagesViewed"], message: "pagesViewed exceeds pageCount" })
  }
})

export function normalizeViewedPages(pages: number[]): number[] {
  return [...new Set(pages)].sort((left, right) => left - right)
}

export function boundedActiveDurationSeconds(input: {
  openedAt: Date
  lastViewedAt: Date
  requestedSeconds: number
}): number {
  const wallSeconds = Math.max(0, Math.floor((input.lastViewedAt.getTime() - input.openedAt.getTime()) / 1000))
  return Math.min(input.requestedSeconds, wallSeconds)
}

export function isPresentationTimePlausible(input: {
  openedAt: Date
  visitCheckInAt: Date
  visitCheckOutAt: Date | null
  now?: Date
}): boolean {
  const now = input.now ?? new Date()
  const fiveMinutes = 5 * 60 * 1000
  const earliest = input.visitCheckInAt.getTime() - fiveMinutes
  const latest = Math.min(
    now.getTime() + fiveMinutes,
    (input.visitCheckOutAt?.getTime() ?? now.getTime()) + fiveMinutes,
  )
  return input.openedAt.getTime() >= earliest && input.openedAt.getTime() <= latest
}
