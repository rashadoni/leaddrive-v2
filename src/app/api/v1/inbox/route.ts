import { isPhoneRestrictedPrincipal } from "@/lib/customer-phone-privacy"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { accessibleCallWhere, exposeCallForClient } from "@/lib/calls/access"
import type { Role } from "@/lib/permissions"
import { isContactLinkablePlatform } from "@/lib/inbox/contact-link"
import { summarizeThreadConversations, type ThreadConversationSummary } from "@/lib/inbox/thread-conversations"
import { readInboxAttachment } from "@/lib/inbox-attachment"
import { sanitizeOwnedRefs } from "@/lib/verify-owned-refs"
import { sendConversationReply, type SendConversationReplyOptions } from "@/lib/inbox/send-conversation-reply"
import { privateReplyAvailable, storedInstagramComment } from "@/lib/social/instagram-comments"
import { PAGE_SIZE } from "@/lib/constants"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { markMarketingContacted } from "@/lib/inbox/customer-stage"
import { whatsappThreadReplyBinding } from "@/lib/inbox/whatsapp-reply-channel"
import { attachInboxChannelAccounts, channelAccountOf, INBOX_ACCOUNT_CHANNEL_TYPES, type InboxChannelAccount } from "@/lib/inbox/conversation-channel"
import { channelVisible, conversationAccessDenial, hiddenChannelIdsFor, visibleChannelWhere } from "@/lib/inbox/channel-access"
import { loadQuietThreads, type QuietThreadScope } from "@/lib/inbox/assignee-conversations"
import { NOT_HANDED_OVER_MESSAGE_TYPES } from "@/lib/whatsapp-message-text"

