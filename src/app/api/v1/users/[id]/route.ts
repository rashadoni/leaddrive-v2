import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { getAssignableRoleIds } from "@/lib/org-roles"
import { checkPermission, isAdmin } from "@/lib/permissions"
import { USER_ADMIN_SELECT, USER_ROSTER_SELECT } from "@/lib/user-directory-projection"
import { buildUserAnonymizationData } from "@/lib/user-anonymization"
import { handOverOpenWork } from "@/lib/user-work-handover"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().max(320).email().optional(),
  // Any non-empty string; the actual allow-list is validated per-org against
  // the org's configured roles (see getAssignableRoleIds) because custom roles
  // are not known at schema-definition time. A fixed enum here was the bug that
  // blocked editing users holding built-in roles like "marketing"/"finance".
  role: z.string().min(1).max(50).optional(),
  // Voice control. Lives on this admin-gated route ("settings"/"write") rather
  // than in user preferences on purpose: preferences are written by their own
  // owner, so a self-service flag would let any member switch on a surface that
  // reads the whole organisation aloud. Granting it stays an admin action.
  voiceEnabled: z.boolean().optional(),
  // E.164-ish: '+' followed by 7-15 digits. Allow null (clearing the field)
  // and empty string (coerced to null below).
  phone: z
    .string()
    .max(50)
    .refine((v) => v === "" || /^\+[1-9]\d{6,14}$/.test(v), {
      message: "Phone must be in international format (+ and 7-15 digits, e.g. +994501234567)",
    })
    .transform((value) => value === "" ? null : value)
    .nullable()
    .optional(),
  department: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  resetTotp: z.boolean().optional(),
  resetSms: z.boolean().optional(),
  require2fa: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  maxTickets: z.number().int().min(1).max(100).optional(),
  isAvailable: z.boolean().optional(),
  preferredLanguage: z.enum(["ru", "en", "az"]).nullable().optional(),
})

