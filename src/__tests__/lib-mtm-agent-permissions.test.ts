import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  AGENT_PERMISSION_ADMIN_ONLY_KEYS,
  AGENT_PERMISSION_GROUPS,
  AGENT_PERMISSION_ROWS,
  AGENT_PERMISSION_SETTING_KEYS,
  AGENT_SWITCH_ROWS,
  agentCardFlagCount,
  agentPermissionDeniedBody,
  agentPermissionEnabled,
  agentPermissionStates,
  type AgentPermissionId,
} from "@/lib/mtm/agent-permissions"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { mobileCapabilities } from "@/lib/mtm/mobile-capabilities"
import {
  canCreateMtmRouteFor,
  canEditMtmRoute,
  canReviewMtmRouteRequest,
  canViewMtmRoute,
  type MtmRouteActor,
} from "@/lib/mtm/route-permissions"
import { canMutateMtmVisit } from "@/lib/mtm/visit-scope"

/**
 * The matrix "what an agent may do" is only worth having while it is true.
 * /settings/roles shows a matrix no permission check reads; this one must not
 * become its twin. So: a switch row is a real tenant setting, and every row a
 * tenant cannot switch is pinned below to the rule the server applies.
 */
const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8")

const agent: MtmRouteActor = {
  agentId: "agent-1",
  role: "AGENT",
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: false,
  scopedAgentIds: ["agent-1"],
}

