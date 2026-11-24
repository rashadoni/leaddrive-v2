/**
 * «Черновики в Telegram» — an AI reply the AI may not send itself reaches an employee's Telegram at
 * once, with buttons, and goes to the customer on the press.
 *
 * Owner 2026-11-24: «клиенту не нужно ждать, мы его теряем; если он скажет "я перевожу кому-то", всё,
 * теряю клиента; нужно, чтобы реально, если не знает, мне посылал сообщением, например в Telegram…
 * я подтверждал, и он отсылал». Plan and card approved with «Давай» the same day.
 *
 * - Who gets the card: the employee the conversation is assigned to, when their Telegram is linked to
 *   the organization's employee bot; otherwise every linked admin. Only someone who may answer the
 *   conversation in the CRM gets it (inbox write, the channel not hidden from them). The first press
 *   decides; the other cards turn into «artıq cavab verilib».
 * - «Göndər» sends the draft, «Düzəlt» waits for the employee's next message and sends that,
 *   «Özüm yazacam» sends nothing. Every send goes through lib/inbox/ai-draft-send — the inbox screen's
 *   own path — so Meta's 24-hour window, the lease and the one-send-per-draft key all hold.
 * - A draft with a blank «___» (the AI did not know a fact) cannot be sent as it is.
 * - The sent answer counts for training (lib/inbox/learning) as the «Обучение ИИ» buttons do: as-is is
 *   «the AI answered right», a correction becomes knowledge — a price in it still waits for
 *   «Подтвердить».
 *
 * One card = one TelegramStaffAction row (kind "ai_draft"), so the bot's existing table, RLS and
 * cleanup cover it. Statuses: pending (buttons) → awaiting_text («Düzəlt» pressed) → running → done;
 * or self / answered / closed / replaced / failed / expired.
 */
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { APP_URL } from "@/lib/domains"
import { checkPermission } from "@/lib/permissions"
import { editMessageText, sendMessage, type InlineButton } from "@/lib/telegram-staff/bot-api"
import { decryptBotToken } from "@/lib/telegram-staff/bot-config"
import { loadStaffActor, type StaffActor } from "@/lib/telegram-staff/actor"
import { META_OUTSIDE_WINDOW } from "@/lib/inbox/meta-reply-window"
import { readConversationAiDraft, type ConversationAiDraft } from "@/lib/inbox/ai-draft"
import { decidePendingAiDraft } from "@/lib/inbox/ai-draft-send"
import { telegramDraftsEnabled } from "@/lib/inbox/ai-draft-telegram-settings"
import { changeSample } from "@/lib/inbox/learning/service"

export { telegramDraftsEnabled }

export const AI_DRAFT_KIND = "ai_draft"
/** A card older than this offers nothing: the customer has long moved on. */
export const CARD_TTL_MS = 3 * 24 * 3600_000
/** How long after «Düzəlt» the employee's next message is taken as the corrected answer. */
export const CORRECTION_TTL_MS = 30 * 60_000
const OPEN_STATUSES = ["pending", "awaiting_text"]

/** The bot's words. Azerbaijani, as everything the employee bot says (owner 2026-10-25). */
export const DRAFT_T = {
  customer: "Müştəri",
  aiReply: "AI cavabı",
  send: "✅ Göndər",
  edit: "✏️ Düzəlt",
  self: "🙋 Özüm yazacam",
  open: "CRM-də aç",
  unverifiedOffer: "⚠️ AI biliklərdə olmayan qiymət və ya vəd yazıb — yoxlayın.",
  blanks: "⚠️ «___» yerinə özünüz yazın — «Düzəlt» basın.",
  blanksToast: "Mətndə «___» var — «Düzəlt» basıb tam mətni yazın.",
  waitText: "✏️ Mətninizi bir mesajla yazın — müştəriyə o gedəcək.",
  sent: "✅ Göndərildi",
  sentEdited: "✅ Düzəldilmiş mətn göndərildi",
  self_: "🙋 Özünüz yazacaqsınız — qaralama CRM-də qalır.",
  answered: "artıq cavab verilib",
  writesSelf: "özü yazacaq",
  closed: "Qaralama CRM-də bağlandı.",
  replaced: "Müştəri yenə yazıb — yeni qaralama gəlib.",
  expired: "Vaxt keçdi — CRM-də cavab verin.",
  outsideWindow: "Göndərilmədi: müştəri 24 saatdan çox əvvəl yazıb, Meta icazə vermir. Qaralama CRM-də qalır.",
  failed: "Göndərilmədi",
  draftStays: "Qaralama CRM-də qalır.",
  unknown: "Göndərilib-göndərilmədiyi bilinmir — CRM-də yoxlayın.",
  busy: "Bu qaralama indi göndərilir.",
  notYours: "Bu sizin kartınız deyil.",
  gone: "Bu artıq aktual deyil.",
  notAllowed: "Bu yazışmaya cavab vermək hüququnuz yoxdur.",
  correctionSent: "Göndərildi.",
}

