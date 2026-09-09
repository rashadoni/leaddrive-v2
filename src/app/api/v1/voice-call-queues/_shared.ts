import type { AuthResult } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { checkPermission } from "@/lib/permissions"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import {
  VoiceQueueError,
  voiceQueueErrorStatus,
} from "@/lib/voice-agent/queue-service"
import { withRlsAuth } from "@/lib/with-rls"
import { NextRequest, NextResponse } from "next/server"

export type VoiceQueueRouteContext = {
  params: Promise<Record<string, string>>
}

type QueueRouteHandler<C> = (
  request: NextRequest,
  auth: AuthResult,
  context: C,
) => Promise<Response> | Response

export type QueueOwnerResolution =
  | { ok: true; ownerUserId: string }
  | { ok: false; response: NextResponse }

function pilotOrganizationEnabled(organizationId: string): boolean {
  const configured = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()
  return Boolean(configured && configured === organizationId)
}

export function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init)
  response.headers.set("Cache-Control", "private, no-store")
  return response
}

export function queueNotFound(): NextResponse {
  return privateJson({ error: "Not found", code: "queue_not_found" }, { status: 404 })
}

export function voiceQueueErrorResponse(error: unknown): NextResponse {
  if (error instanceof VoiceQueueError) {
    return privateJson(
      {
        success: false,
        code: error.code,
        blockers: [error.code],
      },
      { status: voiceQueueErrorStatus(error.code) },
    )
  }

  console.error("[voice-call-queues] route error:", error)
  return privateJson({ error: "Internal server error" }, { status: 500 })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function pickFields(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  return Object.fromEntries(fields.flatMap((field) => (
    Object.prototype.hasOwnProperty.call(value, field) ? [[field, value[field]]] : []
  )))
}

const PUBLIC_QUEUE_FIELDS = [
  "id",
  "ownerUserId",
  "createdByUserId",
  "source",
  "name",
  "status",
  "totalItems",
  "counts",
  "pendingCount",
  "queuedCount",
  "activeCount",
  "finishedCount",
  "completedCount",
  "skippedCount",
  "failedCount",
  "startedAt",
  "pausedAt",
  "completedAt",
  "cancelledAt",
  "createdAt",
  "updatedAt",
] as const

const PUBLIC_ITEM_FIELDS = [
  "id",
  "leadId",
  "leadLabel",
  "position",
  "status",
  "outcome",
  "blockReason",
  "availableAt",
  "claimedAt",
  "startedAt",
  "endedAt",
  "createdAt",
  "updatedAt",
] as const

/**
 * Queue persistence deliberately contains consent evidence, policy snapshots,
 * normalized phone data on related sessions, and provider correlation. Public
 * CRM routes expose only the operational projection below.
 */
export function publicQueue(value: unknown): Record<string, unknown> | null {
  const queue = pickFields(value, PUBLIC_QUEUE_FIELDS)
  if (!queue || !isRecord(queue.counts)) return queue

  const count = (status: string): number => {
    const value = (queue.counts as Record<string, unknown>)[status]
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
  }
  const pendingCount = count("pending")
  const activeCount = ["claimed", "dispatching", "waiting_terminal", "dispatch_uncertain"]
    .reduce((total, status) => total + count(status), 0)
  const finishedCount = ["completed", "no_answer", "busy", "failed", "cancelled", "blocked", "skipped"]
    .reduce((total, status) => total + count(status), 0)
  return { ...queue, pendingCount, activeCount, finishedCount }
}

export function publicQueueItem(value: unknown): Record<string, unknown> | null {
  const item = pickFields(value, PUBLIC_ITEM_FIELDS)
  if (!item) return null
  // Persistence uses zero-based positions for compact array snapshots. The
  // public contract is one-based because it is rendered as a call order.
  if (typeof item.position === "number" && Number.isInteger(item.position)) {
    item.position = item.position + 1
  }
  return item
}

export function resolveQueueOwner(
  auth: Pick<AuthResult, "role" | "userId">,
  requestedOwnerUserId: string | null | undefined,
): QueueOwnerResolution {
  const normalizedOwner = requestedOwnerUserId?.trim() || null

  if (isManagerOrAbove(auth.role)) {
    if (!normalizedOwner) {
      return {
        ok: false,
        response: privateJson(
          { error: "Owner scope is required", code: "owner_scope_required" },
          { status: 400 },
        ),
      }
    }
    return { ok: true, ownerUserId: normalizedOwner }
  }

  // Seller workflow is server-pinned to the authenticated seller. Returning a
  // 404 for a different owner avoids confirming whether that user exists.
  if (normalizedOwner && normalizedOwner !== auth.userId) {
    return { ok: false, response: queueNotFound() }
  }

  return { ok: true, ownerUserId: auth.userId }
}

function withVoiceQueueAuth<C>(
  access: "read" | "write",
  handler: QueueRouteHandler<C>,
) {
  const authenticated = withRlsAuth<C>(
    "voip",
    access,
    async (request, auth, context) => {
      if (!checkPermission(auth.role, "leads", access)) {
        return privateJson({ error: "Forbidden" }, { status: 403 })
      }
      if (!pilotOrganizationEnabled(auth.orgId)) return queueNotFound()
      return handler(request, auth, context)
    },
  )

  return async (request: NextRequest, context?: C): Promise<Response> => {
    // Queues are human-controlled CRM operations. API keys must not be able to
    // create or advance a calling workflow, even when they hold VoIP scopes.
    if (request.headers.has("authorization")) {
      return privateJson(
        { error: "Session authentication required" },
        { status: 403 },
      )
    }
    if (access === "write") {
      const rejection = guardInteractiveJsonMutation(request)
      if (rejection) return rejection
    }
    return authenticated(request, context as C)
  }
}

export function withVoiceQueueReadAuth<C = unknown>(handler: QueueRouteHandler<C>) {
  return withVoiceQueueAuth("read", handler)
}

export function withVoiceQueueMutationAuth<C = unknown>(handler: QueueRouteHandler<C>) {
  return withVoiceQueueAuth("write", handler)
}