export const GET = withRlsSessionAuth(async (_req: NextRequest, session, { params }: { params: Promise<{ id: string }> }) => {
  if (!checkPermission(session.role, "users", "read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const orgId = session.orgId
  const { id } = await params

  try {
    const user = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
      select: isAdmin(session.role) ? USER_ADMIN_SELECT : USER_ROSTER_SELECT,
    })
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: user })
  } catch (e) {
    console.error("Users API error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsSessionAuth(async (req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  if (!checkPermission(authResult.role, "settings", "write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (authResult.role !== "superadmin" && !(await orgHasModule(authResult.orgId, "settings"))) {
    return moduleDisabledResponse("settings")
  }

  const orgId = authResult.orgId
  const { id } = await params

  const body = await req.json()
  if (body && typeof body === "object" && "password" in body) {
    return NextResponse.json(
      { error: "Password resets must use the dedicated reset-password action." },
      { status: 400 },
    )
  }
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    // Verify user belongs to org
    const existing = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // Validate role — but only when it actually CHANGES, so editing other
    // fields (phone, name, 2FA resets) never fails for a user who already holds
    // an extended/custom role. Only enforce-able roles may be newly assigned;
    // assigning a deny-all role (marketing/finance/custom) would silently lock
    // the user out — see getAssignableRoleIds.
    if (parsed.data.role !== undefined && parsed.data.role !== existing.role) {
      if (!getAssignableRoleIds().has(parsed.data.role)) {
        return NextResponse.json(
          { error: `Role "${parsed.data.role}" is not assignable — only built-in permission roles (admin, manager, sales, support, ticketing, viewer) are currently enforced.` },
          { status: 400 }
        )
      }
    }

    // Check email uniqueness if changing
    if (parsed.data.email && parsed.data.email !== existing.email) {
      const dup = await prisma.user.findFirst({
        where: { organizationId: orgId, email: parsed.data.email, id: { not: id } },
      })
      if (dup) return NextResponse.json({ error: "Email already in use" }, { status: 409 })
    }

    const updateData: Prisma.UserUpdateInput = {}
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name
    if (parsed.data.email !== undefined) updateData.email = parsed.data.email
    if (parsed.data.role !== undefined) updateData.role = parsed.data.role
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone
    if (parsed.data.department !== undefined) updateData.department = parsed.data.department
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive
    // Admin can reset user's 2FA
    if (parsed.data.resetTotp === true) {
      updateData.totpEnabled = false
      updateData.totpSecret = null
      updateData.backupCodes = []
      updateData.require2fa = false
    }
    // Admin can reset user's SMS 2FA (for lost-phone recovery).
    // Keeps verifiedPhone on the record so user can re-enable without re-verifying.
    if (parsed.data.resetSms === true) {
      updateData.smsAuthEnabled = false
    }
    // Admin can toggle require2fa
    if (parsed.data.require2fa !== undefined) {
      updateData.require2fa = parsed.data.require2fa
    }
    // Skill-based routing fields
    if (parsed.data.skills !== undefined) updateData.skills = parsed.data.skills
    if (parsed.data.maxTickets !== undefined) updateData.maxTickets = parsed.data.maxTickets
    if (parsed.data.isAvailable !== undefined) updateData.isAvailable = parsed.data.isAvailable
    if (parsed.data.preferredLanguage !== undefined) updateData.preferredLanguage = parsed.data.preferredLanguage

    // Role, activation and MFA changes alter what an already-issued cookie is
    // allowed to do. Advance the same credential epoch used by Auth.js so all
    // existing sessions are revoked and the next login re-evaluates the fresh
    // role/MFA setup. This also closes the manager→admin promotion window where
    // a previously verified non-MFA session could inherit admin permissions.
    const securityStateChanged =
      (parsed.data.role !== undefined && parsed.data.role !== existing.role)
      || (parsed.data.isActive !== undefined && parsed.data.isActive !== existing.isActive)
      || parsed.data.resetTotp === true
      || parsed.data.resetSms === true
      || (parsed.data.require2fa !== undefined && parsed.data.require2fa !== existing.require2fa)
    if (securityStateChanged) updateData.passwordChangedAt = new Date()

    // Voice control. Only ever set here, by a caller holding settings/write —
    // the gate re-checks the org entitlement and the role on every session, so
    // this flag says "switched on", not "allowed".
    if (parsed.data.voiceEnabled !== undefined) updateData.voiceEnabled = parsed.data.voiceEnabled

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true, name: true, email: true, role: true, voiceEnabled: true,
        phone: true, department: true, isActive: true, totpEnabled: true, require2fa: true,
        smsAuthEnabled: true, verifiedPhone: true,
        skills: true, maxTickets: true, isAvailable: true, preferredLanguage: true, createdAt: true,
      },
    })

    const auditableFields = [
      "name", "email", "role", "phone", "department", "isActive",
      "require2fa", "skills", "maxTickets", "isAvailable", "preferredLanguage",
    ] as const
    const oldValue: Record<string, unknown> = {}
    const newValue: Record<string, unknown> = {}
    for (const field of auditableFields) {
      if (parsed.data[field] !== undefined) {
        oldValue[field] = existing[field]
        newValue[field] = parsed.data[field]
      }
    }
    if (parsed.data.resetTotp === true) {
      oldValue.totpEnabled = existing.totpEnabled
      newValue.totpEnabled = false
    }
    if (parsed.data.resetSms === true) {
      oldValue.smsAuthEnabled = existing.smsAuthEnabled
      newValue.smsAuthEnabled = false
    }
    if (securityStateChanged) newValue.sessionsInvalidated = true

    const activityChanged = parsed.data.isActive !== undefined
      && parsed.data.isActive !== existing.isActive
    const auditAction = activityChanged
      ? (parsed.data.isActive ? "user_activated" : "user_deactivated")
      : "user_updated"
    await logAudit(orgId, auditAction, "user", user.id, user.email, {
      userId: authResult.userId,
      oldValue,
      newValue,
    })

    return NextResponse.json({ success: true, data: user })
  } catch (e) {
    console.error("Users API error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsSessionAuth(async (_req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  if (!checkPermission(authResult.role, "settings", "delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (authResult.role !== "superadmin" && !(await orgHasModule(authResult.orgId, "settings"))) {
    return moduleDisabledResponse("settings")
  }

  const orgId = authResult.orgId
  const { id } = await params

  try {
    const user = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    if (user.anonymizedAt) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // Не `delete`. Пользователя нельзя удалить физически: на него ссылаются
    // четыре таблицы под триггером «только добавление»
    // (forecast_snapshots, compliance_audit_log, entitlement_audit_events,
    // pipeline_stage_transitions), а связи объявлены `onDelete: SetNull` —
    // то есть удаление обязано их ОБНОВИТЬ, и триггер это отвергает.
    // Админ видел «Internal server error», причина в лог не выходила.
    // Подробнее и о том, почему обход триггера был бы хуже — в
    // `src/lib/user-anonymization.ts`.
    // Обезличивание и передача работы — одной транзакцией. Порознь можно
    // получить обезличенного владельца с непереданными сделками: строка уже
    // надгробие, а работа всё ещё закреплена за ним и не видна никому.
    const handover = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: buildUserAnonymizationData(id),
      })
      // Получатель — администратор, выполняющий удаление. Линии подчинения в
      // модели нет (у User нет ни managerId, ни divisionId), вычислить
      // «руководителя» не из чего, а придумывать его — гадание.
      return handOverOpenWork(tx, {
        orgId,
        fromUserId: id,
        toUserId: authResult.userId,
      })
    })

    // Счётчик возвращается, чтобы админ увидел, что именно к нему перешло:
    // молчаливая передача десятков сделок — это сюрприз, а не удобство.
    return NextResponse.json({ success: true, handover })
  } catch (e) {
    console.error("Users API error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
