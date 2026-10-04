/**
 * What a field agent may and may not do — every function in one list.
 *
 * Before this file the answer lived in four tenant switches hidden among the
 * general MTM settings, two checkboxes on the employee card and some two
 * hundred inline `actor.role === "AGENT"` checks. An owner asked by a client
 * "can my agents do X?" had nowhere to look, and the matrix on
 * /settings/roles he did look at is not read by any permission check.
 *
 * The rule that keeps this list from becoming a second decorative matrix:
 *   - a `switch` row is nothing but a tenant MTM setting that the API already
 *     reads at the place it refuses the agent. The matrix shows and edits that
 *     setting; it stores nothing of its own;
 *   - an `always` / `never` row states what the server does today and cannot be
 *     changed here. `agent-permission-facts.test.ts` pins each one to the guard
 *     in the route it describes, so the row cannot outlive the behaviour;
 *   - a `perAgent` row is decided on each employee card and only counted here.
 *
 * Pure data and pure functions: this file is imported by the settings page in
 * the browser as well as by the API.
 */

export const AGENT_PERMISSION_GROUPS = ["workday", "routes", "visits", "clients", "tasks", "team"] as const
export type AgentPermissionGroup = typeof AGENT_PERMISSION_GROUPS[number]

/** Where the agent meets the function. Stated only for rows a tenant can switch. */
export type AgentPermissionSurface = "app" | "web"

/** Tenant MTM settings that are agent permissions. All are booleans. */
export const AGENT_PERMISSION_SETTING_KEYS = [
  "routeSelfPublish",
  "teamScheduleVisibilityEnabled",
  "taskSelfCreate",
  "taskSelfRecurring",
  "agentContactCreateRequests",
  "agentContactChangeRequests",
  "agentCustomerCreateRequests",
] as const
export type AgentPermissionSettingKey = typeof AGENT_PERMISSION_SETTING_KEYS[number]
export type AgentPermissionSettings = Record<AgentPermissionSettingKey, boolean>

/**
 * The switches this matrix introduced. Only an administrator changes them —
 * the four older ones keep the rule they always had (the settings page lets a
 * CRM manager change them too).
 */
export const AGENT_PERMISSION_ADMIN_ONLY_KEYS = [
  "agentContactCreateRequests",
  "agentContactChangeRequests",
  "agentCustomerCreateRequests",
] as const satisfies readonly AgentPermissionSettingKey[]

/** A grant that lives on the employee card (`MtmAgent`). */
export type AgentCardFlag = "canPlanOwnRoutes" | "canSelfPublishRoutes"

type RowBase = { id: string; group: AgentPermissionGroup }
export type AgentPermissionRow = RowBase & (
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "perAgent"; cardFlag: AgentCardFlag }
  | {
    kind: "switch"
    setting: AgentPermissionSettingKey
    surfaces: readonly AgentPermissionSurface[]
    /** Another switch that must be on for this one to mean anything. */
    requires?: AgentPermissionSettingKey
    /** The agent additionally needs this grant on their own card. */
    cardFlag?: AgentCardFlag
  }
)

