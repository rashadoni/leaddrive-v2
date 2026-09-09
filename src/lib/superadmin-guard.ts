import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "./api-auth"
import { auth } from "./auth"
import { enterRlsBypass } from "./rls-context"
import type { Role } from "./permissions"

interface AuthResult {
  orgId: string
  userId: string
  role: Role
  email: string
  name: string
}

function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}

/**
 * Guard for API routes: requires superadmin role.
 * Returns AuthResult on success or NextResponse(401/403) on failure.
 */
export async function requireSuperAdmin(req: NextRequest): Promise<AuthResult | NextResponse> {
  const result = await requireAuth(req)
  if (isAuthError(result)) return result
  if (result.role !== "superadmin") {
    return NextResponse.json(
      { error: "Forbidden: superadmin access required" },
      { status: 403 }
    )
  }
  enterRlsBypass() // superadmin operates cross-tenant; replaces the tenant ctx entered by requireAuth
  return result
}

/**
 * Guard for server components: checks if current session is superadmin.
 */
export async function isSuperAdminSession(): Promise<boolean> {
  try {
    const session = await auth()
    return session?.user?.role === "superadmin"
  } catch {
    return false
  }
}
