/**
 * One Telegram update to the organization's employee bot, inside that
 * organization's tenant scope. The bot talks only in private chats and only
 * to linked employees: anyone else gets one line saying how to link, and no
 * data. The fixed phrases follow the Telegram app's language (az/ru/en); the
 * model answers in whatever language the employee writes.
 */
import { prisma } from "@/lib/prisma"
import { APP_URL } from "@/lib/domains"
import { answerCallbackQuery, editMessageText, sendChatAction, sendMessage } from "./bot-api"
import { decryptBotToken } from "./bot-config"
import { consumeLinkToken } from "./linking"
import { loadStaffActor } from "./actor"
import { actionPreview, decideAction, type PreviewLabels } from "./actions"
import { runStaffAgent, trimTurns, type Turn } from "./agent"

type Lang = "az" | "ru" | "en"

const TEXT: Record<Lang, Record<string, string>> = {
  az: {
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
  },
  ru: {
    notLinked: "Этот Telegram не привязан к аккаунту LeadDrive. В CRM: Профиль → Telegram → «Привязать Telegram».",
    linked: "Готово, Telegram привязан{name}. Пишите обычными словами: «мои задачи на сегодня», «создай лида Али, +994…».",
    linkInvalid: "Эта ссылка уже недействительна. Получите новую в профиле.",
    linkTaken: "Этот Telegram уже привязан к другому сотруднику.",
    inactive: "Ваш аккаунт не активен.",
    relink: "Для безопасности привяжите Telegram заново: Профиль → Telegram.",
    notAllowed: "Бот недоступен для вашей роли.",
    noAi: "Модуль Da Vinci AI не подключён в вашей организации.",
    budget: "Лимит ИИ на этот месяц исчерпан. Напишите администратору.",
    error: "Не получилось, попробуйте чуть позже.",
    onlyText: "Пока я понимаю только текстовые сообщения.",
    confirm: "Подтвердить", cancel: "Отмена",
    question: "Создать?", lead: "Лид", phone: "Телефон", email: "Почта", company: "Компания", note: "Заметка", task: "Задача", due: "Срок", board: "Доска",
    doneLead: "Лид создан.", doneTask: "Задача создана.", open: "Открыть в CRM",
    cancelled: "Отменено.", expired: "Время вышло — напишите заново.", gone: "Это уже неактуально.", notYours: "Это не ваше предложение.", failed: "Не создано",
  },
  en: {
    notLinked: "This Telegram is not linked to a LeadDrive account. In the CRM: Profile → Telegram → «Link Telegram».",
    linked: "Done, Telegram is linked{name}. Write in plain words: «my tasks today», «create a lead Ali, +994…».",
    linkInvalid: "This link is no longer valid. Get a new one in your profile.",
    linkTaken: "This Telegram is already linked to another employee.",
    inactive: "Your account is not active.",
    relink: "For security, link Telegram again: Profile → Telegram.",
    notAllowed: "The bot is not available for your role.",
    noAi: "Da Vinci AI is not enabled for your organization.",
    budget: "This month's AI limit is used up. Ask your administrator.",
    error: "That did not work, try again a bit later.",
    onlyText: "For now I understand text messages only.",
    confirm: "Confirm", cancel: "Cancel",
    question: "Create this?", lead: "Lead", phone: "Phone", email: "E-mail", company: "Company", note: "Note", task: "Task", due: "Due", board: "Board",
    doneLead: "Lead created.", doneTask: "Task created.", open: "Open in CRM",
    cancelled: "Cancelled.", expired: "Time is up — write it again.", gone: "This is no longer current.", notYours: "This is not your proposal.", failed: "Not created",
  },
}

const langOf = (code?: string): Lang => (code?.startsWith("ru") ? "ru" : code?.startsWith("en") ? "en" : "az")

