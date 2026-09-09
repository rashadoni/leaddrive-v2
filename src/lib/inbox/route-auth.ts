import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { checkPermission } from "@/lib/permissions"
import { withRlsSessionAuth } from "@/lib/with-rls"

type InboxMutationHandler<C> = (
  req: NextRequest,
  auth: AuthResult,
  ctx: C,
) => Promise<Response> | Response

/**
 * Authorization boundary for an operator-authored inbox mutation.
 *
 * An API key's `createdBy` is audit metadata, not an employee identity, so
 * sends, assignments, notes, participants, rules, folders, uploads and other
 * inbox writes must be performed by a fresh browser session. Role permission
 * remains independent: viewer and ticketing sessions are valid sessions, but
 * neither may mutate the inbox.
 */
export function withInboxSessionWrite<C = unknown>(handler: InboxMutationHandler<C>) {
  return withRlsSessionAuth<C>((req, auth, ctx) => {
    if (!checkPermission(auth.role, "inbox", "write")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return handler(req, auth, ctx)
  })
}
