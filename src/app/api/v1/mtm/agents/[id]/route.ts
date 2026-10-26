import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { withLegacyCredentialMaintenance } from "@/lib/identity/legacy-credential-write"
import { readLegacyPhoneAssignmentBoundaryInTransaction } from "@/lib/identity/legacy-credential-boundary"
import { IdentityRegistryError } from "@/lib/identity/contract"
import { attendanceIdentityConflictResponse } from "@/lib/mtm/attendance-identity-error"
import { withRls } from "@/lib/with-rls"
import { getMobileAuth } from "@/lib/mobile-auth"
import bcrypt from "bcryptjs"
import { AgentUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { agentHistory } from "@/lib/mtm/agent-deletion"
import { resolveAgentScope, isValidMtmAgentRole, resolveTerritoryTeamIds } from "@/lib/mtm/territory-scope"
import { mtmFieldScopeRequiredResponse, resolveMtmFieldScope } from "@/lib/mtm/field-access"
import {
  MTM_SCOPED_MANAGEABLE_AGENT_ROLES,
  managerAssignmentCreatesCycle,
  mtmAgentManagerCycleResponse,
  mtmAgentOwnNotesForbidden,
  mtmScopedAgentLinkForbidden,
  mtmScopedAgentRoleForbidden,
  mtmScopedAgentTerritoryForbidden,
  resolveMtmAgentAdministration,
  type MtmAgentAdministration,
} from "@/lib/mtm/agent-administration"
import { checkPermission } from "@/lib/permissions"
import { passwordPolicyError } from "@/lib/password-policy"
import { checkSignInPhone } from "@/lib/mtm/mobile-login-phone"
import { mtmAgentCodeTakenResponse, writeWithMtmAgentCode } from "@/lib/mtm/agent-external-code"
import {
  MTM_AGENT_WEB_ONLY_SELECT,
  mtmAgentNotesReader,
  readsMtmAgentNotes,
  validateMtmAgentTags,
  type MtmAgentNotesReader,
} from "@/lib/mtm/agent-tags"

// Also read for the employee's own phone and for integration keys — which is
// why the card's labels and map colour are NOT in it. They are the managers'
// notes about the person; whoever reads them (mtmAgentNotesReader) gets them
// through MTM_AGENT_WEB_ONLY_SELECT, added behind that check in the handler.
const AGENT_RESPONSE_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  name: true,
  email: true,
  phone: true,
  externalCode: true,
  role: true,
  status: true,
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: true,
  avatar: true,
  teamId: true,
  managerId: true,
  isOnline: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  manager: { select: { id: true, name: true } },
  team: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
} satisfies Prisma.MtmAgentSelect

async function isCardInManagerTerritory(
  administration: Extract<MtmAgentAdministration, { kind: "scoped" }>,
  organizationId: string,
  teamId: string | null,
): Promise<boolean> {
  if (!teamId) return false
  const territory = await resolveTerritoryTeamIds(prisma, {
    agentId: administration.actor.agentId,
    organizationId,
    role: "MANAGER",
  })
  return territory.includes(teamId)
}

/** A scoped manager reaches only cards inside their field scope; others look missing. */
function scopedAgentIdFilter(administration: MtmAgentAdministration, id: string): string | { equals: string; in: string[] } {
  return administration.kind === "scoped" ? { equals: id, in: administration.agentIds } : id
}

function workforceRetentionBlocked(kinds: string[] = []) {
  return NextResponse.json({
    error: "This employee has Workforce time history and must be archived instead of permanently deleted.",
    code: "WORKFORCE_RETENTION_BLOCKED",
    data: { kinds },
  }, { status: 409 })
}

/**
 * An employee with work history is deactivated, not deleted (owner,
 * 2026-10-06). `kinds` names the tables that hold the history — model names,
 * not their content — so the screen can say what stands in the way.
 */
function agentHasHistory(kinds: string[] = []) {
  return NextResponse.json({
    error: "This employee has work history and cannot be permanently deleted. Deactivate them instead.",
    code: "MTM_AGENT_HAS_HISTORY",
    data: { kinds },
  }, { status: 409 })
}