interface TgUser { id: number; username?: string; language_code?: string; is_bot?: boolean }
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
    const t = TEXT[langOf(query.from.language_code)]
    const match = /^a:([A-Za-z0-9_-]{1,40}):(ok|no)$/.exec(query.data ?? "")
    const link = await prisma.telegramStaffLink.findFirst({ where: { organizationId: orgId, botId: bot.id, telegramUserId: String(query.from.id) } })
    if (!match || !link || query.message?.chat.type !== "private") {
      await answerCallbackQuery(token, query.id, link ? t.gone : t.notLinked)
      return
    }
    const actorResult = await loadStaffActor(link)
    if (!actorResult.ok) {
      await answerCallbackQuery(token, query.id, t.notAllowed)
      return
    }
    const outcome = await decideAction(actorResult.actor, link.id, match[1], match[2] === "ok", now)
    const chatId = String(query.message.chat.id)
    let text: string
    let buttons: { text: string; url: string }[][] | undefined
    if (outcome.status === "done") {
      text = outcome.kind === "create_lead" ? t.doneLead : t.doneTask
      buttons = [[{ text: t.open, url: `${APP_URL.replace(/\/$/, "")}/${outcome.kind === "create_lead" ? "leads" : "tasks"}/${outcome.entityId}` }]]
    } else if (outcome.status === "failed") {
      text = `${t.failed}: ${outcome.message}`
    } else {
      text = { cancelled: t.cancelled, expired: t.expired, gone: t.gone, not_yours: t.notYours }[outcome.status]
    }
    await answerCallbackQuery(token, query.id)
    if (outcome.status !== "not_yours") await editMessageText(token, chatId, query.message.message_id, text, buttons).catch(() => sendMessage(token, chatId, text, buttons))
    return
  }

  const message = update.message
  if (!message?.from || message.from.is_bot || message.chat.type !== "private") return
  const t = TEXT[langOf(message.from.language_code)]
  const chatId = String(message.chat.id)
  const telegramUserId = String(message.from.id)
  const text = (message.text ?? "").trim()

  const start = /^\/start(?:\s+(\S+))?$/.exec(text)
  if (start?.[1]) {
    const result = await consumeLinkToken({ orgId, botId: bot.id, token: start[1], telegramUserId, telegramUsername: message.from.username ?? null, chatId, now })
    const reply = result.outcome === "linked" ? t.linked.replace("{name}", result.userName ? `, ${result.userName}` : "") : result.outcome === "taken" ? t.linkTaken : t.linkInvalid
    await sendMessage(token, chatId, reply)
    return
  }

  const link = await prisma.telegramStaffLink.findFirst({ where: { organizationId: orgId, botId: bot.id, telegramUserId } })
  if (!link) {
    await sendMessage(token, chatId, t.notLinked)
    return
  }
  const actorResult = await loadStaffActor(link)
  if (!actorResult.ok) {
    if (actorResult.code === "RELINK_REQUIRED") await prisma.telegramStaffLink.deleteMany({ where: { id: link.id } })
    const refusal = { USER_INACTIVE: t.inactive, RELINK_REQUIRED: t.relink, NOT_ALLOWED: t.notAllowed, NO_AI_MODULE: t.noAi }[actorResult.code]
    await sendMessage(token, chatId, refusal)
    return
  }
  if (!text || start) {
    await sendMessage(token, chatId, start ? t.linked.replace("{name}", "") : t.onlyText)
    return
  }

  await sendChatAction(token, chatId).catch(() => undefined)
  const history = turnsOf(link.recentTurns)
  let reply: Awaited<ReturnType<typeof runStaffAgent>>
  try {
    reply = await agent({ actor: actorResult.actor, linkId: link.id, text, history, now })
  } catch (error) {
    console.error("[telegram-staff] agent failed", { orgId, error: error instanceof Error ? error.message : error })
    await sendMessage(token, chatId, t.error)
    return
  }
  if (reply.budgetExhausted) {
    await sendMessage(token, chatId, t.budget)
    return
  }

  if (reply.text) await sendMessage(token, chatId, reply.text)
  if (reply.actionId) {
    const action = await prisma.telegramStaffAction.findFirst({ where: { id: reply.actionId, organizationId: orgId }, select: { kind: true, payload: true } })
    if (action) {
      await sendMessage(token, chatId, actionPreview(action.kind, action.payload as Record<string, unknown>, t as unknown as PreviewLabels), [[
        { text: `✅ ${t.confirm}`, callback_data: `a:${reply.actionId}:ok` },
        { text: t.cancel, callback_data: `a:${reply.actionId}:no` },
      ]])
    }
  }
  await prisma.telegramStaffLink.update({
    where: { id: link.id },
    data: { recentTurns: trimTurns([...history, { role: "user", text }, { role: "assistant", text: reply.text || "(proposal)" }]) },
  })
}
