import { Prisma } from "@prisma/client"

/**
 * May an employee be deleted for good?
 *
 * Owner, 2026-10-06: «Удалять без истории» — an employee created by mistake or
 * for a trial, with no visit, no route and no hour worked, can be deleted; one
 * with work history cannot, and is deactivated instead.
 *
 * «History» is every row, in every table, that points at the employee — read
 * from the schema itself, so a table added tomorrow counts as history without
 * anyone remembering this file. The exceptions are named below: what merely
 * setting an employee up creates, and what the database removes or detaches
 * with them without losing a fact about the work.
 */
const SETUP_NOT_HISTORY = new Set([
  // Written by a trigger when the employee is created; leaves with them.
  "WorkforceEmployeeTeamMembership.agentId",
  // Which clients and organizations they are attached to: an arrangement.
  "MtmContactAgentAssignment.agentId",
  "MtmCustomerAgentAssignment.agentId",
  "MtmCustomer.managingManagerId",
  "MtmProductGroupMember.agentId",
  "MtmDocumentAssignment.agentId",
  // Their device and what was sent TO them.
  "MtmOnboarding.agentId",
  "MtmDeviceToken.agentId",
  "MtmNotification.agentId",
  "MtmRouteNotificationOutbox.agentId",
  "MtmMessageParticipant.agentId",
  "MtmMessageReceipt.agentId",
  "WorkforceAttendanceDeviceEnrollment.agentId",
  "WorkforceAttendanceDeviceAttestationChallenge.agentId",
  // Derived from MtmAgentLocation, which does count.
  "MtmAgentLatestLocation.agentId",
  // Only some audit kinds and calendar sources are retained; the delete
  // handler counts exactly those.
  "MtmAuditLog.agentId",
  "MtmWorkCalendarDay.agentId",
])

export type AgentHistoryRelation = { model: string; field: string }

/** Every place in the schema where a row points at an employee and that row is work history. */
export function agentHistoryRelations(): AgentHistoryRelation[] {
  const relations: AgentHistoryRelation[] = []
  for (const model of Prisma.dmmf?.datamodel?.models ?? []) {
    for (const field of model.fields) {
      if (field.type !== "MtmAgent" || !field.relationFromFields?.length) continue
      // Composite keys carry the tenant column beside the employee's.
      const column = field.relationFromFields.find((name) => name !== "organizationId")
      if (!column || SETUP_NOT_HISTORY.has(`${model.name}.${column}`)) continue
      relations.push({ model: model.name, field: column })
    }
  }
  // Visits and routes go with their employee by CASCADE: if the schema could
  // not be read here, «no history found» would delete them. Refuse instead.
  if (!relations.some((relation) => relation.model === "MtmVisit" && relation.field === "agentId")) {
    throw new Error("The schema's relations to an employee are unavailable; refusing to judge their work history")
  }
  return relations
}

type CountDelegate = { count?: (args: { where: Record<string, string> }) => Promise<number> }

/**
 * Which kinds of history the employee has: `["MtmVisit.agentId", …]`, empty
 * when there is none. A table the client does not know is skipped, not
 * assumed empty — the database's own RESTRICT keys still stand behind this.
 */
export async function agentHistory(
  db: unknown,
  organizationId: string,
  agentId: string,
): Promise<string[]> {
  const found = await Promise.all(agentHistoryRelations().map(async ({ model, field }) => {
    const delegate = (db as Record<string, CountDelegate | undefined>)[model[0].toLowerCase() + model.slice(1)]
    if (typeof delegate?.count !== "function") return null
    const count = await delegate.count({ where: { organizationId, [field]: agentId } })
    return Number(count) > 0 ? `${model}.${field}` : null
  }))
  return found.filter((kind): kind is string => kind !== null)
}