export type CardPayload = {
  conversationId: string
  draftCreatedAt: string
  chatId: string
  messageId?: number
  /** The card as sent, so a later edit keeps it and adds the outcome line. */
  text: string
  /** Whether the draft has a «___» the employee must fill in. */
  blanks?: boolean
}

export const hasBlanks = (text: string) => /_{3,}/.test(text)

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** The card's text. Plain text: Telegram is sent no parse mode, so nothing a customer wrote is markup. */
export function draftCardText(input: {
  channelLabel: string
  customerName: string
  inbound: string
  draft: string
  unverifiedOffer?: boolean
}): string {
  const lines = [
    `🤖 ${input.channelLabel}`,
    `👤 ${input.customerName || DRAFT_T.customer}`,
    "",
    `💬 ${DRAFT_T.customer}:`,
    `«${clip(input.inbound || "—", 700)}»`,
    "",
    `✍️ ${DRAFT_T.aiReply}:`,
    `«${clip(input.draft, 2600)}»`,
  ]
  if (input.unverifiedOffer) lines.push("", DRAFT_T.unverifiedOffer)
  if (hasBlanks(input.draft)) lines.push("", DRAFT_T.blanks)
  return lines.join("\n")
}

function bakuTime(date: Date): string {
  const baku = new Date(date.getTime() + 4 * 3600_000)
  return `${String(baku.getUTCHours()).padStart(2, "0")}:${String(baku.getUTCMinutes()).padStart(2, "0")}`
}

const conversationUrl = (conversationId: string) =>
  `${APP_URL.replace(/\/$/, "")}/inbox?conversation=${encodeURIComponent(conversationId)}`

export function cardButtons(actionId: string, conversationId: string, opts: { editing?: boolean } = {}): InlineButton[][] {
  const row: InlineButton[] = [{ text: DRAFT_T.send, callback_data: `d:${actionId}:s` }]
  if (!opts.editing) row.push({ text: DRAFT_T.edit, callback_data: `d:${actionId}:e` })
  row.push({ text: DRAFT_T.self, callback_data: `d:${actionId}:x` })
  return [row, [{ text: DRAFT_T.open, url: conversationUrl(conversationId) }]]
}

const openButton = (conversationId: string): InlineButton[][] => [[{ text: DRAFT_T.open, url: conversationUrl(conversationId) }]]

function channelLabel(platform: string, cfg: { configName: string | null; displayName: string | null } | null): string {
  const platformName = platform ? platform[0].toUpperCase() + platform.slice(1) : "Kanal"
  const name = cfg?.displayName?.trim() || cfg?.configName?.trim()
  return name && name.toLowerCase() !== platform.toLowerCase() ? `${platformName} · ${name}` : platformName
}

/** Whether this linked employee may decide on a draft in this conversation, as the CRM would let them. */
async function mayAnswer(actor: StaffActor, channelConfigId: string | null): Promise<boolean> {
  if (!checkPermission(actor.role, "inbox", "write")) return false
  if (!channelConfigId || actor.role === "admin" || actor.role === "superadmin") return true
  const user = await prisma.user.findFirst({ where: { id: actor.userId, organizationId: actor.orgId }, select: { hiddenChannelConfigIds: true } })
  return !(user?.hiddenChannelConfigIds ?? []).includes(channelConfigId)
}

type LinkRow = { id: string; organizationId: string; userId: string; chatId: string; linkedAt: Date }

