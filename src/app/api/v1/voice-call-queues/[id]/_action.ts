import type { AuthResult } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import type { NextRequest } from "next/server"
import { z } from "zod"

import {
  privateJson,
  publicQueue,
  resolveQueueOwner,
  voiceQueueErrorResponse,
} from "../_shared"

export type QueueActionContext = { params: Promise<{ id: string }> }

type QueueTransition = (params: {
  db: typeof prisma
  auth: AuthResult
  ownerUserId: string
  queueId: string
}) => Promise<unknown>

const actionSchema = z.object({
  ownerUserId: z.string().trim().min(1).max(200).optional(),
}).strict()

function transitionQueue(value: unknown): unknown {
  if (value && typeof value === "object" && "queue" in value) {
    return (value as { queue: unknown }).queue
  }
  return value
}
export function runQueueAction(transition: QueueTransition) {
  return async (
    request: NextRequest,
    auth: AuthResult,
    { params }: QueueActionContext,
  ): Promise<Response> => {
    const body = await request.json().catch(() => null)
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) {
      return privateJson({ error: "Invalid request" }, { status: 400 })
    }
    const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
    if (!owner.ok) return owner.response
    const { id } = await params

    try {
      const result = await transition({
        db: prisma,
        auth,
        ownerUserId: owner.ownerUserId,
        queueId: id,
      })
      return privateJson({
        success: true,
        data: { queue: publicQueue(transitionQueue(result)) },
      })
    } catch (error) {
      return voiceQueueErrorResponse(error)
    }
  }
}
