import { z } from "zod"

/**
 * Что голос кладёт в квитанцию тикета (этап 4, 2026-11-09). Чистые схемы:
 * реестр голоса попадает и в браузерный бандл, поэтому команды тикетов (с
 * WhatsApp, почтой и Prisma) отсюда не импортируются.
 */
export const VOICE_TICKET_STATUSES = ["new", "open", "in_progress", "waiting", "resolved", "closed", "escalated"] as const
const priority = z.enum(["low", "medium", "high", "critical"])

export const voiceTicketSchemas = {
  create: z.strictObject({
    subject: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).optional(),
    priority: priority.optional(),
    contactId: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
    assignedTo: z.string().min(1).optional(),
  }),
  comment: z.strictObject({
    comment: z.string().trim().min(1).max(5000),
  }),
  update: z.strictObject({
    status: z.enum(VOICE_TICKET_STATUSES).optional(),
    priority: priority.optional(),
    assignedTo: z.string().min(1).optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  }),
} as const