/** The employees who get the card: the assignee when linked, otherwise every linked admin. */
async function recipients(orgId: string, botId: string, assignedTo: string | null, channelConfigId: string | null): Promise<Array<{ link: LinkRow; actor: StaffActor }>> {
  const links: LinkRow[] = await prisma.telegramStaffLink.findMany({
    where: { organizationId: orgId, botId },
    select: { id: true, organizationId: true, userId: true, chatId: true, linkedAt: true },
  })
  const eligible: Array<{ link: LinkRow; actor: StaffActor }> = []
  for (const link of links) {
    const loaded = await loadStaffActor(link)
    if (!loaded.ok || !(await mayAnswer(loaded.actor, channelConfigId))) continue
    eligible.push({ link, actor: loaded.actor })
  }
  const assignee = assignedTo ? eligible.filter((e) => e.link.userId === assignedTo) : []
  return assignee.length ? assignee : eligible.filter((e) => e.actor.role === "admin")
}

async function activeBot(orgId: string) {
  return prisma.telegramStaffBot.findFirst({ where: { organizationId: orgId, isActive: true }, select: { id: true, tokenCiphertext: true } })
}

function readPayload(value: unknown): CardPayload | null {
  const p = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  if (typeof p.conversationId !== "string" || typeof p.draftCreatedAt !== "string" || typeof p.chatId !== "string" || typeof p.text !== "string") return null
  return p as unknown as CardPayload
}

/**
 * Send the card for a draft just saved. Best-effort: a channel without the switch, an organization
 * without the bot or nobody linked means nothing is sent — the draft waits in the CRM, as before.
 * Returns how many cards went.
 */
export async function announceAiDraftToTelegram(opts: { organizationId: string; conversationId: string; draft: ConversationAiDraft; now?: Date }): Promise<number> {
  const { organizationId: orgId, conversationId, draft } = opts
  const now = opts.now ?? new Date()
  return runWithTenant(orgId, async () => {
    const conv = await prisma.socialConversation.findFirst({
      where: { id: conversationId, organizationId: orgId },
      select: { id: true, platform: true, contactName: true, assignedTo: true, channelConfigId: true, channelConfig: { select: { settings: true, configName: true, displayName: true } } },
    })
    if (!conv || !telegramDraftsEnabled(conv.channelConfig?.settings)) return 0
    const bot = await activeBot(orgId)
    if (!bot) return 0
    const token = decryptBotToken(orgId, bot.tokenCiphertext)
    // The customer wrote again: the cards of the older draft stop offering it.
    await settleAiDraftCards({ organizationId: orgId, conversationId, state: "replaced", exceptDraftCreatedAt: draft.createdAt })

    const text = draftCardText({
      channelLabel: channelLabel(conv.platform, conv.channelConfig),
      customerName: conv.contactName,
      inbound: draft.inboundPreview ?? "",
      draft: draft.text,
      unverifiedOffer: draft.reviewNote === "unverified_offer",
    })
    let sent = 0
    for (const { link } of await recipients(orgId, bot.id, conv.assignedTo, conv.channelConfigId)) {
      // One card per employee per draft, however often the save is retried.
      const existing = await prisma.telegramStaffAction.findFirst({
        where: { organizationId: orgId, linkId: link.id, kind: AI_DRAFT_KIND, AND: [{ payload: { path: ["conversationId"], equals: conversationId } }, { payload: { path: ["draftCreatedAt"], equals: draft.createdAt } }] },
        select: { id: true },
      })
      if (existing) continue
      const payload: CardPayload = { conversationId, draftCreatedAt: draft.createdAt, chatId: link.chatId, text, blanks: hasBlanks(draft.text) }
      const row = await prisma.telegramStaffAction.create({
        data: { organizationId: orgId, linkId: link.id, kind: AI_DRAFT_KIND, payload: payload as object, expiresAt: new Date(now.getTime() + CARD_TTL_MS) },
        select: { id: true },
      })
      try {
        const message = await sendMessage(token, link.chatId, text, cardButtons(row.id, conversationId))
        await prisma.telegramStaffAction.update({ where: { id: row.id }, data: { payload: { ...payload, messageId: message.message_id } as object } })
        sent += 1
      } catch (error) {
        await prisma.telegramStaffAction.update({ where: { id: row.id }, data: { status: "failed", error: (error instanceof Error ? error.message : "send failed").slice(0, 300) } })
      }
    }
    return sent
  })
}

type SettleState = "answered" | "taken" | "closed" | "replaced" | "expired"

const STATE_LINE: Record<Exclude<SettleState, "taken">, string> = {
  answered: `— ${DRAFT_T.answered}`,
  closed: `— ${DRAFT_T.closed}`,
  replaced: `— ${DRAFT_T.replaced}`,
  expired: `— ${DRAFT_T.expired}`,
}