async function mobileVisibleAgentIds(req: Parameters<typeof getMobileAuth>[0], orgId: string) {
  const mobileAuth = getMobileAuth(req)
  if (!mobileAuth?.agentId) return null

  const caller = await prisma.mtmAgent.findFirst({
    where: { id: mobileAuth.agentId, organizationId: orgId, status: "ACTIVE" },
    select: { id: true, role: true },
  })
  if (!caller || !isValidMtmAgentRole(caller.role)) return []

  const scope = await resolveAgentScope(prisma, {
    agentId: caller.id,
    organizationId: orgId,
    role: caller.role,
  })
  return scope.agentIds
}

export const GET = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, session } = auth
  const { id } = await params

  try {
    if (session && !checkPermission(session.role, "mtm", "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    // An employee opens his own card with the phone's token — or, with the
    // same email and password, in a browser. The labels and the map colour are
    // what his manager noted about him, so a browser session is necessary and
    // not enough: who reads them is decided from the person behind it, the
    // same rule as the list. A phone token sent along with a cookie is still
    // the phone.
    const webSession = Boolean(session) && !getMobileAuth(req)?.agentId
    let notesReader: MtmAgentNotesReader = { kind: "nobody" }
    let visibleAgentIds = await mobileVisibleAgentIds(req, orgId)
    if (visibleAgentIds === null && session) {
      // A web user opens only a card inside their field scope; others are a 404.
      const scope = await resolveMtmFieldScope(prisma, {
        organizationId: orgId,
        userId: session.userId,
        webRole: session.role,
      })
      if (scope.kind === "none") return mtmFieldScopeRequiredResponse()
      if (scope.kind === "agents") visibleAgentIds = scope.agentIds
      notesReader = mtmAgentNotesReader({ webSession, actor: scope.actor })
    }
    const readsNotes = notesReader.kind !== "nobody"
    const agent = await prisma.mtmAgent.findFirst({
      where: {
        id: visibleAgentIds === null ? id : { equals: id, in: [...visibleAgentIds] },
        organizationId: orgId,
      },
      select: { ...AGENT_RESPONSE_SELECT, ...(readsNotes ? MTM_AGENT_WEB_ONLY_SELECT : {}) },
    })
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // Taken out of the row whoever asks and put back only for whoever reads
    // them: the second lock, for the day the select above grows. A manager's
    // or a supervisor's own card goes out blank — the shape of the cards of
    // his people, without what was noted about him.
    const { tags, mapColor, ...card } = agent as typeof agent & { tags?: string[] | null; mapColor?: string | null }
    const notesOfThisCard = readsMtmAgentNotes(notesReader, card.id)
    return NextResponse.json({
      success: true,
      data: readsNotes
        ? { ...card, tags: notesOfThisCard ? tags ?? [] : [], mapColor: notesOfThisCard ? mapColor ?? null : null }
        : card,
    })
  } catch (e) {
    console.error("[MTM/agents/[id] GET]", e)
    return NextResponse.json({ error: "Failed to fetch agent" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    const administration = await resolveMtmAgentAdministration(prisma, auth)
    if (administration.kind === "denied") return administration.response

    const raw = await req.json()
    const parsed = parseBody(AgentUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    // Who may write the labels and the colour follows who reads them: a
    // manager is not shown what is noted about himself, and does not set it.
    // An administrator of the organization may — his own card included.
    if (
      administration.kind === "scoped"
      && id === administration.actor.agentId
      && (body.tags !== undefined || body.mapColor !== undefined)
    ) {
      return mtmAgentOwnNotesForbidden()
    }
    // Checked only when the labels were sent: the other callers of this route
    // (a permission switch, a status change, an open tab from before the
    // labels) send a partial body, and theirs must leave the labels alone.
    const labels = body.tags === undefined ? null : validateMtmAgentTags(body.tags)
    if (labels && !labels.ok) {
      return NextResponse.json({ error: labels.error, code: "MTM_AGENT_TAGS_INVALID" }, { status: 400 })
    }

    // Scope first, existence second: a manager probing ids outside their scope
    // gets the same 404/403 whether the linked user or manager exists or not.
    const before = await prisma.mtmAgent.findFirst({
      where: { id: scopedAgentIdFilter(administration, id), organizationId: orgId },
      select: {
        id: true,
        name: true,
        externalCode: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        canPlanOwnRoutes: true,
        canSelfPublishRoutes: true,
        managerId: true,
        userId: true,
        teamId: true,
        // For the audit trail only: what the labels and the colour were before.
        tags: true,
        mapColor: true,
      },
    })
    if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const managerChanges = body.managerId !== undefined && body.managerId !== null && body.managerId !== before.managerId
    if (administration.kind === "scoped") {
      // A manager's own card and their peers' cards are administrator work:
      // otherwise a manager could raise their own role or take over a peer's
      // login by resetting the password.
      if (!MTM_SCOPED_MANAGEABLE_AGENT_ROLES.includes(before.role)) return mtmScopedAgentRoleForbidden()
      if (body.role !== undefined && !MTM_SCOPED_MANAGEABLE_AGENT_ROLES.includes(body.role)) return mtmScopedAgentRoleForbidden()
      if (body.userId !== undefined && (body.userId ?? null) !== before.userId) return mtmScopedAgentLinkForbidden()
      if (managerChanges && !administration.agentIds.includes(body.managerId as string)) {
        return NextResponse.json({ error: "Manager is outside your field scope", code: "MTM_AGENT_OUT_OF_SCOPE" }, { status: 403 })
      }
      // A supervisor sees their whole team, and a login taken over by a
      // password reset acts with that card's scope. A report reached only
      // through the reporting line may sit in someone else's team — making
      // them supervisor, or resetting their password, would hand the manager
      // that team. Both require the card's team to be in the manager's own
      // territory.
      const becomesSupervisor = body.role === "SUPERVISOR" && before.role !== "SUPERVISOR"
      if (becomesSupervisor || body.password) {
        if (!await isCardInManagerTerritory(administration, orgId, before.teamId)) {
          return mtmScopedAgentTerritoryForbidden()
        }
      }
    }
    if (managerChanges && await managerAssignmentCreatesCycle(prisma, {
      organizationId: orgId,
      agentId: id,
      managerId: body.managerId as string,
    })) {
      return mtmAgentManagerCycleResponse()
    }

    if (body.userId) {
      const linkedUser = await prisma.user.findFirst({
        where: { id: body.userId, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!linkedUser) {
        return NextResponse.json({ error: "Linked user not found in this organization" }, { status: 400 })
      }
    }
    if (body.managerId) {
      const manager = await prisma.mtmAgent.findFirst({
        where: { id: body.managerId, organizationId: orgId },
        select: { id: true },
      })
      if (!manager) {
        return NextResponse.json({ error: "Manager not found in this organization" }, { status: 400 })
      }
    }

    const data: Prisma.MtmAgentUncheckedUpdateManyInput = {}
    if (body.name !== undefined) data.name = body.name
    if (body.email !== undefined) data.email = body.email ?? null
    if (body.phone !== undefined) {
      // A changed number is the one the agent will sign in by: held to the
      // same rule as a new card. A number left as it was is not re-judged.
      if (body.phone && body.phone.replace(/[\s\-()]/g, "") !== (before.phone ?? "").replace(/[\s\-()]/g, "")) {
        const phone = await checkSignInPhone(prisma, orgId, body.phone, before.id)
        if (!phone.ok) return NextResponse.json({ error: phone.error, code: phone.code }, { status: phone.status })
        body.phone = phone.phone
      }
      data.phone = body.phone ?? null
    }
    if (body.role !== undefined) data.role = body.role
    if (body.status !== undefined) data.status = body.status
    if (body.canPlanOwnRoutes !== undefined) data.canPlanOwnRoutes = body.canPlanOwnRoutes
    if (body.canSelfPublishRoutes !== undefined) data.canSelfPublishRoutes = body.canSelfPublishRoutes
    if (body.managerId !== undefined) data.managerId = body.managerId ?? null
    if (body.userId !== undefined) data.userId = body.userId ?? null
    // Whoever may edit this card may label and colour it: the scope checks
    // above fence whom that is, and the caller's own card was refused first.
    if (labels?.ok) data.tags = labels.tags
    if (body.mapColor !== undefined) data.mapColor = body.mapColor ?? null
    // «Reset password» on the card (owner, 2026-10-17: «сделай сброс пароля, у
    // меня нет 3-го номера»): when no code can reach the agent's WhatsApp, the
    // administrator — or the manager of the card's territory, checked above —
    // sets one and hands it over. A new hash is a new credential epoch, so the
    // agent's sessions on other phones end.
    if (body.password) {
      const passwordError = passwordPolicyError(body.password)
      if (passwordError) return NextResponse.json({ error: passwordError, code: "MTM_PASSWORD_WEAK" }, { status: 400 })
      data.passwordHash = await bcrypt.hash(body.password, 12)
    }

    const changesCredentials = Boolean(body.password) || body.userId !== undefined || body.phone !== undefined
    const audit = (newData: Prisma.MtmAgentUncheckedUpdateManyInput, tx?: Prisma.TransactionClient) => {
      const event = {
        organizationId: orgId, agentId: id, action: "AGENT_UPDATE", entity: "agent", entityId: id,
        metadataKind: "agent_update" as const, oldData: before,
        newData: { ...newData, passwordHash: newData.passwordHash ? "[redacted]" : undefined }, req,
      }
      return tx ? writeMtmAudit(event, tx) : writeMtmAudit(event)
    }
    const write = async (externalCode?: string): Promise<Prisma.BatchPayload> => {
      const update = externalCode === undefined ? data : { ...data, externalCode }
      const where = { id: scopedAgentIdFilter(administration, id), organizationId: orgId }
      if (!changesCredentials) return prisma.mtmAgent.updateMany({ where, data: update })
      const principals = [{ kind: "ACTOR" as const, actorId: id },
        ...(body.userId ? [{ kind: "USER" as const, userId: body.userId }] : [])]
      const result = await runWithTenant(orgId, () => withLegacyCredentialMaintenance(prisma, orgId, principals, async tx => {
        const fresh = await tx.mtmAgent.findFirst({ where, select: {
          role: true, status: true, userId: true, teamId: true, managerId: true, phone: true,
        } })
        if (!fresh) return { count: 0 }
        // The permission decision above belongs to this exact card/scope.
        // Do not reset or relink after a concurrent privilege/territory move.
        if (fresh.role !== before.role || fresh.status !== before.status || fresh.userId !== before.userId
          || fresh.teamId !== before.teamId || fresh.managerId !== before.managerId
          || (body.phone !== undefined && fresh.phone !== before.phone)) {
          throw new IdentityRegistryError("IDENTITY_LEGACY_CARD_STATE_CHANGED")
        }
        if (body.userId && !await tx.user.findFirst({ where: {
          id: body.userId, organizationId: orgId, isActive: true, anonymizedAt: null,
        }, select: { id: true } })) throw new IdentityRegistryError("IDENTITY_LEGACY_CARD_STATE_CHANGED")
        if (body.phone) {
          if (await readLegacyPhoneAssignmentBoundaryInTransaction(tx, orgId, body.phone) !== "LEGACY") {
            throw new IdentityRegistryError("IDENTITY_CREDENTIAL_FLOW_REQUIRED")
          }
          // Repeat a changed number's uniqueness under the canonical lock.
          // An unchanged historical national spelling keeps its old behavior.
          if (body.phone.replace(/[\s\-()]/g, "") !== (before.phone ?? "").replace(/[\s\-()]/g, "")) {
            const phone = await checkSignInPhone(tx, orgId, body.phone, before.id)
            if (!phone.ok) throw new IdentityRegistryError("IDENTITY_LEGACY_CARD_STATE_CHANGED")
          }
        }
        const changed = await tx.mtmAgent.updateMany({ where, data: update })
        if (changed.count === 1) await audit(update, tx)
        return changed
      }))
      if (!result.allowed) throw new IdentityRegistryError("IDENTITY_CREDENTIAL_FLOW_REQUIRED")
      return result.value
    }
    let agent: Prisma.BatchPayload
    if (body.externalCode === undefined) {
      agent = await write()
    } else {
      // The code field sent empty — a card that never had one, or one cleared
      // in the form — gets the next code in the organization's sequence, the
      // way a new card does.
      const saved = await writeWithMtmAgentCode(prisma, orgId, body.externalCode ?? null, write)
      if (!saved.ok) return mtmAgentCodeTakenResponse(saved.code)
      agent = saved.value
      data.externalCode = saved.code
    }
    if (agent.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (!changesCredentials) await audit(data).catch((e) => console.warn("[MTM/agents/[id] PUT] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    if (e instanceof IdentityRegistryError && ["IDENTITY_CREDENTIAL_FLOW_REQUIRED", "IDENTITY_LEGACY_CARD_STATE_CHANGED"].includes(e.code)) {
      return NextResponse.json({ code: e.code, error: e.code === "IDENTITY_CREDENTIAL_FLOW_REQUIRED"
        ? "Use the current credential management flow for this account" : "The card changed; refresh it and retry" }, { status: 409 })
    }
    const conflict = attendanceIdentityConflictResponse(e)
    if (conflict) return conflict
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update" }, { status: 400 })
  }
})

export const DELETE = withRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    const administration = await resolveMtmAgentAdministration(prisma, auth)
    if (administration.kind === "denied") return administration.response

    const deletion = await prisma.$transaction(async (tx) => {
      // Child HRM/GPS inserts take a KEY SHARE lock on the employee. Keep the
      // parent row locked from the final retention count through deletion so
      // a new retained fact cannot slip into a cascading delete.
      await tx.$executeRaw`
        SELECT 1 FROM "mtm_agents"
        WHERE "id" = ${id} AND "organizationId" = ${orgId}
        FOR UPDATE
      `
      const before = await tx.mtmAgent.findFirst({
        where: { id: scopedAgentIdFilter(administration, id), organizationId: orgId },
        select: { id: true, name: true, email: true, role: true },
      })
      if (!before) return { kind: "not_found" as const }
      if (administration.kind === "scoped" && !MTM_SCOPED_MANAGEABLE_AGENT_ROLES.includes(before.role)) {
        return { kind: "role_forbidden" as const }
      }

      // Time history is governed by a separate retention contract. Check it
      // before the FK cascade reaches the database fact guard, so admins
      // receive a clear archive/deactivate action rather than an opaque error.
      const retentionChecks = {
        "MtmAgentWorkday.agentId": tx.mtmAgentWorkday.count({ where: { organizationId: orgId, agentId: id } }),
        "MtmAgentWorkdayEvent.agentId": tx.mtmAgentWorkdayEvent.count({ where: { organizationId: orgId, agentId: id } }),
        "MtmAgentLocation.agentId": tx.mtmAgentLocation.count({ where: { organizationId: orgId, agentId: id } }),
        "MtmHrmRequest.agentId": tx.mtmHrmRequest.count({ where: { organizationId: orgId, agentId: id } }),
        "MtmWorkCalendarDay.agentId": tx.mtmWorkCalendarDay.count({
          where: {
            organizationId: orgId,
            agentId: id,
            source: { in: ["HRM", "WORKFORCE_LEAVE", "WORKFORCE_ABSENCE"] },
          },
        }),
        "MtmAuditLog.agentId": tx.mtmAuditLog.count({
          where: {
            organizationId: orgId,
            agentId: id,
            OR: [
              { metadataKind: { in: ["workday_transition", "hrm_request_decision", "workforce_time_correction"] } },
              { action: { in: [
                "WORKDAY_START",
                "WORKDAY_PAUSE",
                "WORKDAY_RESUME",
                "WORKDAY_FINISH",
                "HRM_REQUEST_DECISION",
                "WORKFORCE_TIME_CORRECTION_APPLIED",
              ] } },
            ],
          },
        }),
        "WorkforceShiftAssignment.agentId": tx.workforceShiftAssignment.count({ where: { organizationId: orgId, agentId: id } }),
        "WorkforcePolicySnapshot.agentId": tx.workforcePolicySnapshot.count({ where: { organizationId: orgId, agentId: id } }),
        "WorkforceShiftSnapshot.agentId": tx.workforceShiftSnapshot.count({ where: { organizationId: orgId, agentId: id } }),
        "WorkforceWorkdayScheduleSnapshot.agentId": tx.workforceWorkdayScheduleSnapshot.count({ where: { organizationId: orgId, agentId: id } }),
        "WorkforceAttendanceException.agentId": tx.workforceAttendanceException.count({ where: { organizationId: orgId, agentId: id } }),
        "WorkforceTimeCorrection.agentId": tx.workforceTimeCorrection.count({ where: { organizationId: orgId, agentId: id } }),
        "WorkforceTimesheetApproval.agentId": tx.workforceTimesheetApproval.count({ where: { organizationId: orgId, agentId: id } }),
      }
      const retentionKinds = (await Promise.all(Object.entries(retentionChecks).map(async ([kind, count]) =>
        await count > 0 ? kind : null))).filter((kind): kind is string => kind !== null)
      if (retentionKinds.length > 0) {
        return { kind: "retention_blocked" as const, history: retentionKinds }
      }
      // Visits, routes, tasks, photos, promotions… — whatever else points at
      // the employee. Without this the delete cascaded through their visits
      // and routes, or stopped at a foreign key with the constraint's name
      // for an answer.
      const history = await agentHistory(tx, orgId, id)
      if (history.length > 0) return { kind: "has_history" as const, history }

      const deleted = await tx.mtmAgent.deleteMany({
        where: { id, organizationId: orgId },
      })
      if (deleted.count === 0) return { kind: "not_found" as const }
      return { kind: "deleted" as const, before }
    })
    if (deletion.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (deletion.kind === "retention_blocked") return workforceRetentionBlocked(deletion.history)
    if (deletion.kind === "has_history") return agentHasHistory(deletion.history)
    if (deletion.kind === "role_forbidden") return mtmScopedAgentRoleForbidden()

    // `agentId` is a foreign key to the employee, and he no longer exists: a
    // row naming him there was refused by Postgres (P2003), the catch below
    // swallowed it, and the deletion left no trace of who did it. He is named
    // by `entityId` and by his name and role in `oldData` — the same shape the
    // key's own SET NULL has just given every earlier row about him.
    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "AGENT_DELETE",
      entity: "agent",
      entityId: id,
      metadataKind: "agent_delete",
      oldData: deletion.before,
      req,
    }).catch((e) => console.warn("[MTM/agents/[id] DELETE] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const conflict = attendanceIdentityConflictResponse(e)
    if (conflict) return conflict
    if (e instanceof Error && /Workforce workday facts cannot be deleted/i.test(e.message)) {
      return workforceRetentionBlocked()
    }
    // The database refused: a row this handler does not know about still
    // points at the employee, or an append-only table would lose a fact. That
    // is history too — and never the constraint's name on the user's screen.
    if (
      (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014"))
      || (e instanceof Error && /foreign key constraint|is immutable|cannot be deleted/i.test(e.message))
    ) {
      console.warn("[MTM/agents/[id] DELETE] refused by the database", e)
      // A constraint refusal alone does not prove work history. Keep the
      // record, but distinguish an unclassified dependency from counted facts.
      return NextResponse.json({
        error: "This card still has linked records. Nothing was deleted.",
        code: "MTM_AGENT_DELETE_DEPENDENCY",
      }, { status: 409 })
    }
    console.error("[MTM/agents/[id] DELETE]", e)
    return NextResponse.json({ error: "Failed to delete", code: "MTM_AGENT_DELETE_FAILED" }, { status: 500 })
  }
})
