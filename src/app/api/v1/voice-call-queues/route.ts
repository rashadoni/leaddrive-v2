import { prisma } from "@/lib/prisma"
import {
  createSelectedVoiceQueue,
  listVoiceQueues,
  VOICE_QUEUE_MAX_SELECTED_LEADS,
} from "@/lib/voice-agent/queue-service"
import { NextRequest } from "next/server"
import { z } from "zod"

import {
  privateJson,
  publicQueue,
  publicQueueItem,
  resolveQueueOwner,
  voiceQueueErrorResponse,
  withVoiceQueueMutationAuth,
  withVoiceQueueReadAuth,
} from "./_shared"

export const dynamic = "force-dynamic"

const createSchema = z.object({
  leadIds: z.array(z.string().trim().min(1).max(200))
    .min(1)
    .max(VOICE_QUEUE_MAX_SELECTED_LEADS)
    .refine((values) => new Set(values).size === values.length, "Duplicate lead IDs are not allowed"),
  ownerUserId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().uuid(),
  consentConfirmed: z.literal(true),
  name: z.string().trim().min(1).max(120).optional(),
}).strict()

const listQuerySchema = z.object({
  ownerUserId: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

function listQuery(request: NextRequest) {
  const url = new URL(request.url)
  return listQuerySchema.safeParse({
    ownerUserId: url.searchParams.get("ownerUserId") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  })
}

export const GET = withVoiceQueueReadAuth(async (request, auth) => {
  const parsed = listQuery(request)
  if (!parsed.success) {
    return privateJson({ error: "Invalid request" }, { status: 400 })
  }
  const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
  if (!owner.ok) return owner.response

  try {
    const result = await listVoiceQueues({
      db: prisma,
      auth,
      ownerUserId: owner.ownerUserId,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    })
    return privateJson({
      success: true,
      data: {
        queues: result.queues.flatMap((queue) => publicQueue(queue) ?? []),
        nextCursor: result.nextCursor,
      },
    })
  } catch (error) {
    return voiceQueueErrorResponse(error)
  }
})

export const POST = withVoiceQueueMutationAuth(async (request, auth) => {
  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    const consentMissing = body && typeof body === "object"
      && (body as { consentConfirmed?: unknown }).consentConfirmed !== true
    return privateJson(
      {
        error: "Invalid request",
        code: consentMissing ? "consent_required" : "invalid_selection",
      },
      { status: 400 },
    )
  }

  const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
  if (!owner.ok) return owner.response

  try {
    const result = await createSelectedVoiceQueue({
      db: prisma,
      auth,
      ownerUserId: owner.ownerUserId,
      leadIds: parsed.data.leadIds,
      idempotencyKey: parsed.data.idempotencyKey,
      consentConfirmed: parsed.data.consentConfirmed,
      name: parsed.data.name,
    })
    return privateJson({
      success: true,
      data: {
        queue: publicQueue(result.queue),
        items: (result.queue.items ?? []).flatMap((item) => publicQueueItem(item) ?? []),
        replayed: result.replayed,
      },
    }, { status: result.replayed ? 200 : 201 })
  } catch (error) {
    return voiceQueueErrorResponse(error)
  }
})
