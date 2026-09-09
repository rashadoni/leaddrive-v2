/**
 * GET   /api/v1/users/me  → the caller's own profile
 * PATCH /api/v1/users/me  → self-service update of the caller's own profile
 *
 * Self-service "personal cabinet" — every authenticated user manages only
 * their OWN row (keyed on the session userId + orgId), so no settings/users
 * write permission is required. Same self-service pattern as
 * users/me/availability and users/me/preferences.
 *
 * SECURITY: the update is scoped via updateMany({ where: { id: userId,
 * organizationId: orgId } }) so a caller can never write another user's row
 * even by tampering. email / role / isActive / permissions are NOT writable
 * here — email changes need an administrator/verified-email workflow and the
 * authorization fields are admin-only (PUT /api/v1/users/[id]). passwordHash /
 * totpSecret / backupCodes are never returned.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const MAX_PROFILE_BODY_SIZE = 32 * 1024

// Fields returned to the caller. NEVER include passwordHash, totpSecret, or
// backupCodes — this select object is the single source of truth for both
// GET and PATCH responses.
const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  department: true,
  avatar: true,
  preferredLanguage: true,
  timezone: true,
  role: true,
  totpEnabled: true,
  smsAuthEnabled: true,
  lastLogin: true,
  loginCount: true,
} as const

const profilePhoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((phone, ctx): string | null => {
    // Treat an empty form value as an explicit clear, just like `null`.
    if (phone === "") return null

    // Permit common display separators at the API boundary, but persist one
    // canonical E.164 value. Requiring an explicit country code avoids
    // silently guessing a user's locale/calling code.
    if (!/^[+\d\s().-]+$/.test(phone)) {
      ctx.addIssue({
        code: "custom",
        message: "Phone must be in international format (+ and 7-15 digits)",
      })
      return z.NEVER
    }

    const normalized = phone.replace(/[\s().-]/g, "")
    if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
      ctx.addIssue({
        code: "custom",
        message: "Phone must be in international format (+ and 7-15 digits)",
      })
      return z.NEVER
    }
    return normalized
  })
  .nullable()

const patchSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: profilePhoneSchema,
    department: z.string().max(120).nullable(),
    preferredLanguage: z.enum(["ru", "en", "az"]).nullable(),
    timezone: z.string().max(64).nullable(),
  })
  // .partial() → every field optional (partial update). .strict() → unknown or
  // forbidden keys (role, isActive, organizationId, permissions, …) make zod
  // REJECT with 400 rather than silently strip them, so a caller can never
  // believe a privilege-escalation attempt "worked".
  .partial()
  .strict()

export const GET = withRlsSessionAuth(async (_req, session) => {
  const { orgId, userId } = session

  try {
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: PROFILE_SELECT,
    })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true, data: user })
  } catch (e) {
    console.error("[me GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PATCH = withRlsSessionAuth(async (req, session) => {
  const { orgId, userId } = session

  const requestBody = await readJsonRequestWithinLimit(req, MAX_PROFILE_BODY_SIZE)
  if (!requestBody.ok) {
    if (requestBody.reason === "too_large") {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 })
    }
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const body = requestBody.value

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    // .strict() turns an unknown/forbidden key (role, isActive, permissions)
    // into a ZodError → 400, so a caller can't believe a privilege change took.
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const data = parsed.data

  // Nothing to update → return current profile (avoids a no-op write).
  if (Object.keys(data).length === 0) {
    const current = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: PROFILE_SELECT,
    })
    if (!current) return NextResponse.json({ error: "User not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: current })
  }

  try {
    const result = await prisma.user.updateMany({
      where: { id: userId, organizationId: orgId },
      data,
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const updated = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: PROFILE_SELECT,
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[me PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
