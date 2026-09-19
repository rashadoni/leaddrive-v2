import type { Role } from "@/lib/permissions"

export type CrmCommandSource = "rest" | "voice"

/**
 * Trusted command identity. Adapters build this from authenticated server
 * state; none of these values may be accepted from model or request payloads.
 */
export interface CrmCommandActorContext {
  organizationId: string
  userId: string | null
  role: Role
  source: CrmCommandSource
  requestId?: string
  voiceSessionId?: string
  actionIntentId?: string
  providerToolCallId?: string
}

export function createRestActorContext(input: {
  organizationId: string
  userId?: string | null
  role?: Role | null
  requestId?: string | null
}): CrmCommandActorContext {
  if (!input.organizationId.trim()) throw new TypeError("organizationId is required")
  return {
    organizationId: input.organizationId,
    userId: input.userId?.trim() || null,
    role: input.role ?? "admin",
    source: "rest",
    ...(input.requestId?.trim() ? { requestId: input.requestId.trim() } : {}),
  }
}
