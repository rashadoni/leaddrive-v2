import { getOrgModuleContext, moduleAccessDenial, type AuthResult } from "@/lib/api-auth"
import type { ShellEventKind } from "./watcher"

/**
 * Which shell events this person may hear about: the same gates as the routes
 * the tab reads when it hears one. An event carries no data, but it still says
 * that a call rang or a ticket arrived, so nobody hears of what they could not
 * open.
 *
 * - calls → GET /api/v1/calls/active (`voip`, read)
 * - tickets → GET /api/v1/tickets/new-count (`tickets`, read; the stream adds
 *   the tenant-module and hidden-module checks the proxy makes for that path)
 * - webchat → GET /api/v1/web-chat/sessions/unread-count (`inbox`, read)
 * - notifications → GET /api/v1/notifications, the person's own rows; the
 *   stream sends only the events naming this person or everyone.
 *
 * A superadmin is not gated by the tenant's modules, as in requireAuth.
 */
export async function shellEventKindsFor(auth: AuthResult): Promise<Set<ShellEventKind>> {
  const orgContext = auth.role === "superadmin" ? null : await getOrgModuleContext(auth.orgId)
  const kinds = new Set<ShellEventKind>(["notifications"])
  if (!moduleAccessDenial(auth, orgContext, "voip", "read")) kinds.add("calls")
  if (!moduleAccessDenial(auth, orgContext, "tickets", "read")) kinds.add("tickets")
  if (!moduleAccessDenial(auth, orgContext, "inbox", "read")) kinds.add("webchat")
  return kinds
}