/**
 * The open cards of a conversation stop offering their buttons: someone answered (in the CRM or by
 * another card), the draft was dropped, or a newer one replaced it. Best-effort, never throws.
 */
export async function settleAiDraftCards(opts: {
  organizationId: string
  conversationId: string
  state: SettleState
  /** Leave the cards of this draft open (the new one on «replaced»). */
  exceptDraftCreatedAt?: string
  /** «taken»: the colleague who said they will write themselves. */
  byName?: string | null
}): Promise<number> {
  const { organizationId: orgId } = opts
  try {
    return await runWithTenant(orgId, async () => {
      const open = await prisma.telegramStaffAction.findMany({
        where: { organizationId: orgId, kind: AI_DRAFT_KIND, status: { in: OPEN_STATUSES }, payload: { path: ["conversationId"], equals: opts.conversationId } },
        select: { id: true, payload: true },
      })
      const targets = open.filter((row: { payload: unknown }) => readPayload(row.payload)?.draftCreatedAt !== opts.exceptDraftCreatedAt || !opts.exceptDraftCreatedAt)
      if (!targets.length) return 0
      const bot = await activeBot(orgId)
      const token = bot ? decryptBotToken(orgId, bot.tokenCiphertext) : null
      let settled = 0
      for (const row of targets) {
        const claimed = await prisma.telegramStaffAction.updateMany({ where: { id: row.id, status: { in: OPEN_STATUSES } }, data: { status: opts.state === "taken" ? "self" : opts.state, decidedAt: new Date() } })
        if (claimed.count !== 1) continue
        settled += 1
        const payload = readPayload(row.payload)
        if (!token || !payload?.messageId) continue
        const line = opts.state === "taken" ? `— ${opts.byName || ""} ${DRAFT_T.writesSelf}`.replace("—  ", "— ") : STATE_LINE[opts.state]
        await editMessageText(token, payload.chatId, payload.messageId, `${payload.text}\n\n${line}`, openButton(payload.conversationId)).catch(() => undefined)
      }
      return settled
    })
  } catch (error) {
    console.error("[ai-draft-telegram] settle failed:", error instanceof Error ? error.message : error)
    return 0
  }
}

export type PressResult = {
  /** The short pop-up on the button (answerCallbackQuery), when any. */
  toast?: string
  /** The card's new text and buttons; undefined leaves it as it is. */
  card?: { text: string; buttons?: InlineButton[][] }
  /** A line sent as its own message (after a correction). */
  reply?: string
}

type CardRow = { id: string; linkId: string; status: string; expiresAt: Date; payload: unknown; decidedAt: Date | null }

async function loadCard(orgId: string, actionId: string): Promise<CardRow | null> {
  return prisma.telegramStaffAction.findFirst({
    where: { id: actionId, organizationId: orgId, kind: AI_DRAFT_KIND },
    select: { id: true, linkId: true, status: true, expiresAt: true, payload: true, decidedAt: true },
  })
}

/**
 * Send the draft — as the AI wrote it, or the employee's own text — from a card already claimed
 * (status running). Writes the card's final status and settles the colleagues' cards.
 */
