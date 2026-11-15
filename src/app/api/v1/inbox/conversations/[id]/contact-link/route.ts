import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { withConversationChannelAccess } from "@/lib/inbox/channel-access"
import { checkPermission, type Role } from "@/lib/permissions"
import {
  contactLinkSuggestions,
  linkConversationContact,
  linkedContactOf,
  searchContactsForLink,
  unlinkConversationContact,
} from "@/lib/inbox/contact-link"

type Ctx = { params: Promise<{ id: string }> }

/** Picking a customer lists customers: the person must be allowed to read them. */
function contactsDenied(role: string) {
  return checkPermission(role as Role, "contacts", "read")
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

/**
 * GET — which customer this Instagram/Messenger conversation belongs to, and the customers a number or
 * e-mail from the chat points to (only when it points to exactly one). `?q=` searches customers by
 * name, phone or e-mail for the manual pick (lib/inbox/contact-link).
 */
export const GET = withRlsAuth("inbox", "read", withConversationChannelAccess(async (req, auth, { params }: Ctx) => {
  const { id } = await params
  const denied = contactsDenied(auth.role)
  if (denied) return denied

  const state = await linkedContactOf({ organizationId: auth.orgId, conversationId: id })
  if (!state) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

  const query = new URL(req.url).searchParams.get("q")
  if (query !== null) {
    if (!state.linkable) return NextResponse.json({ success: true, data: { results: [] } })
    const results = await searchContactsForLink({ organizationId: auth.orgId, query })
    return NextResponse.json({ success: true, data: { results } })
  }

  const suggestions = state.linkable
    ? await contactLinkSuggestions({ organizationId: auth.orgId, conversationId: id, excludeContactId: state.contact?.id })
    : []
  return NextResponse.json({
    success: true,
    data: { platform: state.platform, linkable: state.linkable, contact: state.contact, suggestions },
  })
}))

const linkSchema = z.object({
  contactId: z.string().min(1),
  via: z.enum(["manual", "suggestion"]).default("manual"),
})

/** POST — «Bu eyni müştəridir»: this conversation is that customer's. */
export const POST = withInboxSessionWrite(withConversationChannelAccess(async (req, auth, { params }: Ctx) => {
  const { id } = await params
  const denied = contactsDenied(auth.role)
  if (denied) return denied
  const parsed = linkSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "contactId is required" }, { status: 400 })

  const result = await linkConversationContact({
    organizationId: auth.orgId,
    conversationId: id,
    contactId: parsed.data.contactId,
    actorUserId: auth.userId,
    via: parsed.data.via,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, data: { contact: result.contact } })
}))

/** DELETE — «Ayır»: the conversation is its own thread again. */
export const DELETE = withInboxSessionWrite(withConversationChannelAccess(async (_req, auth, { params }: Ctx) => {
  const { id } = await params
  const result = await unlinkConversationContact({ organizationId: auth.orgId, conversationId: id, actorUserId: auth.userId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, data: { contact: null } })
}))