export const AGENT_PERMISSION_ROWS = [
  // --- Working day and location
  { id: "workdayOwn", group: "workday", kind: "always" },
  { id: "locationShare", group: "workday", kind: "always" },
  { id: "locationHistoryOwn", group: "workday", kind: "always" },
  { id: "locationTeam", group: "workday", kind: "never" },

  // --- Routes
  { id: "routeViewOwn", group: "routes", kind: "always" },
  { id: "routePlanOwn", group: "routes", kind: "perAgent", cardFlag: "canPlanOwnRoutes" },
  {
    id: "routeSelfPublish", group: "routes", kind: "switch", setting: "routeSelfPublish",
    surfaces: ["app", "web"], cardFlag: "canSelfPublishRoutes",
  },
  { id: "routeChangeRequest", group: "routes", kind: "always" },
  { id: "routeManageOthers", group: "routes", kind: "never" },
  {
    id: "teamSchedule", group: "routes", kind: "switch", setting: "teamScheduleVisibilityEnabled",
    surfaces: ["app", "web"],
  },

  // --- Visits
  { id: "visitExecute", group: "visits", kind: "always" },
  { id: "visitPhotos", group: "visits", kind: "always" },
  { id: "presentations", group: "visits", kind: "always" },
  { id: "brandPotential", group: "visits", kind: "always" },
  { id: "doctorAssessment", group: "visits", kind: "never" },
  { id: "photoReview", group: "visits", kind: "never" },

  // --- Clients and organizations
  { id: "clientsViewOwn", group: "clients", kind: "always" },
  { id: "clientsViewOthers", group: "clients", kind: "never" },
  {
    id: "contactCreateRequest", group: "clients", kind: "switch", setting: "agentContactCreateRequests",
    surfaces: ["app"],
  },
  {
    id: "contactChangeRequest", group: "clients", kind: "switch", setting: "agentContactChangeRequests",
    surfaces: ["web"],
  },
  {
    id: "customerCreateRequest", group: "clients", kind: "switch", setting: "agentCustomerCreateRequests",
    surfaces: ["web"],
  },
  { id: "masterDataEdit", group: "clients", kind: "never" },
  { id: "clientTransfer", group: "clients", kind: "never" },

  // --- Tasks
  { id: "taskExecute", group: "tasks", kind: "always" },
  { id: "taskSelfCreate", group: "tasks", kind: "switch", setting: "taskSelfCreate", surfaces: ["app", "web"] },
  {
    id: "taskSelfRecurring", group: "tasks", kind: "switch", setting: "taskSelfRecurring",
    surfaces: ["app", "web"], requires: "taskSelfCreate",
  },
  { id: "taskManageOthers", group: "tasks", kind: "never" },

  // --- Team, results, approvals
  { id: "kpiOwn", group: "team", kind: "always" },
  { id: "kpiTeam", group: "team", kind: "never" },
  { id: "messagesRead", group: "team", kind: "always" },
  { id: "messagesWrite", group: "team", kind: "never" },
  { id: "requestsDecide", group: "team", kind: "never" },
] as const satisfies readonly AgentPermissionRow[]

export type AgentPermissionId = typeof AGENT_PERMISSION_ROWS[number]["id"]
export type AgentSwitchRow = Extract<typeof AGENT_PERMISSION_ROWS[number], { kind: "switch" }>
export type AgentSwitchId = AgentSwitchRow["id"]

export const AGENT_SWITCH_ROWS: readonly AgentSwitchRow[] = AGENT_PERMISSION_ROWS.filter(
  (row): row is AgentSwitchRow => row.kind === "switch",
)

/** The 403 an agent gets for a function the organization switched off. */
export const MTM_AGENT_PERMISSION_DISABLED = "MTM_AGENT_PERMISSION_DISABLED"

function switchRow(id: AgentSwitchId): AgentSwitchRow {
  const row = AGENT_SWITCH_ROWS.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`Unknown agent permission: ${id}`)
  return row
}

/**
 * Whether the organization lets its agents use this function. A switch that
 * depends on another is off while the other is — "recurring own tasks" means
 * nothing once "own tasks" is off, and the API refuses both.
 */
export function agentPermissionEnabled(settings: Partial<AgentPermissionSettings>, id: AgentSwitchId): boolean {
  const row = switchRow(id)
  if (settings[row.setting] !== true) return false
  return !("requires" in row) || settings[row.requires] === true
}

/** Every switch at once — what the field app receives in its bootstrap. */
export function agentPermissionStates(settings: Partial<AgentPermissionSettings>): Record<AgentSwitchId, boolean> {
  return Object.fromEntries(
    AGENT_SWITCH_ROWS.map((row) => [row.id, agentPermissionEnabled(settings, row.id)]),
  ) as Record<AgentSwitchId, boolean>
}

/** The body of the refusal; the route adds the 403. */
export function agentPermissionDeniedBody(id: AgentSwitchId) {
  return {
    error: "The organization has switched this function off for field agents",
    code: MTM_AGENT_PERMISSION_DISABLED,
    permission: id,
  }
}

/** Active agent cards that hold a per-agent grant: "3 of 5 agents". */
export function agentCardFlagCount(
  cards: readonly { role: string; status: string; canPlanOwnRoutes?: boolean | null; canSelfPublishRoutes?: boolean | null }[],
  flag: AgentCardFlag,
): { granted: number; total: number } {
  const agents = cards.filter((card) => card.role === "AGENT" && card.status === "ACTIVE")
  const granted = agents.filter((card) => (
    // Planning is on unless taken away; self-publishing is off unless given.
    flag === "canPlanOwnRoutes" ? card.canPlanOwnRoutes !== false : card.canSelfPublishRoutes === true
  )).length
  return { granted, total: agents.length }
}