export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const { orgId } = auth
  const { searchParams } = new URL(req.url)
  const channelFilter = searchParams.get("channel") // email, telegram, sms, whatsapp
  // The trash is a view over the same listing, not a separate store.
  const trashView = searchParams.get("view") === "trash"
  // «Ответственный» in the filters: the list as it is, plus this person's open conversations that
  // are older than the list's window (lib/inbox/assignee-conversations). The screen does the narrowing.
  const assigneeId = searchParams.get("assignee")?.trim() || null
  let assigneeMore = false

  try {
    const where: any = { organizationId: orgId }
    // Numbers and pages an admin hid from this person (lib/inbox/channel-access): their messages
    // are never read, so no thread, preview or counter is built from them.
    const hiddenChannels = await hiddenChannelIdsFor(auth)
    const visibleChannels = visibleChannelWhere(hiddenChannels)
    if (visibleChannels) where.AND = [visibleChannels]
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

    // Conversations in the trash. Their messages leave the listing BEFORE grouping, so a customer whose
    // WhatsApp was deleted keeps his live Instagram in the list (and the reverse) instead of the whole
    // merged thread following whichever channel wrote last. The trash holds only the deleted ones.
    const messageConversationIds = [...new Set(messages.map((m: { conversationId: string | null }) => m.conversationId).filter((id: string | null): id is string => Boolean(id)))]
    const messageConversationRows: Array<{ id: string; platform: string; contactId: string | null; deletedAt: Date | null }> =
      messageConversationIds.length
        ? (await prisma.socialConversation.findMany({
            where: { id: { in: messageConversationIds }, organizationId: orgId },
            select: { id: true, platform: true, contactId: true, deletedAt: true },
          })) ?? []
        : []
    const deletedMessageConversationIds = new Set<string>(
      messageConversationRows.filter((row) => row.deletedAt).map((row) => row.id),
    )

    // Instagram and Messenger carry no customer identity of their own, so their conversation says whose
    // they are: a manager tied it to a customer («Bu eyni müştəridir», lib/inbox/contact-link) or nobody.
    // That decides the thread for every message of the conversation, whatever a single row says — so
    // «Ayır» puts back exactly what was there before. Only a customer of this org counts.
    const conversationContact = new Map<string, string | null>()
    for (const row of messageConversationRows) {
      if (!isContactLinkablePlatform(row.platform)) continue
      conversationContact.set(row.id, row.contactId && contactById[row.contactId] ? row.contactId : null)
    }
    const messageContactId = (msg: typeof messages[0]): string | null =>
      msg.conversationId && conversationContact.has(msg.conversationId)
        ? conversationContact.get(msg.conversationId) ?? null
        : msg.contactId

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

      // Native TikTok threads retain their account/conversation binding even after contact linking.
      if (msg.channelType === "tiktok" && meta?.provider === "tiktok_messaging" && msg.conversationId) {
        return `tiktok_native_${msg.conversationId}`
      }

      // If message already has contactId, use it (an Instagram/Messenger message: its conversation's)
      const contactId = messageContactId(msg)
      if (contactId) return `contact_${contactId}`

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
    // Threads that lost messages to the trash above (see deletedMessageConversationIds).
    const strippedThreadKeys = new Set<string>()

    for (const msg of messages) {
      const key = resolveKey(msg)
      const meta = msg.metadata as any
      const tgChatId = meta?.chatId as string | undefined

      if (!trashView && msg.conversationId && deletedMessageConversationIds.has(msg.conversationId)) {
        strippedThreadKeys.add(key)
        continue
      }
      // The trash is the deleted half: a customer's live channel stays in the list, not in here.
      if (trashView && msg.conversationId && !deletedMessageConversationIds.has(msg.conversationId)) continue

      if (!threads[key]) {
        // Resolve contact info from key
        let contactId: string | null = null
        let contactName = msg.direction === "inbound" ? msg.from : msg.to
        let contactEmail: string | null = null
        let contactPhone: string | null = null
        let contactLifecycleStage: string | null = null

        if (key.startsWith("contact_") || (msg.channelType === "tiktok" && meta?.provider === "tiktok_messaging" && msg.contactId)) {
          contactId = key.startsWith("contact_") ? key.replace("contact_", "") : msg.contactId
          const c = contactId ? contactById[contactId] : undefined
          if (c) {
            contactName = c.fullName || contactName
            contactEmail = c.email
            contactPhone = c.phone
            contactLifecycleStage = c.lifecycleStage
          }
        }

        threads[key] = {
          threadKey: key,
          contactId,
          contactName,
          contactEmail,
          contactPhone,
          contactLifecycleStage,
          telegramChatId: tgChatId || null,
          lastMessage: msg.body?.slice(0, 100) || "",
          lastMessageAt: msg.createdAt,
          lastDirection: msg.direction,
          // The newest message came with the WhatsApp Business app's history — not one that waits for us.
          lastFromHistory: Boolean(msg.historyImportedAt),
          lastChannel: msg.channelType || "email",
          // An Instagram comment (lib/inbox/instagram-comment-ingest): the row's «Şərh» mark and the
          // «Şərhlər» view.
          lastIsComment: Boolean(meta?.igComment),
          hasComment: false,
          unreadCount: 0,
          messageCount: 0,
          channels: new Set<string>(),
          messages: [],
          botHandled: false,
        }
      }

      threads[key].messages.push(msg)
      threads[key].messageCount++
      if (msg.direction === "inbound" && meta?.igComment) threads[key].hasComment = true
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
      if (msg.direction === "inbound" && meta?.provider === "tiktok_messaging" && typeof meta.senderName === "string") {
        threads[key].contactName = meta.senderName
      }
      // Update last message if this is newer
      if (new Date(msg.createdAt) > new Date(threads[key].lastMessageAt)) {
        threads[key].lastMessage = msg.body?.slice(0, 100) || ""
        threads[key].lastMessageAt = msg.createdAt
        threads[key].lastDirection = msg.direction
        threads[key].lastFromHistory = Boolean(msg.historyImportedAt)
        threads[key].lastIsComment = Boolean(meta?.igComment)
        threads[key].lastChannel = msg.channelType || "email"
      }
    }

    let conversations = Object.values(threads)
      // A thread made only of what was left of a deleted conversation (old rows without a conversation)
      // stays deleted, as it was before the trash was filtered per conversation.
      .filter((t: any) => !strippedThreadKeys.has(t.threadKey) || t.messages.some((m: any) => m.conversationId))
      .map((t: any) => {
        // Every stored conversation of this customer's thread — one per channel — so the screen can
        // reply through the right one and act on all of them (lib/inbox/thread-conversations).
        const threadConversations = summarizeThreadConversations(t.messages)
        return {
          ...t,
          channels: Array.from(t.channels),
          ...whatsappThreadReplyBinding(t.messages),
          // Messages are newest-first. A WhatsApp thread may contain an unbound
          // message from B followed by a canonical conversation from A; do not
          // expose A as the reply target for that merged contact thread.
          socialConversationId: t.lastChannel === "whatsapp" && whatsappThreadReplyBinding(t.messages).whatsappReplyBlocked
            ? null : t.messages.find((m: any) => m.conversationId)?.conversationId ?? null,
          threadConversations,
        }
      })
      .sort((a: any, b: any) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

    // Surface persisted status / assignment / snooze for threads backed by a
    // SocialConversation row. Additive: threads with no conversationId
    // (whatsapp/sms/email until Phase D-2) keep these undefined, and the legacy
    // /inbox simply ignores the extras.
    // Every conversation of every thread: the thread shows its primary one's state, and each channel
    // of a merged customer thread carries its own (status, assignee, link) for the channel switcher.
    const convIds = [...new Set(conversations.flatMap((c: any) => [
      c.socialConversationId,
      ...((c.threadConversations ?? []) as ThreadConversationSummary[]).map((tc) => tc.id),
    ]).filter(Boolean))] as string[]
    if (convIds.length > 0) {
      const socialRows = await prisma.socialConversation.findMany({
        where: { id: { in: convIds }, organizationId: orgId },
        select: {
          id: true,
          platform: true,
          contactId: true,
          contactName: true,
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
          adSourceType: true,
          adSourceId: true,
          adHeadline: true,
          adReferralAt: true,
          metadata: true,
        },
      })
      type SocialState = {
        id: string
        platform: string
        contactId: string | null
        contactName: string | null
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
        adSourceType: string | null
        adSourceId: string | null
        adHeadline: string | null
        adReferralAt: Date | null
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
        // Instagram/Messenger/VK messages carry only the opaque sender id (IGSID/PSID/peer id) in
        // `from`, so a thread with no CRM contact shows a 16-digit number. The webhook stores the
        // resolved @username / name on the conversation (lib/social/meta-sender-profile) — show it.
        const storedName = s?.contactName?.trim()
        const showStoredName = !c.contactId && typeof c.contactName === "string"
          && /^-?\d+$/.test(c.contactName) && !!storedName && !/^-?\d+$/.test(storedName)
        const threadConversations = ((c.threadConversations ?? []) as ThreadConversationSummary[]).map((tc) => {
          const row = byId.get(tc.id)
          if (!row) return tc
          const name = row.contactName?.trim()
          return {
            ...tc,
            status: row.status,
            assignedTo: row.assignedTo,
            snoozedUntil: row.snoozedUntil,
            // The @username / page name of an Instagram or Messenger sender, for the channel switcher.
            customerHandle: name && !/^-?\d+$/.test(name) ? name : null,
            // Tied to a CRM customer by a manager («Bu eyni müştəridir») — the screen offers «Ayır».
            contactLinked: isContactLinkablePlatform(row.platform) && !!row.contactId,
          }
        })
        if (!s) return { ...c, threadConversations }
        return {
          ...c,
          threadConversations,
          ...(showStoredName ? { contactName: storedName } : {}),
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
          // Which ad brought the chat, when one did (Click-to-WhatsApp).
          adSourceType: s.adSourceType,
          adSourceId: s.adSourceId,
          adHeadline: s.adHeadline,
          adReferralAt: s.adReferralAt,
          linkedLead: qualificationLeadId ? linkedLeadById.get(qualificationLeadId) ?? null : null,
          // Came over with the WhatsApp Business app's history (lib/whatsapp-history-import).
          historyImport: metadata.historyImport === true,
        }
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
          channelConfigId: string | null
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
          deletedAt: Date | null
        } | null
      }
      type CallOnlyConversationStub = {
        channelConfigId: string | null
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
      // Every conversation a thread already holds — not only its primary one — and those whose messages
      // went to the trash, so neither comes back here as a separate call-only row.
      const existingConversationIds = new Set<string>([
        ...conversations.flatMap((c: { socialConversationId?: string | null; threadConversations?: ThreadConversationSummary[] }) => [
          c.socialConversationId,
          ...(c.threadConversations ?? []).map((tc) => tc.id),
        ]).filter((id: string | null | undefined): id is string => Boolean(id)),
        ...deletedMessageConversationIds,
      ])
      const callOnlyRows = await prisma.callLog.findMany({
        where: {
          organizationId: orgId,
          conversationId: { not: null },
          ...(visibleChannels ? { conversation: visibleChannels } : {}),
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
              // A call that arrived before any message is still a thread on one of our numbers.
              channelConfigId: true,
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
              deletedAt: true,
            },
          },
        },
      }) as CallOnlyConversationRow[]
      const deletedCallOnlyIds = new Set(callOnlyRows
        .filter((row) => row.conversation?.deletedAt && row.conversationId)
        .map((row) => row.conversationId as string))

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
          channelConfigId: conv.channelConfigId,
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

      // A call-only conversation of a customer who already has a thread (he wrote on Instagram, then
      // called on WhatsApp) joins that thread: its calls belong in his one feed, not in a second row.
      const threadByContact = new Map<string, { threadConversations?: unknown[] }>()
      for (const c of conversations as Array<{ contactId?: string | null; webChatSessionId?: string; threadConversations?: unknown[] }>) {
        if (c.contactId && !c.webChatSessionId && Array.isArray(c.threadConversations) && !threadByContact.has(c.contactId)) {
          threadByContact.set(c.contactId, c)
        }
      }
      for (const [conversationId, stub] of [...callOnlyByConversation.entries()]) {
        const thread = stub.contactId ? threadByContact.get(stub.contactId) : undefined
        // A deleted one stays a row of its own, for the trash filter below to judge.
        if (!thread || trashView || deletedCallOnlyIds.has(conversationId)) continue
        const at = new Date(stub.lastMessageAt).toISOString()
        thread.threadConversations = [...(thread.threadConversations ?? []), {
          key: `${conversationId}|${stub.lastChannel}`,
          id: conversationId,
          platform: stub.lastChannel,
          channelConfigId: stub.channelConfigId,
          lastMessageAt: at,
          lastInboundAt: null,
          messageCount: 0,
          unreadCount: 0,
          status: stub.status,
          assignedTo: stub.assignedTo,
          snoozedUntil: stub.snoozedUntil,
          customerHandle: null,
          contactLinked: false,
        }]
        callOnlyByConversation.delete(conversationId)
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

    // One person's conversations (the «Ответственный» filter). The listing above is the organization's
    // newest messages, so a conversation nobody wrote in lately is not in it — and «all of Leyla's
    // conversations» would silently be only her recent ones. Her open conversations the window missed
    // are added from the conversation rows, without messages; opening one reads its history.
    //
    // Without that filter, the same for the conversations a WhatsApp history import wrote: months of
    // them arrive at once with their own old dates, and the window would hold only the newest few of
    // what the import screen counts. Read only where a number has imported history at all, so an
    // organization without an import keeps the list exactly as it was.
    let quietScope: QuietThreadScope | null = assigneeId && !trashView ? { assigneeId } : null
    if (!assigneeId && !trashView) {
      try {
        const imported: Array<{ channelConfigId: string }> = await prisma.whatsAppHistoryChunk.groupBy({
          by: ["channelConfigId"],
          where: { organizationId: orgId, kind: "history" },
        })
        if (imported.length > 0) quietScope = { historyImportChannelIds: imported.map((row) => row.channelConfigId) }
      } catch (e) {
        console.error("[inbox GET imported conversations]", e)
      }
    }
    if (quietScope) {
      try {
        const known = new Set<string>([
          ...conversations.flatMap((c: { socialConversationId?: string | null; threadConversations?: ThreadConversationSummary[] }) => [
            c.socialConversationId,
            ...(c.threadConversations ?? []).map((tc) => tc.id),
          ]).filter((id: string | null | undefined): id is string => Boolean(id)),
          ...deletedMessageConversationIds,
        ])
        const quiet = await loadQuietThreads({
          organizationId: orgId,
          scope: quietScope,
          channel: channelFilter,
          visibleChannels,
          knownConversationIds: known,
          contactById,
        })
        if (assigneeId) assigneeMore = quiet.more
        // A customer who already has a thread in the list keeps one row: his older conversation joins
        // it as one more of his channels, the same way a call-only conversation does above.
        const threadOfContact = new Map<string, { threadConversations?: unknown[] }>()
        for (const c of conversations as Array<{ contactId?: string | null; webChatSessionId?: string; threadConversations?: unknown[] }>) {
          if (c.contactId && !c.webChatSessionId && Array.isArray(c.threadConversations) && !threadOfContact.has(c.contactId)) {
            threadOfContact.set(c.contactId, c)
          }
        }
        const own: typeof quiet.threads = []
        for (const stub of quiet.threads) {
          const thread = stub.contactId ? threadOfContact.get(stub.contactId) : undefined
          if (!thread) { own.push(stub); continue }
          thread.threadConversations = [...(thread.threadConversations ?? []), {
            key: `${stub.socialConversationId}|${stub.lastChannel}`,
            id: stub.socialConversationId,
            platform: stub.lastChannel,
            channelConfigId: stub.channelConfigId,
            lastMessageAt: new Date(stub.lastMessageAt).toISOString(),
            lastInboundAt: null,
            messageCount: 0,
            unreadCount: 0,
            status: stub.status,
            assignedTo: stub.assignedTo,
            snoozedUntil: stub.snoozedUntil,
            customerHandle: null,
            contactLinked: false,
          }]
        }
        if (own.length > 0) {
          conversations = [...conversations, ...own].sort(
            (a: { lastMessageAt: Date | string }, b: { lastMessageAt: Date | string }) =>
              new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
          )
        }
      } catch (e) {
        // Additive: without these rows the list is what it was, never a failed inbox.
        console.error("[inbox GET quiet conversations]", e)
      }
    }

    // A conversation the WhatsApp history import made that holds nothing but what WhatsApp did not hand
    // over («Kanalın ötürmədiyi mesaj» — calls, polls, view-once photos) is not shown: on 16.11.2026 that
    // was half of the 348 imported, a list of rows that say nothing (owner: «Да, убери»). One real
    // message in it — imported or live — and it is a conversation again. Opening the customer still
    // reads all of it; the address book keeps the contact.
    try {
      type ImportedRow = { historyImport?: boolean; socialConversationId?: string | null; threadConversations?: unknown[] }
      const importedIds = [...new Set((conversations as ImportedRow[])
        .filter((c) => c.historyImport && c.socialConversationId)
        .map((c) => c.socialConversationId as string))]
      if (importedIds.length > 0) {
        const readable: Array<{ conversationId: string | null }> = await prisma.channelMessage.groupBy({
          by: ["conversationId"],
          where: { organizationId: orgId, conversationId: { in: importedIds }, messageType: { notIn: NOT_HANDED_OVER_MESSAGE_TYPES } },
        })
        const withWords = new Set(readable.map((row) => row.conversationId))
        conversations = conversations.filter((c: ImportedRow) =>
          !(c.historyImport && c.socialConversationId && !withWords.has(c.socialConversationId) && (c.threadConversations?.length ?? 0) <= 1))
      }
    } catch (e) {
      // Additive: without it the list shows those rows too, never a failed inbox.
      console.error("[inbox GET imported without words]", e)
    }

    // E4.2 — bridge VoIP call logs into the inbox payload so the thread can render
    // call events inline without introducing a new ChannelEvent table yet. This is
    // org-scoped and read-only; calls are only created by the explicit click-to-call route.
    type ThreadCallTarget = { socialConversationId?: string | null; threadConversations?: Array<{ id: string }>; contactId?: string | null; webChatSessionId?: string }
    const threadCallConversationIds = (c: ThreadCallTarget): string[] =>
      [...new Set([c.socialConversationId, ...(c.threadConversations ?? []).map((tc) => tc.id)].filter((id): id is string => Boolean(id)))]
    const callConvIds = Array.from(new Set(conversations.flatMap((c: ThreadCallTarget) => threadCallConversationIds(c))))
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
      conversations = conversations.map((c: ConversationWithCalls & ThreadCallTarget) => (
        c.socialConversationId || c.threadConversations?.length
          ? { ...c, callLogs: threadCallConversationIds(c).flatMap((id) => callsByConversation.get(id) ?? []) }
          : c
      ))
    }

    // Calls to and from the customer that belong to no conversation (a phone line, click-to-call from
    // his card) are part of his one feed too. Read under the same rule as the calls screen
    // (accessibleCallWhere) and the person's hidden numbers, so the inbox shows no call it would not.
    try {
      const customerThreads = conversations.filter((c: ThreadCallTarget) => c.contactId && !c.webChatSessionId)
      const customerIds = [...new Set(customerThreads.map((c: ThreadCallTarget) => c.contactId as string))]
      if (customerIds.length > 0) {
        const visibleCalls = visibleChannelWhere(hiddenChannels)
        const contactCallRows = await prisma.callLog.findMany({
          where: {
            AND: [
              { organizationId: orgId, contactId: { in: customerIds }, conversationId: null },
              accessibleCallWhere(auth.role as Role, auth.userId),
              ...(visibleCalls ? [visibleCalls] : []),
            ],
          },
          orderBy: { createdAt: "desc" },
          take: PAGE_SIZE.INBOX,
          select: {
            id: true,
            conversationId: true,
            contactId: true,
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
        const callsByContact = new Map<string, Array<ReturnType<typeof exposeCallForClient>>>()
        for (const row of contactCallRows ?? []) {
          const arr = callsByContact.get(row.contactId as string) ?? []
          arr.push(exposeCallForClient(row))
          callsByContact.set(row.contactId as string, arr)
        }
        if (callsByContact.size > 0) {
          conversations = conversations.map((c: ThreadCallTarget & { callLogs?: unknown[] }) => {
            const extra = c.contactId && !c.webChatSessionId ? callsByContact.get(c.contactId) : undefined
            return extra?.length ? { ...c, callLogs: [...(c.callLogs ?? []), ...extra] } : c
          })
        }
      }
    } catch (e) {
      // Additive: a customer thread without these calls is the feed as it was.
      console.error("[inbox GET customer calls]", e)
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

    // Which of our accounts each thread reached, and which address the customer writes from. Read
    // from the messages' own `channelConfigId` — one field for every platform — so a workspace with
    // three WhatsApp numbers can tell its conversations apart (lib/inbox/conversation-channel).
    try {
      conversations = await attachInboxChannelAccounts(conversations, (ids) =>
        prisma.channelConfig.findMany({
          where: { id: { in: ids }, organizationId: orgId },
          // Exactly the columns the card prints. Credentials (accessToken, appSecret, verifyToken)
          // must never ride along with a conversation listing.
          select: {
            id: true,
            channelType: true,
            configName: true,
            displayName: true,
            phoneNumber: true,
            settings: true,
          },
        }),
      )
    } catch (e) {
      // Additive: a thread without this line is the screen as it was, never a failed inbox.
      console.error("[inbox GET channel accounts]", e)
    }

    // Every live number and page of the workspace, for the rail: with several of one platform it
    // lists them one by one, so a conversation can be found by the number it reached.
    let channels: InboxChannelAccount[] = []
    try {
      const rows = await prisma.channelConfig.findMany({
        where: { organizationId: orgId, isActive: true, channelType: { in: [...INBOX_ACCOUNT_CHANNEL_TYPES] } },
        // The same label columns as above — never credentials.
        select: {
          id: true,
          channelType: true,
          configName: true,
          displayName: true,
          phoneNumber: true,
          settings: true,
        },
        orderBy: { createdAt: "asc" },
      })
      channels = rows.map(channelAccountOf)
    } catch (e) {
      console.error("[inbox GET channels]", e)
    }

    // A thread whose latest channel is hidden — a call-only row, or one whose number changed — goes too.
    if (hiddenChannels.size > 0) {
      conversations = conversations.filter((c: { channelAccount?: { id?: string | null } | null }) =>
        channelVisible(hiddenChannels, c.channelAccount?.id))
      channels = channels.filter((channel) => channelVisible(hiddenChannels, channel.id))
    }

    // Stats
    const totalMessages = messages.length
    const inboundCount = messages.filter((m: any) => m.direction === "inbound").length
    const outboundCount = messages.filter((m: any) => m.direction === "outbound").length

    return NextResponse.json({
      success: true,
      data: {
        conversations,
        channels,
        // The person asked about holds more open conversations than one listing adds.
        ...(assigneeId ? { assignee: { id: assigneeId, more: assigneeMore } } : {}),
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
  channel: z.enum(["email", "telegram", "sms", "whatsapp", "tiktok", "facebook", "instagram", "vkontakte", "web-chat"]).default("email"),
  // Media SEND (Slice 3b): the /uploads/inbox/<org>/ URL the composer uploaded; validated + read
  // server-side (org from session, never trusted as a path). WhatsApp/Telegram only.
  attachmentUrl: z.string().optional(),
  conversationId: z.string().nullable().optional(),
  // Required only for Chatwoot/TikTok. The server fixes the namespace to
  // `manual`; callers may supply only a bounded RFC UUID.
  deliveryIdempotencyKey: z.string().uuid().optional(),
  // An answer to an Instagram comment in this conversation: which comment, and where the answer goes
  // (lib/social/instagram-comments). The comment row is re-read below; the client names only its id.
  commentReply: z.object({
    messageId: z.string().min(1),
    mode: z.enum(["direct", "public"]),
  }).optional(),
}).refine((d) => d.body.trim().length > 0 || !!d.attachmentUrl, {
  message: "Message text or an attachment is required",
})

/** Channels whose reply recipient + sending channel come from the stored conversation, not the client. */
const CONVERSATION_BOUND_CHANNELS: ReadonlySet<string> = new Set(["tiktok", "facebook", "instagram", "vkontakte"])

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
    commentReply,
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
  // A reply into a conversation on a number hidden from this person is refused like a missing one.
  const channelDenied = await conversationAccessDenial(authSession, conversationId)
  if (channelDenied) return channelDenied
  if (channel === "whatsapp" && authSession.hideCustomerPhoneForOperators === true
    && isPhoneRestrictedPrincipal(authSession) && !conversationId) {
    return NextResponse.json({ error: "Open a customer conversation before replying" }, { status: 400 })
  }
  const leadId = owned.leadId

  // For TikTok (Chatwoot), Facebook, Instagram and VK the transport recipient
  // (Chatwoot conversation id / PSID / IGSID / VK peer id) and the channel that
  // received the thread are server-owned properties of the selected tenant
  // conversation. Never let a browser pair conversation A's local id (and
  // ledger/audit trail) with conversation B's external recipient — and never
  // send an Instagram reply through a different account's token than the one
  // the customer wrote to. The composer's `to` for these is the display name.
  let replyTo = to
  let boundChannelConfigId: string | null | undefined
  if (CONVERSATION_BOUND_CHANNELS.has(channel)) {
    if (!conversationId) {
      return NextResponse.json({ error: `A ${channel} conversation is required` }, { status: 400 })
    }
    const boundConversation = await prisma.socialConversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        platform: channel,
        deletedAt: null,
      },
      select: { externalId: true, channelConfigId: true },
    })
    if (!boundConversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }
    replyTo = boundConversation.externalId
    boundChannelConfigId = boundConversation.channelConfigId
  } else if (channel === "whatsapp" && conversationId) {
    // The recipient and sending number are server-owned. A masked browser value
    // (or a forged phone) must never redirect a reply away from this conversation.
    const boundConversation = await prisma.socialConversation.findFirst({
      where: { id: conversationId, organizationId: orgId, platform: "whatsapp", deletedAt: null },
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
  // never trust the client URL as a path). WhatsApp, Telegram, Instagram and Facebook deliver media.
  const attachment = attachmentUrl ? await readInboxAttachment(attachmentUrl, orgId) : null
  if (attachmentUrl) {
    if (!attachment) return NextResponse.json({ error: "Invalid or missing attachment" }, { status: 400 })
    if (channel !== "whatsapp" && channel !== "telegram" && channel !== "instagram" && channel !== "facebook") {
      return NextResponse.json({ error: "Attachments are supported on WhatsApp, Telegram, Instagram and Facebook only" }, { status: 400 })
    }
  }

  let instagramComment: SendConversationReplyOptions["instagramComment"] = null
  if (commentReply) {
    if (channel !== "instagram" || !conversationId) {
      return NextResponse.json({ error: "A comment reply needs its Instagram conversation" }, { status: 400 })
    }
    const commentRow = await prisma.channelMessage.findFirst({
      where: { id: commentReply.messageId, organizationId: orgId, conversationId, channelType: "instagram", direction: "inbound" },
      select: { id: true, createdAt: true, metadata: true },
    })
    const stored = commentRow ? storedInstagramComment(commentRow.metadata) : null
    if (!commentRow || !stored) return NextResponse.json({ error: "Comment not found" }, { status: 404 })
    instagramComment = {
      commentId: stored.commentId,
      inboundMessageId: commentRow.id,
      mode: commentReply.mode,
      privateReplyAllowed: privateReplyAvailable(commentRow),
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
    instagramComment,
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
      result.internal || result.statusCode === 400 ? { error: result.error } : { success: false, error: result.error, ...(result.deliveryUnknown === false ? { deliveryUnknown: false } : {}) },
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
    const visibleChannels = visibleChannelWhere(await hiddenChannelIdsFor(authSession))
    await prisma.channelMessage.updateMany({
      where: {
        id: { in: messageIds },
        organizationId: orgId,
        direction: "inbound",
        ...(visibleChannels ? { AND: [visibleChannels] } : {}),
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
    const visibleChannels = visibleChannelWhere(await hiddenChannelIdsFor(authSession))
    await prisma.channelMessage.deleteMany({
      where: {
        id: { in: messageIds },
        organizationId: orgId,
        ...(visibleChannels ? { AND: [visibleChannels] } : {}),
      },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
