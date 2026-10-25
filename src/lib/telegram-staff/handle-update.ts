/**
 * One Telegram update to the organization's employee bot, inside that
 * organization's tenant scope. The bot talks only in private chats and only
 * to linked employees: anyone else gets one line saying how to link, and no
 * data. It speaks Azerbaijani unless the employee asks for another language.
 */
import { prisma } from "@/lib/prisma"
import { APP_URL } from "@/lib/domains"
import { answerCallbackQuery, editMessageText, sendChatAction, sendMessage } from "./bot-api"
import { decryptBotToken } from "./bot-config"
import { consumeLinkToken } from "./linking"
import { loadStaffActor } from "./actor"
import { actionPreview, decideAction } from "./actions"
import { runStaffAgent, trimTurns, type Turn } from "./agent"

/**
 * The bot's own phrases. Azerbaijani always (owner 2026-10-25: «пусть говорит
 * всегда по умолчанию на азербайджанском»), whatever the phone's language.
 */
const T = {
  notLinked: "Bu Telegram LeadDrive hesabına bağlı deyil. CRM-də Profil → Telegram → «Telegram-ı bağla» basın.",
  linked: "Hazırdır, Telegram bağlandı{name}. Mənə adi sözlərlə yazın: «bu gün tapşırıqlarım», «Əli üçün lid yarat, +994…».",
  linkInvalid: "Bu link artıq keçərli deyil. Profildə yenisini alın.",
  linkTaken: "Bu Telegram artıq başqa əməkdaşa bağlıdır.",
  inactive: "Hesabınız aktiv deyil.",
  relink: "Təhlükəsizlik üçün Telegram-ı yenidən bağlayın: Profil → Telegram.",
  notAllowed: "Bu bot sizin rolunuz üçün açıq deyil.",
  noAi: "Da Vinci AI modulu təşkilatınızda qoşulmayıb.",
  budget: "Bu ay üçün AI limiti bitib. Administratora yazın.",
  error: "Alınmadı, bir az sonra yenidən yazın.",
  onlyText: "Hələlik yalnız mətn mesajlarını başa düşürəm.",
  confirm: "Təsdiqlə", cancel: "Ləğv et",
  question: "Yaradılsın?", lead: "Lid", phone: "Telefon", email: "E-poçt", company: "Şirkət", note: "Qeyd", task: "Tapşırıq", due: "Müddət", board: "Lövhə",
  doneLead: "Lid yaradıldı.", doneTask: "Tapşırıq yaradıldı.", open: "CRM-də aç",
  cancelled: "Ləğv edildi.", expired: "Vaxt keçdi — yenidən yazın.", gone: "Bu artıq aktual deyil.", notYours: "Bu sizin təklifiniz deyil.", failed: "Yaradılmadı",
}

interface TgUser { id: number; username?: string; is_bot?: boolean }
export interface TelegramUpdate {
  update_id: number
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; from?: TgUser }
  callback_query?: { id: string; data?: string; from: TgUser; message?: { message_id: number; chat: { id: number; type: string } } }
}

export interface StaffBotRow { id: string; organizationId: string; tokenCiphertext: string }

