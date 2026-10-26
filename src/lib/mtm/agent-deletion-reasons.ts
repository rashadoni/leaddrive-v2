/** Public labels only: never render database identifiers or an error's text. */
const groups: Record<string, string> = {
  MtmVisit: "visits", MtmVisitParticipant: "visits", MtmVisitActionResult: "visits",
  MtmRoute: "routes", MtmRouteAssignment: "routes", MtmRouteChangeRequest: "routes",
  MtmTask: "tasks", MtmTaskEvent: "tasks",
  MtmAgentWorkday: "time", MtmAgentWorkdayEvent: "time", MtmAgentLocation: "location",
  MtmHrmRequest: "hr", MtmAgent: "team",
  MtmMessage: "messages", MtmMessageThread: "messages",
  MtmPhoto: "files", MtmMediaObject: "files", MtmDocument: "files",
  IdentityActorBinding: "identity",
}

export function agentDeletionReasons(code: string | undefined, kinds: unknown): string[] {
  if (code === "WORKFORCE_RETENTION_BLOCKED") return ["time"]
  if (code === "MTM_AGENT_DELETE_DEPENDENCY") return ["dependency"]
  if (!Array.isArray(kinds) || kinds.length === 0) return ["other"]
  return [...new Set(kinds.slice(0, 200).map(kind => {
    if (typeof kind !== "string" || !/^[A-Za-z]+\.[A-Za-z]+$/.test(kind)) return "other"
    const model = kind.split(".")[0]
    return groups[model] ?? (model.startsWith("Workforce") || model.startsWith("MtmAttendance") ? "time" : "other")
  }))]
}