async function sendFromCard(actor: StaffActor, card: CardRow, payload: CardPayload, text: string | undefined, now: Date): Promise<PressResult> {
  const orgId = actor.orgId
  const conv = await prisma.socialConversation.findFirst({ where: { id: payload.conversationId, organizationId: orgId }, select: { channelConfigId: true } })
  if (!conv || !(await mayAnswer(actor, conv.channelConfigId))) {
    await prisma.telegramStaffAction.update({ where: { id: card.id }, data: { status: "pending" } })
    return { toast: DRAFT_T.notAllowed }
  }
  const outcome = await decidePendingAiDraft({
    organizationId: orgId,
    conversationId: payload.conversationId,
    decider: { userId: actor.userId, name: actor.name || null, email: null },
    action: "send",
    text,
    expectedCreatedAt: payload.draftCreatedAt,
    refuseIfAnswered: true,
  })
  const finish = (status: string, line: string, error?: string) =>
    prisma.telegramStaffAction.update({ where: { id: card.id }, data: { status, ...(error ? { error: error.slice(0, 300) } : {}) } })
      .then(() => ({ card: { text: `${payload.text}\n\n${line}`, buttons: openButton(payload.conversationId) } }))

  if (outcome.ok && !outcome.discarded) {
    await prisma.telegramStaffAction.update({ where: { id: card.id }, data: { status: "done", resultId: outcome.messageId } })
    await settleAiDraftCards({ organizationId: orgId, conversationId: payload.conversationId, state: "answered" })
    await recordDraftLearning({ organizationId: orgId, conversationId: payload.conversationId, messageId: outcome.messageId, draft: outcome.draft, edited: outcome.edited, userId: actor.userId })
    const head = outcome.edited ? DRAFT_T.sentEdited : DRAFT_T.sent
    const body = outcome.edited ? `${head}:\n«${clip(outcome.body, 1500)}»\n— ${actor.name}, ${bakuTime(now)}` : `${head} — ${actor.name}, ${bakuTime(now)}`
    return { card: { text: `${payload.text}\n\n${body}`, buttons: openButton(payload.conversationId) }, toast: DRAFT_T.correctionSent }
  }
  if (outcome.ok) return finish("closed", `— ${DRAFT_T.closed}`)
  switch (outcome.code) {
    case "busy":
      await prisma.telegramStaffAction.update({ where: { id: card.id }, data: { status: "pending" } })
      return { toast: DRAFT_T.busy }
    case "already_answered":
    case "no_draft":
    case "changed":
    case "not_found":
      return finish("answered", `— ${DRAFT_T.answered}`)
    case "attempted":
    case "finalize":
      return finish("failed", `— ${DRAFT_T.unknown}`, outcome.error)
    default:
      if (outcome.deliveryUnknown) return finish("failed", `— ${DRAFT_T.unknown}`, outcome.error)
      return finish(
        "failed",
        outcome.error === META_OUTSIDE_WINDOW ? `— ${DRAFT_T.outsideWindow}` : `— ${DRAFT_T.failed}: ${clip(outcome.error, 200)}. ${DRAFT_T.draftStays}`,
        outcome.error,
      )
  }
}

/** A press on a card: «Göndər» (s), «Düzəlt» (e), «Özüm yazacam» (x). Runs inside the bot's tenant scope. */
export async function pressDraftCard(input: { link: LinkRow; actionId: string; choice: "s" | "e" | "x"; now?: Date }): Promise<PressResult> {
  const { link } = input
  const now = input.now ?? new Date()
  const card = await loadCard(link.organizationId, input.actionId)
  const payload = card ? readPayload(card.payload) : null
  if (!card || !payload) return { toast: DRAFT_T.gone }
  if (card.linkId !== link.id) return { toast: DRAFT_T.notYours }
  if (!OPEN_STATUSES.includes(card.status)) return { toast: DRAFT_T.gone }
  const loaded = await loadStaffActor(link)
  if (!loaded.ok) return { toast: DRAFT_T.notAllowed }
  const actor = loaded.actor
  if (card.expiresAt <= now) {
    await prisma.telegramStaffAction.updateMany({ where: { id: card.id, status: { in: OPEN_STATUSES } }, data: { status: "expired", decidedAt: now } })
    return { card: { text: `${payload.text}\n\n${STATE_LINE.expired}`, buttons: openButton(payload.conversationId) } }
  }

  if (input.choice === "x") {
    const claimed = await prisma.telegramStaffAction.updateMany({ where: { id: card.id, status: { in: OPEN_STATUSES } }, data: { status: "self", decidedAt: now } })
    if (claimed.count !== 1) return { toast: DRAFT_T.gone }
    await settleAiDraftCards({ organizationId: link.organizationId, conversationId: payload.conversationId, state: "taken", byName: actor.name })
    return { card: { text: `${payload.text}\n\n${DRAFT_T.self_}`, buttons: openButton(payload.conversationId) } }
  }

  if (input.choice === "e") {
    // One correction at a time per employee: an earlier «Düzəlt» goes back to its buttons.
    await prisma.telegramStaffAction.updateMany({ where: { organizationId: link.organizationId, linkId: link.id, kind: AI_DRAFT_KIND, status: "awaiting_text", id: { not: card.id } }, data: { status: "pending" } })
    const claimed = await prisma.telegramStaffAction.updateMany({ where: { id: card.id, status: { in: OPEN_STATUSES } }, data: { status: "awaiting_text", decidedAt: now } })
    if (claimed.count !== 1) return { toast: DRAFT_T.gone }
    return { card: { text: `${payload.text}\n\n${DRAFT_T.waitText}`, buttons: cardButtons(card.id, payload.conversationId, { editing: true }) } }
  }

  if (payload.blanks) return { toast: DRAFT_T.blanksToast }
  const claimed = await prisma.telegramStaffAction.updateMany({ where: { id: card.id, status: { in: OPEN_STATUSES } }, data: { status: "running", decidedAt: now } })
  if (claimed.count !== 1) return { toast: DRAFT_T.gone }
  return sendFromCard(actor, card, payload, undefined, now)
}