/** Reads the turns stored on the link. */
function turnsOf(value: unknown): Turn[] {
  return Array.isArray(value) ? value.filter((turn): turn is Turn => Boolean(turn) && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string") : []
}

export async function handleStaffUpdate(bot: StaffBotRow, update: TelegramUpdate, deps: { now?: Date; agent?: typeof runStaffAgent } = {}): Promise<void> {
  const orgId = bot.organizationId
  const token = decryptBotToken(orgId, bot.tokenCiphertext)
  const now = deps.now ?? new Date()
  const agent = deps.agent ?? runStaffAgent

  if (update.callback_query) {
    const query = update.callback_query
    const match = /^a:([A-Za-z0-9_-]{1,40}):(ok|no)$/.exec(query.data ?? "")
    const link = await prisma.telegramStaffLink.findFirst({ where: { organizationId: orgId, botId: bot.id, telegramUserId: String(query.from.id) } })
    if (!match || !link || query.message?.chat.type !== "private") {
      await answerCallbackQuery(token, query.id, link ? T.gone : T.notLinked)
      return
    }
    const actorResult = await loadStaffActor(link)
    if (!actorResult.ok) {
      await answerCallbackQuery(token, query.id, T.notAllowed)
      return
    }
    const outcome = await decideAction(actorResult.actor, link.id, match[1], match[2] === "ok", now)
    const chatId = String(query.message.chat.id)
    let text: string
    let buttons: { text: string; url: string }[][] | undefined
    if (outcome.status === "done") {
      text = outcome.kind === "create_lead" ? T.doneLead : T.doneTask
      buttons = [[{ text: T.open, url: `${APP_URL.replace(/\/$/, "")}/${outcome.kind === "create_lead" ? "leads" : "tasks"}/${outcome.entityId}` }]]
    } else if (outcome.status === "failed") {
      text = `${T.failed}: ${outcome.message}`
    } else {
      text = { cancelled: T.cancelled, expired: T.expired, gone: T.gone, not_yours: T.notYours }[outcome.status]
    }
    await answerCallbackQuery(token, query.id)
    if (outcome.status !== "not_yours") await editMessageText(token, chatId, query.message.message_id, text, buttons).catch(() => sendMessage(token, chatId, text, buttons))
    return
  }

  const message = update.message
  if (!message?.from || message.from.is_bot || message.chat.type !== "private") return
  const chatId = String(message.chat.id)
  const telegramUserId = String(message.from.id)
  const text = (message.text ?? "").trim()

  const start = /^\/start(?:\s+(\S+))?$/.exec(text)
  if (start?.[1]) {
    const result = await consumeLinkToken({ orgId, botId: bot.id, token: start[1], telegramUserId, telegramUsername: message.from.username ?? null, chatId, now })
    const reply = result.outcome === "linked" ? T.linked.replace("{name}", result.userName ? `, ${result.userName}` : "") : result.outcome === "taken" ? T.linkTaken : T.linkInvalid
    await sendMessage(token, chatId, reply)
    return
  }

  const link = await prisma.telegramStaffLink.findFirst({ where: { organizationId: orgId, botId: bot.id, telegramUserId } })
  if (!link) {
    await sendMessage(token, chatId, T.notLinked)
    return
  }
  const actorResult = await loadStaffActor(link)
  if (!actorResult.ok) {
    if (actorResult.code === "RELINK_REQUIRED") await prisma.telegramStaffLink.deleteMany({ where: { id: link.id } })
    const refusal = { USER_INACTIVE: T.inactive, RELINK_REQUIRED: T.relink, NOT_ALLOWED: T.notAllowed, NO_AI_MODULE: T.noAi }[actorResult.code]
    await sendMessage(token, chatId, refusal)
    return
  }
  if (!text || start) {
    await sendMessage(token, chatId, start ? T.linked.replace("{name}", "") : T.onlyText)
    return
  }

  await sendChatAction(token, chatId).catch(() => undefined)
  const history = turnsOf(link.recentTurns)
  let reply: Awaited<ReturnType<typeof runStaffAgent>>
  try {
    reply = await agent({ actor: actorResult.actor, linkId: link.id, text, history, now })
  } catch (error) {
    console.error("[telegram-staff] agent failed", { orgId, error: error instanceof Error ? error.message : error })
    await sendMessage(token, chatId, T.error)
    return
  }
  if (reply.budgetExhausted) {
    await sendMessage(token, chatId, T.budget)
    return
  }

  if (reply.text) await sendMessage(token, chatId, reply.text)
  if (reply.actionId) {
    const action = await prisma.telegramStaffAction.findFirst({ where: { id: reply.actionId, organizationId: orgId }, select: { kind: true, payload: true } })
    if (action) {
      await sendMessage(token, chatId, actionPreview(action.kind, action.payload as Record<string, unknown>, T), [[
        { text: `✅ ${T.confirm}`, callback_data: `a:${reply.actionId}:ok` },
        { text: T.cancel, callback_data: `a:${reply.actionId}:no` },
      ]])
    }
  }
  await prisma.telegramStaffLink.update({
    where: { id: link.id },
    data: { recentTurns: trimTurns([...history, { role: "user", text }, { role: "assistant", text: reply.text || "(proposal)" }]) },
  })
}
