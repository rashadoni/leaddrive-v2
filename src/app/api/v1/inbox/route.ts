import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { exposeCallForClient } from "@/lib/calls/access"
import { readInboxAttachment } from "@/lib/inbox-attachment"
import { sanitizeOwnedRefs } from "@/lib/verify-owned-refs"
import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"
import { PAGE_SIZE } from "@/lib/constants"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { markMarketingContacted } from "@/lib/inbox/customer-stage"

export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const channelFilter = searchParams.get("channel") // email, telegram, sms, whatsapp
  // The trash is a view over the same listing, not a separate store.
  const trashView = searchParams.get("view") === "trash"

  try {
    const where: any = { organizationId: orgId }
    if (channelFilter && channelFilter !== "all") {
      where.channelType = channelFilter
    }

    // 1. Fetch all messages
    const messages = await prisma.channelMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE.INBOX,
    })

    // 2. Fetch all org contacts to build lookup maps
    const allContacts = await prisma.contact.findMany({
      where: { organizationId: orgId },
      select: { id: true, fullName: true, email: true, phone: true, phones: true, lifecycleStage: true },
    })

    // Build lookup maps: email→contactId, phone→contactId
    const emailToContact: Record<string, typeof allContacts[0]> = {}
    const phoneToContact: Record<string, typeof allContacts[0]> = {}
    const contactById: Record<string, typeof allContacts[0]> = {}
    for (const c of allContacts) {
      contactById[c.id] = c
      if (c.email) emailToContact[c.email.toLowerCase()] = c
      // Map primary phone
      if (c.phone) {
        const normalized = c.phone.replace(/[\s\-()]/g, "")
        phoneToContact[normalized] = c
        phoneToContact[c.phone] = c
      }
      // Map all additional phones
      if (c.phones) {
        for (const p of c.phones) {
          if (p) {
            phoneToContact[p] = c
            phoneToContact[p.replace(/[\s\-()]/g, "")] = c
          }
        }
      }
    }

    // 3. Build telegram chatId maps from existing messages
    const chatIdToContact: Record<string, string> = {}
    // Also map chatId → email address for grouping when no contactId exists
    const chatIdToEmail: Record<string, string> = {}
    for (const msg of messages) {
      if (msg.channelType === "telegram") {
        const meta = msg.metadata as any
        const chatId = meta?.chatId as string | undefined
        if (chatId) {
          if (msg.contactId && !chatIdToContact[chatId]) {
            chatIdToContact[chatId] = msg.contactId
          }
          // Outbound with email as `to` — associate chatId with that email
          if (msg.direction === "outbound" && msg.to.includes("@") && !chatIdToEmail[chatId]) {
            chatIdToEmail[chatId] = msg.to.toLowerCase()
          }
        }
      }
    }

    // 4. Resolve each message to a grouping key (contactId preferred)
    function resolveKey(msg: typeof messages[0]): string {
      const meta = msg.metadata as any
      const tgChatId = meta?.chatId as string | undefined

      // If message already has contactId, use it
      if (msg.contactId) return `contact_${msg.contactId}`

      // Try to match by email
      if (msg.channelType === "email" || !msg.channelType) {
        const addr = msg.direction === "inbound" ? msg.from : msg.to
        if (addr) {
          const contact = emailToContact[addr.toLowerCase()]
          if (contact) return `contact_${contact.id}`
        }
      }

      // Try to match by phone (SMS)
      if (msg.channelType === "sms") {
        const phone = msg.direction === "inbound" ? msg.from : msg.to
        if (phone) {
          const normalized = phone.replace(/[\s\-()]/g, "")
          const contact = phoneToContact[normalized] || phoneToContact[phone]
          if (contact) return `contact_${contact.id}`
        }
      }

      // Try to match by WhatsApp phone number
      if (msg.channelType === "whatsapp") {
        const waPhone = meta?.waPhone as string | undefined
        const phone = waPhone || (msg.direction === "inbound" ? msg.from : msg.to)
        if (phone) {
          const normalized = phone.replace(/[\s\-()+ ]/g, "")
          const contact = phoneToContact[normalized] || phoneToContact[`+${normalized}`] || phoneToContact[phone]
          if (contact) return `contact_${contact.id}`
          // Group by WhatsApp phone number even without contact match
          if (waPhone) return `wa_${waPhone}`
        }
      }

      // Try to match by telegram chatId
      if (msg.channelType === "telegram") {
        if (tgChatId && chatIdToContact[tgChatId]) {
          return `contact_${chatIdToContact[tgChatId]}`
        }
        // Also check numeric `to` for outbound
        if (msg.direction === "outbound" && /^-?\d+$/.test(msg.to)) {
          if (chatIdToContact[msg.to]) return `contact_${chatIdToContact[msg.to]}`
        }
        // Outbound telegram might have email as `to` — try email lookup
        if (msg.direction === "outbound" && msg.to.includes("@")) {
          const contact = emailToContact[msg.to.toLowerCase()]
          if (contact) return `contact_${contact.id}`
        }
        // No contact match — try to unify via chatId↔email association
        if (tgChatId && chatIdToEmail[tgChatId]) {
          // Group by email so outbound (to email) and inbound (from chatId) merge
          return `addr_${chatIdToEmail[tgChatId]}`
        }
        // Outbound to email — use that email as grouping key (will match chatId→email above)
        if (msg.direction === "outbound" && msg.to.includes("@")) {
          return `addr_${msg.to.toLowerCase()}`
        }
        // Pure chatId grouping
        if (tgChatId) return `tg_${tgChatId}`
        if (/^-?\d+$/.test(msg.to)) return `tg_${msg.to}`
      }

      // TikTok via Chatwoot: one Chatwoot conversation = one thread. Both inbound
      // (metadata.chatwootConversationId, set by the chatwoot webhook) and outbound
      // (metadata.chatwootConversationId + to = chatwoot conv id) carry the id, so
      // they group together. The msg.contactId short-circuit above (line ~96) already
      // handles the mapped-contact case — sound only because the composer always
      // stamps contactId on the outbound send, so inbound + outbound share contact_X.
      // This branch covers the unmapped sender (no contact), the common TikTok case.
      if (msg.channelType === "tiktok") {
        const cwId = (meta?.chatwootConversationId as string | undefined)
          || (msg.direction === "outbound" ? msg.to : undefined)
        if (cwId) return `tiktok_${cwId}`
      }

      // Fallback: try email match for any channel
      const addr = msg.direction === "inbound" ? msg.from : msg.to
      if (addr?.includes("@")) {
        const contact = emailToContact[addr.toLowerCase()]
        if (contact) return `contact_${contact.id}`
      }

      return `addr_${addr || msg.from || "unknown"}`
    }

    // 5. Group messages into threads
    const threads: Record<string, any> = {}

    for (const msg of messages) {
      const key = resolveKey(msg)
      const meta = msg.metadata as any
      const tgChatId = meta?.chatId as string | undefined

      if (!threads[key]) {
        // Resolve contact info from key
        let contactId: string | null = null
        let contactName = msg.direction === "inbound" ? msg.from : msg.to
        let contactEmail: string | null = null
        let contactPhone: string | null = null
        let contactLifecycleStage: string | null = null

        if (key.startsWith("contact_")) {
          contactId = key.replace("contact_", "")
          const c = contactById[contactId]
          if (c) {
            contactName = c.fullName || contactName
            contactEmail = c.email
            contactPhone = c.phone
            contactLifecycleStage = c.lifecycleStage
          }
        }

        threads[key] = {
          contactId,
          contactName,
          contactEmail,
          contactPhone,
          contactLifecycleStage,
          telegramChatId: tgChatId || null,
          lastMessage: msg.body?.slice(0, 100) || "",
          lastMessageAt: msg.createdAt,
          lastDirection: msg.direction,
          lastChannel: msg.channelType || "email",
          unreadCount: 0,
          messageCount: 0,
          channels: new Set<string>(),
          messages: [],
          botHandled: false,
        }
      }

      threads[key].messages.push(msg)
      threads[key].messageCount++
      // A thread the auto-reply bot answered (ChannelMessage.metadata.autoReply) → "Чат-бот" inbox view.
      if (meta?.autoReply === true) threads[key].botHandled = true
      if (msg.channelType) threads[key].channels.add(msg.channelType)
      if (!threads[key].telegramChatId && tgChatId) {
        threads[key].telegramChatId = tgChatId
      }
      if (msg.direction === "inbound" && msg.status !== "read") {
        threads[key].unreadCount++
      }
      // Update contact name from inbound (real name, not chatId)
      if (msg.direction === "inbound" && msg.from && !/^-?\d+$/.test(msg.from)) {
        threads[key].contactName = msg.from
      }
      // Update last message if this is newer
      if (new Date(msg.createdAt) > new Date(threads[key].lastMessageAt)) {
        threads[key].lastMessage = msg.body?.slice(0, 100) || ""
        threads[key].lastMessageAt = msg.createdAt
        threads[key].lastDirection = msg.direction
        threads[key].lastChannel = msg.channelType || "email"
      }
    }

    let conversations = Object.values(threads)
      .map((t: any) => ({
        ...t,
        channels: Array.from(t.channels),
        // Option-D — derive the persisted conversation id from the thread's own
        // messages. This does NOT change grouping (resolveKey is unchanged), so
        // the legacy /inbox threads stay byte-identical; we only annotate them.
        // (A contact merged from multiple SocialConversations surfaces the most
        // recent one — messages are newest-first.)
        socialConversationId: t.messages.find((m: any) => m.conversationId)?.conversationId ?? null,
      }))
      .sort((a: any, b: any) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    // Surface persisted status / assignment / snooze for threads backed by a
    // SocialConversation row. Additive: threads with no conversationId
    // (whatsapp/sms/email until Phase D-2) keep these undefined, and the legacy
    // /inbox simply ignores the extras.
    const convIds = conversations.map((c: any) => c.socialConversationId).filter(Boolean) as string[]
    if (convIds.length > 0) {
      const socialRows = await prisma.socialConversation.findMany({
        where: { id: { in: convIds }, organizationId: orgId },
        select: {
          id: true,
          status: true,
          assignedTo: true,
          snoozedUntil: true,
          folderId: true,
          tags: true,
          closeOutcome: true,
          customerStage: true,
          salesCallOutcomes: true,
          customerStageSource: true,
          customerStageConfidence: true,
          customerStageReason: true,
          aiSuggestedCustomerStage: true,
          aiCustomerStageConfidence: true,
          aiCustomerStageReason: true,
          metadata: true,
        },
      })
      type SocialState = {
        id: string
        status: string
        assignedTo: string | null
        snoozedUntil: Date | null
        folderId: string | null
        tags: string[]
        closeOutcome: string | null
        customerStage: string | null
        salesCallOutcomes: string[]
        customerStageSource: string | null
        customerStageConfidence: number | null
        customerStageReason: string | null
        aiSuggestedCustomerStage: string | null
        aiCustomerStageConfidence: number | null
        aiCustomerStageReason: string | null
        metadata: unknown
      }
      const byId = new Map<string, SocialState>(socialRows.map((r: SocialState) => [r.id, r]))
      const qualificationLeadIds = socialRows.flatMap((row: SocialState) => {
        const metadata = row.metadata && typeof row.metadata === "object"
          ? row.metadata as Record<string, unknown>
          : {}
        return typeof metadata.qualificationLeadId === "string" ? [metadata.qualificationLeadId] : []
      })
      const linkedLeads = qualificationLeadIds.length
        ? await prisma.lead.findMany({
            where: { id: { in: qualificationLeadIds }, organizationId: orgId },
            select: { id: true, assignedTo: true, createdAt: true },
          })
        : []
      const linkedAssigneeIds = [...new Set(linkedLeads.map((lead) => lead.assignedTo).filter((id): id is string => Boolean(id)))]
      const linkedAssignees = linkedAssigneeIds.length
        ? await prisma.user.findMany({
            where: { id: { in: linkedAssigneeIds }, organizationId: orgId },
            select: { id: true, name: true, email: true },
          })
        : []
      const linkedAssigneeById = new Map(linkedAssignees.map((user) => [user.id, user.name || user.email]))
      const linkedLeadById = new Map(linkedLeads.map((lead) => [lead.id, {
        id: lead.id,
        assignedTo: lead.assignedTo,
        assignedToName: lead.assignedTo ? linkedAssigneeById.get(lead.assignedTo) ?? null : null,
        createdAt: lead.createdAt,
      }]))
      conversations = conversations.map((c: any) => {
        const s: SocialState | undefined = c.socialConversationId ? byId.get(c.socialConversationId) : undefined
        const metadata = s?.metadata && typeof s.metadata === "object"
          ? s.metadata as Record<string, unknown>
          : {}
        const qualificationLeadId = typeof metadata.qualificationLeadId === "string"
          ? metadata.qualificationLeadId
          : null
        return s ? {
          ...c,
          status: s.status,
          assignedTo: s.assignedTo,
          snoozedUntil: s.snoozedUntil,
          folderId: s.folderId,
          conversationTags: s.tags,
          closeOutcome: s.closeOutcome,
          customerStage: s.customerStage,
          salesCallOutcomes: s.salesCallOutcomes,
          customerStageSource: s.customerStageSource,
          customerStageConfidence: s.customerStageConfidence,
          customerStageReason: s.customerStageReason,
          aiSuggestedCustomerStage: s.aiSuggestedCustomerStage,
          aiCustomerStageConfidence: s.aiCustomerStageConfidence,
          aiCustomerStageReason: s.aiCustomerStageReason,
          linkedLead: qualificationLeadId ? linkedLeadById.get(qualificationLeadId) ?? null : null,
        } : c
      })

      // Collaborators (model B): attach participant userIds so the client can render avatars + the
      // "Со мной" filter. Ids only here (no user join in the list query); participant names come from
      // the per-conversation GET /participants when a thread is opened.
      const participantRows = await prisma.conversationParticipant.findMany({
        where: { socialConversationId: { in: convIds }, organizationId: orgId },
        select: { socialConversationId: true, userId: true },
      })
      const partBySc = new Map<string, string[]>()
      for (const p of participantRows as { socialConversationId: string; userId: string }[]) {
        const arr = partBySc.get(p.socialConversationId) ?? []
        arr.push(p.userId)
        partBySc.set(p.socialConversationId, arr)
      }
      conversations = conversations.map((c: any) =>
        c.socialConversationId ? { ...c, participants: partBySc.get(c.socialConversationId) ?? [] } : c,
      )
    }

    // ── Web-chat: surface WebChatSessions as conversations (single-source — read directly, NOT
    // mirrored into ChannelMessage). Additive + guarded so a failure here can never break the other
    // channels. Skipped when filtering to a different channel.
    if (!channelFilter || channelFilter === "all" || channelFilter === "web-chat") {
      try {
        const sessions = await prisma.webChatSession.findMany({
          where: { organizationId: orgId },
          orderBy: { lastMessageAt: "desc" },
          take: PAGE_SIZE.INBOX,
          include: { messages: { orderBy: { createdAt: "desc" }, take: 100 } }, // cap payload on long threads
        })
        // [P2-perf] Prefetch existing inbox SocialConversations for these sessions → UPSERT only the
        // missing ones, so this isn't an upsert-per-session on every inbox load (after the first backfill
        // it's all reads). Keyed w:<sessionId>, matching the message-route + add-participant ensure.
        const sessionKeys = sessions.map((s: any) => `w:${s.id}`)
        type WebChatSocialState = {
          id: string
          externalId: string
          tags: string[]
          customerStage: string | null
          salesCallOutcomes: string[]
          customerStageSource: string | null
          customerStageConfidence: number | null
          customerStageReason: string | null
          aiSuggestedCustomerStage: string | null
          aiCustomerStageConfidence: number | null
          aiCustomerStageReason: string | null
        }
        const existingRows: WebChatSocialState[] = sessionKeys.length ? await prisma.socialConversation.findMany({
          where: { organizationId: orgId, platform: "inbox", externalId: { in: sessionKeys } },
          select: {
            id: true,
            externalId: true,
            tags: true,
            customerStage: true,
            salesCallOutcomes: true,
            customerStageSource: true,
            customerStageConfidence: true,
            customerStageReason: true,
            aiSuggestedCustomerStage: true,
            aiCustomerStageConfidence: true,
            aiCustomerStageReason: true,
          },
        }) : []
        const socialByExt = new Map<string, WebChatSocialState>(
          existingRows.map((row: WebChatSocialState) => [row.externalId, row]),
        )
        // PERF (CRITICAL): the inbox list must stay a READ. Do NOT ensure-create here — a cold start fires
        // one upsert PER session = a multi-second blocking backfill (the inbox hung ~30s on first load).
        // We only READ existing scids (prefetched above). A web-chat session ACQUIRES its scid lazily at
        // write-time (the message-route ensures on each inbound) and on-demand (add-participant ensures),
        // so «Команда»/notes light up as soon as there's activity or the agent acts — no per-load storm.
        const webChatConvos = sessions.map((s: any) => {
          const last = s.messages[0]
          const social = socialByExt.get(`w:${s.id}`)
          const scid = social?.id ?? null
          const contact = s.contactId ? contactById[s.contactId] : null
          return {
            contactId: s.contactId,
            contactName: s.visitorName || contact?.fullName || "Web visitor",
            contactEmail: s.visitorEmail || contact?.email || null,
            contactPhone: s.visitorPhone || contact?.phone || null,
            contactLifecycleStage: contact?.lifecycleStage ?? null,
            telegramChatId: null,
            lastMessage: (last?.text || "").slice(0, 100),
            lastMessageAt: s.lastMessageAt,
            lastDirection: last ? (last.fromRole === "visitor" ? "inbound" : "outbound") : null,
            lastChannel: "web-chat",
            unreadCount: 0, // web-chat read-tracking is a follow-up (no per-message read flag yet)
            messageCount: s.messages.length,
            channels: ["web-chat"],
            botHandled: s.messages.some((m: { fromRole?: string }) => m.fromRole === "bot"),
            messages: s.messages.map((m: any) => ({
              id: m.id,
              direction: m.fromRole === "visitor" ? "inbound" : "outbound",
              channelType: "web-chat",
              from: m.fromRole === "visitor" ? (s.visitorName || "Web visitor") : m.fromRole,
              to: "",
              body: m.text,
              status: "read",
              createdAt: m.createdAt,
              mediaUrl: m.attachmentUrl,
              messageType: m.attachmentType?.startsWith("image/") ? "image" : (m.attachmentUrl ? "document" : undefined),
              conversationId: null,
              // A4 — carries aiGenerated/aiQuality so the thread can badge bot messages.
              metadata: m.metadata ?? null,
            })),
            socialConversationId: scid,
            conversationTags: social?.tags ?? [],
            customerStage: social?.customerStage ?? null,
            salesCallOutcomes: social?.salesCallOutcomes ?? [],
            customerStageSource: social?.customerStageSource ?? null,
            customerStageConfidence: social?.customerStageConfidence ?? null,
            customerStageReason: social?.customerStageReason ?? null,
            aiSuggestedCustomerStage: social?.aiSuggestedCustomerStage ?? null,
            aiCustomerStageConfidence: social?.aiCustomerStageConfidence ?? null,
            aiCustomerStageReason: social?.aiCustomerStageReason ?? null,
            participants: [] as string[], // hydrated below (social-block partBySc didn't cover these scids)
            webChatSessionId: s.id,
            status: s.status === "closed" ? "resolved" : "open",
            assignedTo: s.assignedUserId ?? null,
          }
        })
        // Hydrate web-chat participants so avatars + the "Со мной" filter work for web-chat too (the
        // social-block participant-attach ran before these sessions had a scid).
        const wcScids = webChatConvos.map((c: any) => c.socialConversationId).filter(Boolean) as string[]
        if (wcScids.length) {
          const wcParts = await prisma.conversationParticipant.findMany({
            where: { socialConversationId: { in: wcScids }, organizationId: orgId },
            select: { socialConversationId: true, userId: true },
          })
          const wcPartBySc = new Map<string, string[]>()
          for (const p of wcParts as { socialConversationId: string; userId: string }[]) {
            const arr = wcPartBySc.get(p.socialConversationId) ?? []
            arr.push(p.userId)
            wcPartBySc.set(p.socialConversationId, arr)
          }
          for (const c of webChatConvos as any[]) {
            if (c.socialConversationId) c.participants = wcPartBySc.get(c.socialConversationId) ?? []
          }
        }
        conversations = [...conversations, ...webChatConvos].sort(
          (a: any, b: any) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        )
      } catch (e) {
        console.error("[inbox GET web-chat]", e)
      }
    }

    // WhatsApp Calling can create a SocialConversation + CallLog before the customer ever sends a
    // message. The legacy inbox list is message-led, so add read-only call-only conversation stubs
    // before the callLogs hydration pass below. Existing message-backed threads are left untouched.
    try {
      type CallOnlyConversationRow = {
        id: string
        conversationId: string | null
        direction: string
        fromNumber: string | null
        toNumber: string | null
        status: string
        provider: string
        startedAt: Date | null
        endedAt: Date | null
        createdAt: Date
        conversation: {
          id: string
          platform: string
          externalId: string
          contactId: string | null
          contactName: string | null
          status: string
          assignedTo: string | null
          snoozedUntil: Date | null
          folderId: string | null
          tags: string[]
          customerStage: string | null
          salesCallOutcomes: string[]
          customerStageSource: string | null
          customerStageConfidence: number | null
          customerStageReason: string | null
          aiSuggestedCustomerStage: string | null
          aiCustomerStageConfidence: number | null
          aiCustomerStageReason: string | null
          lastMessage: string | null
          lastMessageAt: Date | null
        } | null
      }
      type CallOnlyConversationStub = {
        contactId: string | null
        contactName: string
        contactEmail: string | null
        contactPhone: string | null
        contactLifecycleStage: string | null
        telegramChatId: string | null
        lastMessage: string
        lastMessageAt: Date
        lastDirection: string | null
        lastChannel: string
        unreadCount: number
        messageCount: number
        channels: string[]
        botHandled: boolean
        messages: unknown[]
        socialConversationId: string
        conversationTags: string[]
        customerStage: string | null
        salesCallOutcomes: string[]
        customerStageSource: string | null
        customerStageConfidence: number | null
        customerStageReason: string | null
        aiSuggestedCustomerStage: string | null
        aiCustomerStageConfidence: number | null
        aiCustomerStageReason: string | null
        participants: unknown[]
        status: string
        assignedTo: string | null
        snoozedUntil: Date | null
        folderId: string | null
      }
      const existingConversationIds = new Set<string>(
        conversations
          .map((c: { socialConversationId?: string | null }) => c.socialConversationId)
          .filter((id: string | null | undefined): id is string => Boolean(id)),
      )
      const callOnlyRows = await prisma.callLog.findMany({
        where: {
          organizationId: orgId,
          conversationId: { not: null },
          ...(existingConversationIds.size > 0
            ? { NOT: { conversationId: { in: Array.from(existingConversationIds) } } }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE.INBOX,
        select: {
          id: true,
          conversationId: true,
          direction: true,
          fromNumber: true,
          toNumber: true,
          status: true,
          provider: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          conversation: {
            select: {
              id: true,
              platform: true,
              externalId: true,
              contactId: true,
              contactName: true,
              status: true,
              assignedTo: true,
              snoozedUntil: true,
              folderId: true,
              tags: true,
              customerStage: true,
              salesCallOutcomes: true,
              customerStageSource: true,
              customerStageConfidence: true,
              customerStageReason: true,
              aiSuggestedCustomerStage: true,
              aiCustomerStageConfidence: true,
              aiCustomerStageReason: true,
              lastMessage: true,
              lastMessageAt: true,
            },
          },
        },
      }) as CallOnlyConversationRow[]

      const callOnlyByConversation = new Map<string, CallOnlyConversationStub>()
      for (const call of callOnlyRows) {
        if (!call.conversationId || existingConversationIds.has(call.conversationId) || !call.conversation) continue
        const conv = call.conversation
        const customerPhone = conv.platform === "whatsapp"
          ? conv.externalId
          : (call.direction === "inbound" ? call.fromNumber : call.toNumber)
        const previous = callOnlyByConversation.get(call.conversationId)
        const callAt = call.createdAt ?? call.startedAt ?? call.endedAt ?? conv.lastMessageAt ?? new Date(0)
        const lastMessageAt = previous
          ? new Date(Math.max(new Date(previous.lastMessageAt).getTime(), new Date(callAt).getTime()))
          : new Date(callAt)
        callOnlyByConversation.set(call.conversationId, {
          contactId: conv.contactId,
          contactName: conv.contactName || customerPhone || "WhatsApp caller",
          contactEmail: null,
          contactPhone: customerPhone || null,
          contactLifecycleStage: null,
          telegramChatId: null,
          lastMessage: conv.lastMessage || `WhatsApp call · ${call.status}`,
          lastMessageAt,
          lastDirection: call.direction,
          lastChannel: conv.platform || "whatsapp",
          unreadCount: 0,
          messageCount: 0,
          channels: [conv.platform || "whatsapp"],
          botHandled: false,
          messages: [],
          socialConversationId: conv.id,
          conversationTags: conv.tags ?? [],
          customerStage: conv.customerStage,
          salesCallOutcomes: conv.salesCallOutcomes,
          customerStageSource: conv.customerStageSource,
          customerStageConfidence: conv.customerStageConfidence,
          customerStageReason: conv.customerStageReason,
          aiSuggestedCustomerStage: conv.aiSuggestedCustomerStage,
          aiCustomerStageConfidence: conv.aiCustomerStageConfidence,
          aiCustomerStageReason: conv.aiCustomerStageReason,
          participants: [],
          status: conv.status,
          assignedTo: conv.assignedTo,
          snoozedUntil: conv.snoozedUntil,
          folderId: conv.folderId,
        })
      }

      if (callOnlyByConversation.size > 0) {
        conversations = [...conversations, ...Array.from(callOnlyByConversation.values())].sort(
          (a: { lastMessageAt: Date | string }, b: { lastMessageAt: Date | string }) =>
            new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        )
      }
    } catch (e) {
      console.error("[inbox GET call-only conversations]", e)
    }

    // E4.2 — bridge VoIP call logs into the inbox payload so the thread can render
    // call events inline without introducing a new ChannelEvent table yet. This is
    // org-scoped and read-only; calls are only created by the explicit click-to-call route.
    const callConvIds = Array.from(new Set(
      conversations.map((c: { socialConversationId?: string | null }) => c.socialConversationId).filter(Boolean) as string[],
    ))
    if (callConvIds.length > 0) {
      const callRows = await prisma.callLog.findMany({
        where: { organizationId: orgId, conversationId: { in: callConvIds } },
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE.INBOX,
        select: {
          id: true,
          conversationId: true,
          direction: true,
          fromNumber: true,
          toNumber: true,
          status: true,
          duration: true,
          provider: true,
          recordingUrl: true,
          transcription: true,
          insightsAt: true,
          notes: true,
          providerOutcome: true,
          providerDialStatus: true,
          providerHangupCause: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
        },
      })
      const safeCallRows = callRows.map(exposeCallForClient)
      type ConversationWithCalls = { socialConversationId?: string | null; callLogs?: typeof safeCallRows }
      const callsByConversation = new Map<string, typeof safeCallRows>()
      for (const call of safeCallRows) {
        if (!call.conversationId) continue
        const arr = callsByConversation.get(call.conversationId) ?? []
        arr.push(call)
        callsByConversation.set(call.conversationId, arr)
      }
      conversations = conversations.map((c: ConversationWithCalls) => (
        c.socialConversationId
          ? { ...c, callLogs: callsByConversation.get(c.socialConversationId) ?? [] }
          : c
      ))
    }

    // Deleted conversations. This listing is built from MESSAGES and only
    // enriched from the conversation row, so a soft-deleted conversation keeps
    // its messages here and would stay on screen — the delete would look like
    // it had done nothing at all. Filtering happens last because web-chat and
    // call-only threads are appended above.
    //
    // Bounded by the page: the trash therefore shows what was deleted from the
    // recent window, which is the case it exists for — undoing a mistake made
    // moments ago. Older deleted threads stay deleted and out of reach here.
    const pageConvIds = conversations
      .map((c: { socialConversationId?: string | null }) => c.socialConversationId)
      .filter(Boolean) as string[]
    const deletedIds = new Set(
      pageConvIds.length
        ? (await prisma.socialConversation.findMany({
            where: { id: { in: pageConvIds }, organizationId: orgId, deletedAt: { not: null } },
            select: { id: true },
          })).map((row) => row.id)
        : [],
    )
    const isDeleted = (c: { socialConversationId?: string | null }) =>
      !!c.socialConversationId && deletedIds.has(c.socialConversationId)
    conversations = trashView ? conversations.filter(isDeleted) : conversations.filter((c) => !isDeleted(c))

    // Stats
    const totalMessages = messages.length
    const inboundCount = messages.filter((m: any) => m.direction === "inbound").length
    const outboundCount = messages.filter((m: any) => m.direction === "outbound").length

    return NextResponse.json({
      success: true,
      data: {
        conversations,
        stats: {
          totalMessages,
          inbound: inboundCount,
          outbound: outboundCount,
          conversations: conversations.length,
        },
      },
    })
  } catch (e) {
    console.error("[inbox GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const sendMessageSchema = z.object({
  to: z.string().min(1),
  body: z.string().default(""),
  subject: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(), // set when sending from a lead card (Slice 3b lead timeline)
  channel: z.enum(["email", "telegram", "sms", "whatsapp", "tiktok", "web-chat"]).default("email"),
  // Media SEND (Slice 3b): the /uploads/inbox/<org>/ URL the composer uploaded; validated + read
  // server-side (org from session, never trusted as a path). WhatsApp/Telegram only.
  attachmentUrl: z.string().optional(),
  conversationId: z.string().nullable().optional(),
  // Required only for Chatwoot/TikTok. The server fixes the namespace to
  // `manual`; callers may supply only a bounded RFC UUID.
  deliveryIdempotencyKey: z.string().uuid().optional(),
}).refine((d) => d.body.trim().length > 0 || !!d.attachmentUrl, {
  message: "Message text or an attachment is required",
})

export const POST = withInboxSessionWrite(async (req, authSession) => {
  const orgId = authSession.orgId
  const body = await req.json()
  const parsed = sendMessageSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const {
    to,
    body: msgBody,
    subject,
    contactId: rawContactId,
    leadId: rawLeadId,
    channel,
    attachmentUrl,
    conversationId: rawConversationId,
    deliveryIdempotencyKey,
  } = parsed.data
  if (channel === "tiktok" && !deliveryIdempotencyKey) {
    return NextResponse.json({ error: "A delivery idempotency key is required for TikTok replies" }, { status: 400 })
  }
  // Drop any client-supplied lead/contact id that isn't in this org (forged-ref guard).
  const owned = await sanitizeOwnedRefs(orgId, {
    contactId: rawContactId,
    leadId: rawLeadId,
    conversationId: rawConversationId,
  })
  if (rawConversationId && !owned.conversationId) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
  }
  const conversationId = owned.conversationId
  const leadId = owned.leadId

  // Chatwoot's transport recipient is a server-owned property of the selected
  // tenant conversation. Never let a browser pair conversation A's local id
  // (and ledger/audit trail) with conversation B's external Chatwoot id.
  let replyTo = to
  let boundChannelConfigId: string | null | undefined
  if (channel === "tiktok") {
    if (!conversationId) {
      return NextResponse.json({ error: "A TikTok conversation is required" }, { status: 400 })
    }
    const boundConversation = await prisma.socialConversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        platform: "tiktok",
        deletedAt: null,
      },
      select: { externalId: true, channelConfigId: true },
    })
    if (!boundConversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }
    replyTo = boundConversation.externalId
    boundChannelConfigId = boundConversation.channelConfigId
  }

  // Web-chat reply: single-source — write a WebChatMessage(agent) into the session (the visitor's
  // widget polls WebChatMessage), NOT a ChannelMessage. `to` carries the WebChatSession id. Text only
  // in this slice (agent-side attachments to web-chat are a follow-up).
  if (channel === "web-chat") {
    if (!msgBody.trim()) return NextResponse.json({ error: "Message text required" }, { status: 400 })
    const session = await prisma.webChatSession.findFirst({ where: { id: to, organizationId: orgId } })
    if (!session) return NextResponse.json({ error: "Web chat session not found" }, { status: 404 })
    const message = await prisma.webChatMessage.create({
      data: {
        organizationId: orgId,
        sessionId: to,
        fromRole: "agent",
        authorUserId: authSession.userId,
        text: msgBody.trim(),
        metadata: {
          authorType: "operator",
          authorUserId: authSession.userId,
          authorName: authSession.name || authSession.email,
          sentVia: "leaddrive_inbox",
          sentOnBehalfOfCompany: true,
        },
      },
    })
    await prisma.webChatSession.update({
      where: { id: to },
      data: { lastMessageAt: new Date(), assignedUserId: session.assignedUserId || authSession.userId },
    })
    const shell = await ensureConversation(orgId, {
      channel: "web-chat",
      webChatSessionId: session.id,
      contactId: session.contactId,
      contactName: session.visitorName || "Web visitor",
    })
    await markMarketingContacted(prisma, {
      organizationId: orgId,
      conversationId: shell.id,
      changedBy: authSession.userId,
    }).catch((error: unknown) =>
      console.error("[web-chat customer stage] mark contacted failed:", error),
    )
    return NextResponse.json({ success: true, data: { id: message.id } })
  }

  // Auto-resolve contactId if not provided. Skip when a leadId is supplied
  // (message belongs to a lead — don't mis-attach to a contact that happens to
  // share the email/phone).
  let contactId = owned.contactId
  if (!contactId && !leadId) {
    let contact = null
    if (channel === "email" && to.includes("@")) {
      contact = await prisma.contact.findFirst({
        where: { organizationId: orgId, email: { equals: to, mode: "insensitive" } },
        select: { id: true },
      })
    } else if (channel === "sms" && to) {
      contact = await prisma.contact.findFirst({
        where: { organizationId: orgId, phone: to },
        select: { id: true },
      })
    } else if (channel === "whatsapp" && to) {
      const cleanPhone = to.replace(/[\s\-()+ ]/g, "")
      contact = await prisma.contact.findFirst({
        where: {
          organizationId: orgId,
          OR: [
            { phone: to },
            { phone: `+${cleanPhone}` },
            { phone: { contains: cleanPhone.slice(-9) } },
          ],
        },
        select: { id: true },
      })
    } else if (channel === "telegram" && /^-?\d+$/.test(to)) {
      // Find a previous message with this chatId that has a contactId
      const prev = await prisma.channelMessage.findFirst({
        where: {
          organizationId: orgId,
          channelType: "telegram",
          contactId: { not: null },
          metadata: { path: ["chatId"], equals: to },
        },
        select: { contactId: true },
      })
      if (prev?.contactId) contactId = prev.contactId
    }
    if (contact) contactId = contact.id
  }

  // Media SEND (Slice 3b): securely resolve the previously-uploaded attachment (org from session,
  // never trust the client URL as a path). Only WhatsApp + Telegram deliver media in this slice.
  const attachment = attachmentUrl ? await readInboxAttachment(attachmentUrl, orgId) : null
  if (attachmentUrl) {
    if (!attachment) return NextResponse.json({ error: "Invalid or missing attachment" }, { status: 400 })
    if (channel !== "whatsapp" && channel !== "telegram") {
      return NextResponse.json({ error: "Attachments are supported on WhatsApp and Telegram only" }, { status: 400 })
    }
  }

  const result = await sendConversationReply({
    organizationId: orgId,
    channel,
    to: replyTo,
    body: msgBody,
    subject,
    contactId,
    leadId,
    conversationId,
    channelConfigId: boundChannelConfigId,
    attachment: attachment ? { ...attachment, url: attachmentUrl! } : null,
    telegramParseMode: "HTML",
    deliveryIdempotency: deliveryIdempotencyKey
      ? { source: "manual", key: deliveryIdempotencyKey }
      : undefined,
    extraMetadata: {
      authorType: "operator",
      authorUserId: authSession.userId,
      authorName: authSession.name || authSession.email || null,
    },
  })
  if (!result.success) {
    if (result.deliveryUnknown) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          deliveryUnknown: true,
          ...(result.attemptId ? { attemptId: result.attemptId } : {}),
        },
        { status: result.statusCode },
      )
    }
    return NextResponse.json(
      result.internal || result.statusCode === 400 ? { error: result.error } : { success: false, error: result.error },
      { status: result.statusCode },
    )
  }
  if (conversationId) {
    await markMarketingContacted(prisma, {
      organizationId: orgId,
      conversationId,
      changedBy: authSession.userId,
    }).catch((error: unknown) => console.error("[inbox customer stage] mark contacted failed:", error))
  }
  return NextResponse.json({ success: true, data: result.data }, { status: result.statusCode })
})

// Mark messages as read
export const PATCH = withInboxSessionWrite(async (req, authSession) => {
  const orgId = authSession.orgId
  const body = await req.json()
  const { messageIds } = body

  if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: "messageIds required" }, { status: 400 })
  }

  try {
    await prisma.channelMessage.updateMany({
      where: {
        id: { in: messageIds },
        organizationId: orgId,
        direction: "inbound",
      },
      data: { status: "read" },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// Delete conversation (all messages by IDs)
export const DELETE = withInboxSessionWrite(async (req, authSession) => {
  // The inbox permission model intentionally exposes read/write only. This
  // legacy HTTP DELETE is therefore an inbox write, not a separate delete
  // entitlement (otherwise no non-admin inbox operator could use it).
  const orgId = authSession.orgId
  const body = await req.json()
  const { messageIds } = body

  if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: "messageIds required" }, { status: 400 })
  }

  try {
    await prisma.channelMessage.deleteMany({
      where: {
        id: { in: messageIds },
        organizationId: orgId,
      },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
