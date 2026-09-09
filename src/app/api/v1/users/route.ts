import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { checkUserLimit } from "@/lib/plan-limits"
import bcrypt from "bcryptjs"
import { withRlsAuth, withRlsSessionAuth } from "@/lib/with-rls"
import { getAssignableRoleIds } from "@/lib/org-roles"
import { checkPermission, isAdmin } from "@/lib/permissions"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import { passwordPolicyError } from "@/lib/password-policy"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { USER_ADMIN_SELECT, USER_ROSTER_SELECT } from "@/lib/user-directory-projection"

const MAX_CREATE_USER_BODY_SIZE = 32 * 1024

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).email(),
  password: z.string().max(72),
  role: z.string().trim().min(1).max(50).optional(),
  department: z.string().trim().max(100).nullable().optional(),
  phone: z
    .union([
      z.literal("").transform(() => null),
      z.string().regex(/^\+[1-9]\d{6,14}$/, {
        message: "Phone must be in international format (+ and 7-15 digits)",
      }),
      z.null(),
    ])
    .optional(),
  isActive: z.boolean().optional(),
  skills: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  maxTickets: z.number().int().min(1).max(100).optional(),
  preferredLanguage: z.enum(["ru", "en", "az"]).nullable().optional(),
}).strict()

// Reading the team roster is `users:read`, not `settings:read`. The two are
// separate permissions and always were; this route asked for the wrong one, so
// a manager — who holds `users:read` and needs it to hand a lead to another
// seller — got a 403 while a viewer, who reads everything by wildcard, did not.
//
// Writing users stays on `settings` below. Only the roster widened.
export const GET = withRlsAuth("users", "read", async (_req, authResult) => {
  const orgId = authResult.orgId

  // Who is on the team, versus the state of everyone's account. The second set
  // — whether a colleague has 2FA, the phone that verifies it, when they last
  // reset their password, how often they sign in — is administration, and the
  // roles newly admitted here asked for a name to assign work to. So they get
  // the roster; actual admin roles still get the whole administration record.
  // The viewer wildcard grants read access to ordinary modules, including
  // `settings`, but it must not turn a read-only viewer into an account-
  // security administrator. Only actual admin roles receive authentication
  // posture and personal phone metadata.
  // API keys intentionally carry a synthetic admin role so they can authorize
  // scoped machine operations. That role is not proof of a human administrator
  // and must never unlock authentication posture or personal phone metadata.
  // Exact provenance comparison is fail-closed for older/mocked AuthResult
  // values that do not yet carry principalType.
  const administrative = authResult.principalType === "session" && isAdmin(authResult.role)

  try {
    const users = await prisma.user.findMany({
      // Обезличенных здесь быть не должно: для админа они удалены, и увидеть
      // в списке сотрудников строку «Удалённый пользователь» — это выглядеть
      // как несработавшее удаление. По `id` они по-прежнему разрешаются
      // (GET /users/[id]), потому что журналы соответствия на них ссылаются
      // и должны показывать субъекта, а не пустоту.
      where: { organizationId: orgId, anonymizedAt: null },
      select: administrative ? USER_ADMIN_SELECT : USER_ROSTER_SELECT,
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ success: true, data: users })
  } catch (e) {
    console.error("Users GET error:", e)
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
  }
})

export const POST = withRlsSessionAuth(async (req, authResult) => {
  if (!checkPermission(authResult.role, "settings", "write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (authResult.role !== "superadmin" && !(await orgHasModule(authResult.orgId, "settings"))) {
    return moduleDisabledResponse("settings")
  }

  const orgId = authResult.orgId

  try {
    const requestBody = await readJsonRequestWithinLimit(req, MAX_CREATE_USER_BODY_SIZE)
    if (!requestBody.ok) {
      return NextResponse.json(
        { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON body" },
        { status: requestBody.reason === "too_large" ? 413 : 400 },
      )
    }
    const parsed = createUserSchema.safeParse(requestBody.value)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const {
      name,
      email,
      password,
      role,
      department,
      phone,
      isActive,
      skills,
      maxTickets,
      preferredLanguage,
    } = parsed.data

    const passwordError = passwordPolicyError(password)
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

    // Check plan user limit
    const limitCheck = await checkUserLimit(orgId)
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: limitCheck.message }, { status: 403 })
    }

    // Check if email already exists in org
    const existing = await prisma.user.findFirst({
      where: { organizationId: orgId, email },
    })
    if (existing) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 })
    }

    // Validate role. Previously any unrecognized role was silently coerced to
    // "sales" (so creating a "marketing" user quietly produced a "sales" user);
    // now an unassignable role is a hard 400 and an absent role defaults to
    // least-privilege "viewer". Only enforce-able roles may be assigned — a
    // deny-all role (marketing/finance/custom) would silently lock the user out
    // (see getAssignableRoleIds).
    let resolvedRole = "viewer"
    if (role != null && role !== "") {
      if (!getAssignableRoleIds().has(role)) {
        return NextResponse.json(
          { error: `Role "${role}" is not assignable — only built-in permission roles (admin, manager, sales, support, ticketing, viewer) are currently enforced.` },
          { status: 400 }
        )
      }
      resolvedRole = role
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        name,
        email,
        passwordHash,
        role: resolvedRole,
        department: department || null,
        phone: phone || null,
        isActive: isActive !== false,
        skills: skills || [],
        maxTickets: maxTickets || 10,
        preferredLanguage: preferredLanguage || null,
      },
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, department: true, isActive: true, createdAt: true,
      },
    })

    await logAudit(orgId, "user_created", "user", user.id, user.email, {
      userId: authResult.userId,
      newValue: {
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    })

    return NextResponse.json({ success: true, data: user }, { status: 201 })
  } catch (e) {
    console.error("Users POST error:", e)
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
  }
})
