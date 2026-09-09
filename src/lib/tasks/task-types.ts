import { prisma } from "@/lib/prisma"
import { DEFAULT_TASK_TYPES, DEFAULT_EVENT_TYPES } from "@/lib/constants"
import { isValidConfigType } from "./config-type"

const LEGACY_TASK = new Set<string>(DEFAULT_TASK_TYPES.map((t) => t.name))
const LEGACY_EVENT = new Set<string>(DEFAULT_EVENT_TYPES.map((t) => t.name))

/**
 * Dynamic validation for Task.type (configurable task-type axis). See
 * isValidConfigType for the active-OR-inactive / legacy-fallback semantics.
 */
export function isValidTaskType(orgId: string, type?: string | null): Promise<boolean> {
  return isValidConfigType(
    () => prisma.taskType.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    LEGACY_TASK,
    type,
  )
}

/** Dynamic validation for Task.eventType (configurable channel/source axis). */
export function isValidEventType(orgId: string, eventType?: string | null): Promise<boolean> {
  return isValidConfigType(
    () => prisma.eventType.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    LEGACY_EVENT,
    eventType,
  )
}