/**
 * A text message from an employee who pressed «Düzəlt» within the last half hour: it is the answer.
 * Returns null when there is no correction waiting — the message is then the bot agent's, as before.
 */
export async function takeDraftCorrection(input: { link: LinkRow; text: string; now?: Date }): Promise<(PressResult & { card?: PressResult["card"]; chatId: string; messageId?: number }) | null> {
  const { link } = input
  const now = input.now ?? new Date()
  const waiting = await prisma.telegramStaffAction.findFirst({
    where: { organizationId: link.organizationId, linkId: link.id, kind: AI_DRAFT_KIND, status: "awaiting_text", decidedAt: { gt: new Date(now.getTime() - CORRECTION_TTL_MS) } },
    orderBy: { decidedAt: "desc" },
    select: { id: true, linkId: true, status: true, expiresAt: true, payload: true, decidedAt: true },
  })
  const payload = waiting ? readPayload(waiting.payload) : null
  if (!waiting || !payload) return null
  const loaded = await loadStaffActor(link)
  if (!loaded.ok) return { toast: DRAFT_T.notAllowed, reply: DRAFT_T.notAllowed, chatId: payload.chatId }
  const text = input.text.trim().slice(0, 4000)
  if (hasBlanks(text)) return { reply: DRAFT_T.blanksToast, chatId: payload.chatId }
  const claimed = await prisma.telegramStaffAction.updateMany({ where: { id: waiting.id, status: "awaiting_text" }, data: { status: "running" } })
  if (claimed.count !== 1) return null
  const result = await sendFromCard(loaded.actor, waiting, payload, text, now)
  // The card itself shows the outcome; a short line answers the message the employee just wrote.
  const sentOk = result.card?.text.includes(DRAFT_T.sentEdited) || result.card?.text.includes(DRAFT_T.sent)
  return { ...result, reply: sentOk ? DRAFT_T.correctionSent : result.card ? result.card.text.split("\n").pop() : result.toast, chatId: payload.chatId, messageId: payload.messageId }
}

/**
 * Training: the employee's decision is the same evidence as the «Обучение ИИ» buttons. «Göndər» —
 * the AI's answer was right (a sample, accepted); «Düzəlt» — the person's answer is taught as
 * knowledge (changeSample «teach»: a price in it waits for «Подтвердить»). Best-effort.
 */
export async function recordDraftLearning(opts: { organizationId: string; conversationId: string; messageId: string; draft: ConversationAiDraft; edited: boolean; userId: string }): Promise<void> {
  try {
    const conv = await prisma.socialConversation.findFirst({ where: { id: opts.conversationId, organizationId: opts.organizationId }, select: { channelConfigId: true } })
    if (!conv?.channelConfigId) return
    const question = await prisma.channelMessage.findFirst({
      where: { organizationId: opts.organizationId, conversationId: opts.conversationId, direction: "inbound", createdAt: { lte: new Date(opts.draft.createdAt) } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    const sample = await prisma.inboxLearningSample.create({
      data: {
        organizationId: opts.organizationId,
        channelConfigId: conv.channelConfigId,
        conversationId: opts.conversationId,
        answerMessageId: opts.messageId,
        questionMessageId: question?.id ?? null,
        verdict: opts.edited ? "different" : "same",
        draftLogId: opts.draft.logId ?? null,
        ...(opts.edited ? {} : { resolution: "accepted", resolvedById: opts.userId, resolvedAt: new Date() }),
      },
      select: { id: true },
    })
    if (opts.edited) {
      await changeSample({ organizationId: opts.organizationId, channelConfigId: conv.channelConfigId, sampleId: sample.id, userId: opts.userId, change: { action: "teach" } })
    }
  } catch (error) {
    console.error("[ai-draft-telegram] learning record failed:", error instanceof Error ? error.message : error)
  }
}

/** Read the draft a card is about, for tests and the screen. */
export async function cardDraft(orgId: string, conversationId: string): Promise<ConversationAiDraft | null> {
  const conv = await prisma.socialConversation.findFirst({ where: { id: conversationId, organizationId: orgId }, select: { metadata: true } })
  return readConversationAiDraft(conv?.metadata)
}