describe("agent permission registry", () => {
  it("names every function once and uses every group", () => {
    const ids = AGENT_PERMISSION_ROWS.map((row) => row.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
    expect([...new Set(AGENT_PERMISSION_ROWS.map((row) => row.group))]).toEqual([...AGENT_PERMISSION_GROUPS])
  })

  it("backs every switch with a boolean MTM setting, and lists no setting without a switch", () => {
    const defaults = MTM_SETTING_DEFAULTS as Record<string, unknown>
    expect(AGENT_SWITCH_ROWS.filter((row) => typeof defaults[row.setting] !== "boolean").map((row) => row.id)).toEqual([])
    expect([...new Set(AGENT_SWITCH_ROWS.map((row) => row.setting))].sort())
      .toEqual([...AGENT_PERMISSION_SETTING_KEYS].sort())
    expect(AGENT_PERMISSION_ADMIN_ONLY_KEYS.filter((key) => !AGENT_PERMISSION_SETTING_KEYS.includes(key))).toEqual([])
  })

  it("changes nothing for an organization that never opened the matrix", () => {
    expect(agentPermissionStates(MTM_SETTING_DEFAULTS)).toEqual({
      teamSchedule: false,
      // The zone stays a hard rule until the organization lifts it.
      checkInOutsideZone: false,
      contactCreateRequest: true,
      contactChangeRequest: true,
      customerCreateRequest: true,
      taskSelfCreate: true,
      taskSelfRecurring: true,
    })
  })

  it("reads a switch from its setting and fails closed on a missing or odd value", () => {
    expect(agentPermissionEnabled({ agentContactCreateRequests: true }, "contactCreateRequest")).toBe(true)
    expect(agentPermissionEnabled({ agentContactCreateRequests: false }, "contactCreateRequest")).toBe(false)
    expect(agentPermissionEnabled({}, "contactCreateRequest")).toBe(false)
    expect(agentPermissionEnabled({ agentContactCreateRequests: "true" as never }, "contactCreateRequest")).toBe(false)
  })

  it("keeps a dependent switch off while the one it needs is off", () => {
    expect(agentPermissionEnabled({ taskSelfCreate: true, taskSelfRecurring: true }, "taskSelfRecurring")).toBe(true)
    expect(agentPermissionEnabled({ taskSelfCreate: false, taskSelfRecurring: true }, "taskSelfRecurring")).toBe(false)
    expect(agentPermissionEnabled({ taskSelfCreate: true, taskSelfRecurring: false }, "taskSelfRecurring")).toBe(false)
  })

  it("names the function in the refusal", () => {
    expect(agentPermissionDeniedBody("customerCreateRequest")).toMatchObject({
      code: "MTM_AGENT_PERMISSION_DISABLED",
      permission: "customerCreateRequest",
    })
  })

  it("counts per-agent grants over active agent cards only", () => {
    const cards = [
      { role: "AGENT", status: "ACTIVE", canPlanOwnRoutes: true, canSelfPublishRoutes: true },
      { role: "AGENT", status: "ACTIVE", canPlanOwnRoutes: null, canSelfPublishRoutes: null },
      { role: "AGENT", status: "ACTIVE", canPlanOwnRoutes: false, canSelfPublishRoutes: false },
      { role: "AGENT", status: "INACTIVE", canPlanOwnRoutes: true, canSelfPublishRoutes: true },
      { role: "MANAGER", status: "ACTIVE", canPlanOwnRoutes: true, canSelfPublishRoutes: true },
    ]
    // Planning is on unless taken away; self-publishing is off unless given.
    expect(agentCardFlagCount(cards, "canPlanOwnRoutes")).toEqual({ granted: 2, total: 3 })
    expect(agentCardFlagCount(cards, "canSelfPublishRoutes")).toEqual({ granted: 1, total: 3 })
  })

  it("has a title and an explanation for every row in the interface", () => {
    const texts = (JSON.parse(source("messages/en.json")) as { mtmAccess: Record<string, string> }).mtmAccess
    const missing = AGENT_PERMISSION_ROWS.flatMap((row) => (
      [`perm_${row.id}`, `perm_${row.id}_hint`].filter((key) => !texts[key])
    ))
    expect(missing).toEqual([])
    expect(AGENT_PERMISSION_GROUPS.filter((group) => !texts[`permGroup_${group}`])).toEqual([])
  })
})

/**
 * Rows a tenant cannot switch. Each names the rule that makes it true: a
 * permission function called as an agent, or the guard in the route itself.
 * A row without an entry fails the last test, so nobody can add a statement to
 * the matrix that nothing enforces.
 */
type Fact = { check?: () => boolean; file?: string; contains?: string }

const FACTS: Partial<Record<AgentPermissionId, Fact[]>> = {
  workdayOwn: [{
    // Only the agent moves their own working day; a manager cannot close it for them.
    file: "src/app/api/v1/mtm/week/workday/route.ts",
    contains: 'if (!actor || actor.role !== "AGENT" || !actor.agentId) {',
  }],
  locationShare: [{ check: () => mobileCapabilities("AGENT").includes("FIELD_TRACK") }],
  locationHistoryOwn: [{
    file: "src/app/api/v1/mtm/mobile/location/route.ts",
    contains: 'const forbidden = requireMobileCapability(auth, "FIELD_TRACK")',
  }],
  locationTeam: [
    { check: () => !mobileCapabilities("AGENT").includes("TEAM_READ") },
    { file: "src/app/api/v1/mtm/locations/route.ts", contains: 'if (!actor || actor.role === "AGENT") {' },
  ],
  routeViewOwn: [{
    check: () => canViewMtmRoute(agent, { primaryAgentId: "agent-1" })
      && !canViewMtmRoute(agent, { primaryAgentId: "agent-2" }),
  }],
  routeChangeRequest: [{
    // Asking a manager to add or drop a stop of a published route: any card
    // may ask about a route it sees; nothing here is switchable.
    file: "src/app/api/v1/mtm/routes/[id]/change-requests/route.ts",
    contains: 'if (!actor?.agentId && actor?.role !== "ADMIN") return forbidden()',
  }],
  routeManageOthers: [{
    check: () => !canCreateMtmRouteFor(agent, "agent-2")
      && !canEditMtmRoute(agent, { primaryAgentId: "agent-2", status: "DRAFT" })
      && !canEditMtmRoute(agent, { primaryAgentId: "agent-1", status: "PLANNED" }),
  }],
  visitExecute: [{ check: () => mobileCapabilities("AGENT").includes("FIELD_EXECUTE") && canMutateMtmVisit(agent, "agent-1") }],
  visitPhotos: [{ check: () => canMutateMtmVisit(agent, "agent-1") && !canMutateMtmVisit(agent, "agent-2") }],
  presentations: [{
    file: "src/app/api/v1/mtm/mobile/presentation-sessions/route.ts",
    contains: 'requireMobileCapability(auth, "FIELD_EXECUTE")',
  }],
  brandPotential: [{
    file: "src/app/api/v1/mtm/contacts/[id]/brand-potentials/route.ts",
    contains: 'canRecord: actor.agentId !== null || actor.role === "ADMIN",',
  }],
  doctorAssessment: [
    { check: () => !canManageFieldMasterData(agent) },
    { file: "src/app/api/v1/mtm/contacts/[id]/assessments/route.ts", contains: "MTM_DOCTOR_ASSESSMENT_READ_ONLY" },
  ],
  photoReview: [{ file: "src/app/api/v1/mtm/photos/[id]/route.ts", contains: "MTM_PHOTO_REVIEW_FORBIDDEN" }],
  clientsViewOwn: [{
    file: "src/lib/mtm/field-scope.ts",
    contains: 'if (actor.role === "AGENT") return actor.agentId ? [actor.agentId] : []',
  }],
  clientsViewOthers: [{
    file: "src/lib/mtm/field-scope.ts",
    contains: 'if (actor.role === "AGENT") return actor.agentId ? [actor.agentId] : []',
  }],
  masterDataEdit: [
    { check: () => !canManageFieldMasterData(agent) },
    { file: "src/app/api/v1/mtm/contacts/[id]/route.ts", contains: "canManageFieldMasterData(actor)" },
    { file: "src/app/api/v1/mtm/customers/[id]/route.ts", contains: "canManageFieldMasterData(actor)" },
  ],
  clientTransfer: [
    { check: () => !canManageFieldMasterData(agent) },
    { file: "src/app/api/v1/mtm/contact-transfers/route.ts", contains: "if (!actor || !canManageFieldMasterData(actor)) {" },
  ],
  taskExecute: [{
    file: "src/app/api/v1/mtm/mobile/tasks/[id]/progress/route.ts",
    contains: 'requireMobileCapability(auth, "FIELD_EXECUTE")',
  }],
  taskManageOthers: [
    { check: () => !mobileCapabilities("AGENT").includes("TEAM_DECIDE") },
    { file: "src/app/api/v1/mtm/mobile/tasks/bulk-reassign/route.ts", contains: 'requireMobileCapability(auth, "TEAM_DECIDE")' },
  ],
  kpiOwn: [{ file: "src/app/api/v1/mtm/mobile/kpi/route.ts", contains: "agentId: auth.agentId" }],
  kpiTeam: [{ file: "src/app/api/v1/mtm/kpi/route.ts", contains: 'if (!actor || actor.role === "AGENT") {' }],
  messagesRead: [{ file: "src/app/api/v1/mtm/mobile/messages/route.ts", contains: "withMobileRls(" }],
  messagesWrite: [{
    file: "src/app/api/v1/mtm/operations/messages/route.ts",
    contains: 'if (!actor || actor.role === "AGENT") return forbidden()',
  }],
  requestsDecide: [
    { check: () => !canReviewMtmRouteRequest(agent, "agent-2") && !canManageFieldMasterData(agent) },
    { file: "src/app/api/v1/mtm/contact-create-requests/[id]/decision/route.ts", contains: "canManageFieldMasterData(actor)" },
    { file: "src/app/api/v1/mtm/contact-change-requests/[id]/decision/route.ts", contains: "canManageFieldMasterData(actor)" },
  ],
}

describe("fixed rows of the matrix state what the server does", () => {
  const fixed = AGENT_PERMISSION_ROWS.filter((row) => row.kind === "always" || row.kind === "never")

  it.each(fixed.map((row) => [row.id, row.kind] as const))("%s (%s) is backed by a rule", (id) => {
    const facts = FACTS[id] ?? []
    expect(facts.length).toBeGreaterThan(0)
    const broken = facts.filter((fact) => (
      (fact.check ? !fact.check() : false)
      || (fact.file && fact.contains ? !source(fact.file).includes(fact.contains) : false)
    ))
    expect(broken).toEqual([])
  })

  it("pins nothing that is not a fixed row", () => {
    const fixedIds = new Set<string>(fixed.map((row) => row.id))
    expect(Object.keys(FACTS).filter((id) => !fixedIds.has(id))).toEqual([])
  })
})

describe("switch rows are enforced where the agent asks", () => {
  it.each([
    ["contactCreateRequest", "src/app/api/v2/mtm/mobile/route-field/contact-create-requests/route.ts"],
    ["contactChangeRequest", "src/app/api/v1/mtm/contacts/[id]/change-requests/route.ts"],
    // The same request from the field app: its own door, the same switch.
    ["contactChangeRequest", "src/app/api/v2/mtm/mobile/route-field/contacts/[id]/change-requests/route.ts"],
    ["customerCreateRequest", "src/app/api/v1/mtm/customer-create-requests/route.ts"],
  ])("%s is refused by its endpoint", (id, file) => {
    expect(source(file)).toContain(`agentPermissionDeniedBody("${id}")`)
  })

  it.each([
    ["teamSchedule", "src/app/api/v1/mtm/mobile/team-schedule/route.ts", "settings.teamScheduleVisibilityEnabled"],
    ["taskSelfCreate", "src/app/api/v1/mtm/tasks/route.ts", 'actor.role === "AGENT" && !settings.taskSelfCreate'],
    ["taskSelfRecurring", "src/app/api/v1/mtm/tasks/route.ts", "!settings.taskSelfRecurring"],
  ])("%s keeps the check it had before the matrix", (_id, file, guard) => {
    expect(source(file)).toContain(guard)
  })

  // Owner, 2026-10-07: «нужна возможность отключения из настроек — если агент
  // не на месте, но мог делать чек-ин, и потом проверить». This switch lifts a
  // refusal instead of adding one, so its three readers are the three writers
  // of a check-in: the direct POST, the native engine and the PWA outbox.
  it.each([
    ["src/app/api/v1/mtm/visits/route.ts", 'const outsideAllowed = !force && agentPermissionEnabled(orgSettings, "checkInOutsideZone")', "if (!force && !outsideAllowed) {"],
    ["src/app/api/v1/mtm/mobile/sync/push/route.ts", "const outsideAllowed = !forceAuthorized && await outsideZoneCheckInEnabled(tx)", "} else if (outsideAllowed) {"],
    ["src/app/api/v1/mtm/sync/push/route.ts", "const outsideAllowed = await outsideZoneCheckInEnabled(tx)", "if (!outsideAllowed) {"],
  ])("checkInOutsideZone is read by the check-in writer %s, which refuses without it", (file, read, refusal) => {
    expect(source(file)).toContain(read)
    expect(source(file)).toContain(refusal)
  })

  it("reads checkInOutsideZone for the two sync writers through the matrix, off unless stored as true", () => {
    const reader = source("src/lib/mtm/check-in-geofence.ts")
    expect(reader).toContain('where: { organizationId, key: "agentCheckInOutsideZone" }')
    expect(reader).toContain('{ agentCheckInOutsideZone: coerceMtmBooleanSetting(row?.value, false) },\n      "checkInOutsideZone",')
  })

  it("covers every switch row", () => {
    expect(AGENT_SWITCH_ROWS.map((row) => row.id).sort()).toEqual([
      "checkInOutsideZone",
      "contactChangeRequest", "contactCreateRequest", "customerCreateRequest",
      "taskSelfCreate", "taskSelfRecurring", "teamSchedule",
    ])
  })

  // Publishing one's own routes is not a switch: one tick on the agent's card
  // decides it, and no organization setting stands above the tick (owner,
  // 2026-10-06: «что за включение компании, зачем усложняешь»).
  it("decides self-publishing on the agent's card alone, with no organization setting behind it", () => {
    const row = AGENT_PERMISSION_ROWS.find((candidate) => candidate.id === "routeSelfPublish")
    expect(row).toEqual({ id: "routeSelfPublish", group: "routes", kind: "perAgent", cardFlag: "canSelfPublishRoutes" })
    expect(Object.keys(MTM_SETTING_DEFAULTS)).not.toContain("routeSelfPublish")
    const readers = [
      "src/app/api/v1/mtm/routes/[id]/publish/route.ts",
      "src/app/api/v1/mtm/routes/route.ts",
      "src/app/api/v1/mtm/mobile/bootstrap/route.ts",
      "src/app/api/v1/mtm/mobile/week/route.ts",
      "src/lib/mtm/mobile-route-command.ts",
      "src/app/(dashboard)/mtm/settings/page.tsx",
    ]
    expect(readers.filter((file) => source(file).includes("routeSelfPublish"))).toEqual([])
  })
})
