import { prisma } from "@/lib/prisma"
import type { Role } from "@/lib/permissions"
import { bookingScope, isBookingOperator, type BookingAccess } from "@/lib/booking/access"
import { bookingDetail } from "@/lib/booking/queries"

/**
 * Встречи вслух — в тех же пределах, что на экране.
 *
 * Почему это отдельный файл, а не ещё одна ветка в общих сводках. У встреч
 * своя граница доступа, не похожая ни на одну другую в CRM: мастер видит свои
 * записи, координатор — записи тех мастеров, на кого ему выдали доверенность
 * (`BookingCoordinatorGrant`), админ — все. Голосовые сводки считают по ВСЕЙ
 * организации, и именно поэтому раздел «Встречи» до сих пор помечен в реестре
 * как «цифр нет» (`NO_DATA_SECTIONS`): общий читатель этой границы не знает и
 * прочитал бы мастеру чужой день.
 *
 * Поэтому здесь каждый вопрос идёт через `BookingAccess` — тот же объект, что
 * строит панель, — и через её же запросы (`bookingScope`, `bookingDetail`).
 * Своего SQL по встречам тут нет: разойтись с экраном было бы нечем.
 *
 * Телефон клиента затирать здесь не нужно и не нужно его маскировать руками:
 * ответ маршрута проходит через `withCustomerPhonePrivacy`, и у того, кому
 * номера на экране закрыты, в прочитанной карточке будет «••••••••».
 */

/**
 * «Про встречи этому человеку сказать нечего».
 *
 * Отдельная ошибка, а не пустой список: пустой ответ неотличим от «в этот день
 * записей нет», и помощник сказал бы «ничего не записано» тому, у кого просто
 * нет доступа. Такой же приём, как у области задач
 * (`VoiceTaskScopeUnavailableError`).
 */
export class VoiceBookingScopeUnavailableError extends Error {
  constructor() {
    super("Voice booking scope is unavailable")
    this.name = "VoiceBookingScopeUnavailableError"
  }
}

export function isVoiceBookingScopeUnavailable(
  error: unknown,
): error is VoiceBookingScopeUnavailableError {
  return error instanceof VoiceBookingScopeUnavailableError
}

/** Личность, от имени которой спрашивают. Полей ровно столько, сколько решает доступ. */
export type VoiceBookingPrincipal = Readonly<{
  orgId: string
  userId: string
  role: string
  /**
   * Браузерная сессия, ключ интеграции или бот. У встреч операторами могут
   * быть только люди (`isBookingOperator`), поэтому отсутствие значения — это
   * отказ, а не «наверное, человек»: тогда новая дверь к инструментам чтения
   * получит доступ к встречам, не спросив разрешения.
   */
  principalType?: string
  /** Посчитано аутентификацией по настройкам организации, а не браузером. */
  hideCustomerPhoneForOperators?: boolean
}>

/**
 * Пределы, в которых этот человек может слышать встречи, или `null`, если он
 * не оператор встреч вовсе.
 *
 * Повторяет `bookingAccess` из панели, но без `NextResponse`: инструменту
 * чтения нужен отказ ДАННЫМИ, а не ответ HTTP (иначе браузер считает две
 * не-2xx подряд мёртвой CRM и заканчивает разговор).
 */
export async function voiceBookingAccess(
  principal: VoiceBookingPrincipal,
  /**
   * Читать пределы доступа ТОЙ ЖЕ транзакцией, если вызывающий её открыл:
   * через глобальный клиент внутри чужой интерактивной транзакции FORCE RLS
   * молча отдаёт 0 строк, и координатор потерял бы доверенности, которые у
   * него есть.
   */
  db: Pick<typeof prisma, "bookingCoordinatorGrant"> = prisma,
): Promise<BookingAccess | null> {
  if (!principal.userId) return null
  if (!isBookingOperator(principal.role, principal.principalType ?? "")) return null
  const administrator = principal.role === "admin" || principal.role === "superadmin"
  const grants = administrator ? [] : await db.bookingCoordinatorGrant.findMany({
    where: { organizationId: principal.orgId, coordinatorUserId: principal.userId },
    select: { hostUserId: true, canManage: true },
  }) as { hostUserId: string; canManage: boolean }[]
  const readable = [...new Set([principal.userId, ...grants.map((row) => row.hostUserId)])]
  const writable = [...new Set([
    principal.userId,
    ...grants.filter((row) => row.canManage).map((row) => row.hostUserId),
  ])]
  return {
    orgId: principal.orgId,
    userId: principal.userId,
    administrator,
    hostIds: administrator ? null : readable,
    writableHostIds: administrator ? null : writable,
    phoneRestricted: !administrator && principal.hideCustomerPhoneForOperators === true,
  }
}

const SPOKEN_STATUS: Record<string, string> = {
  confirmed: "confirmed",
  cancelled: "cancelled",
  completed: "completed",
  no_show: "no_show",
}

function hhmm(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function isoDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export type VoiceBookingMatch = Readonly<{
  id: string
  name: string
  hint: string
}>

/**
 * Найти встречу словами человека: имя клиента или его номер.
 *
 * Подсказка — это день, время, услуга и мастер, потому что один клиент
 * приходит много раз: «Könül Əliyeva» без «пятница 14:00, стрижка, Leyla» не
 * отвечает на вопрос «какая из них».
 */
export async function findVoiceBookings(
  access: BookingAccess,
  query: string,
  timezone: string,
  limit = 5,
  /**
   * Искать среди записей, которые этот человек может ВЕСТИ, а не только
   * слышать. Нужно подготовке действия: координатор с доверенностью только на
   * чтение видит день мастера, но отменять в нём нечего — и сказать об этом
   * надо вопросом «какую запись?», а не отказом цели после квитанции.
   */
  write = false,
): Promise<VoiceBookingMatch[]> {
  const q = query.trim().slice(0, 80)
  if (q.length < 2) return []
  const rows = await prisma.booking.findMany({
    where: {
      AND: [
        bookingScope(access, write),
        { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] },
      ],
    },
    select: {
      id: true,
      name: true,
      startsAt: true,
      status: true,
      hostUserId: true,
      bookingPage: { select: { title: true } },
    },
    // Ближайшие вперёд полезнее давних: по телефону звонят про запись, которая
    // ещё будет.
    orderBy: { startsAt: "desc" },
    take: limit,
  }) as {
    id: string
    name: string
    startsAt: Date
    status: string
    hostUserId: string
    bookingPage: { title: string } | null
  }[]
  if (rows.length === 0) return []
  const hosts = await prisma.user.findMany({
    where: {
      organizationId: access.orgId,
      id: { in: [...new Set(rows.map((row) => row.hostUserId))] },
    },
    select: { id: true, name: true },
  }) as { id: string; name: string | null }[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    hint: [
      `${isoDay(row.startsAt, timezone)} ${hhmm(row.startsAt, timezone)}`,
      row.bookingPage?.title,
      hosts.find((host) => host.id === row.hostUserId)?.name,
      SPOKEN_STATUS[row.status] ?? row.status,
    ].filter(Boolean).join(", "),
  }))
}

/**
 * Карточка встречи: то, что человек прочитал бы с экрана вслух.
 *
 * Берётся целиком из `bookingDetail` — того же запроса, что рисует панель, —
 * и обрезается до слышимого: интеграции, курсоры истории и списки доступных
 * мастеров в разговоре не нужны. История оставлена хвостом: без неё на вопрос
 * «что с этой записью было» ответить нечем (тот же урок, что у карточки
 * сделки).
 */
export async function readVoiceBooking(
  access: BookingAccess,
  id: string,
  role: Role,
  timezone: string,
): Promise<Record<string, unknown> | { error: "BAD_RECORD" }> {
  const card = await bookingDetail(access, id, role)
  if (!card) return { error: "BAD_RECORD" }
  const starts = new Date(card.startsAt)
  const ends = new Date(card.endsAt)
  return {
    client: card.name,
    phone: card.phone,
    email: card.email,
    service: card.bookingPage?.title ?? null,
    host: card.hostName,
    day: isoDay(starts, timezone),
    from: hhmm(starts, timezone),
    to: hhmm(ends, timezone),
    timezone,
    status: SPOKEN_STATUS[card.status] ?? card.status,
    note: card.note,
    where: card.bookingPage?.locationText ?? card.bookingPage?.locationType ?? null,
    price: card.bookingPage?.price ?? null,
    currency: card.bookingPage?.priceCurrency ?? null,
    deposit: card.depositAmount === null ? null : { amount: card.depositAmount, status: card.depositStatus },
    cancellationReason: card.cancellationReason || null,
    outcomeNote: card.outcomeNote || null,
    clientConfirmedAt: card.clientConfirmedAt,
    // Может ли ЭТОТ человек её менять: иначе помощник предложит отменить
    // запись, которую сервер ему не отдаст.
    canManage: card.canManage,
    history: card.history.slice(0, 8),
  }
}

export type VoiceBookingPeriod = "today" | "tomorrow" | "week"

export type VoiceBookingsSummary = Readonly<{
  period: VoiceBookingPeriod
  from: string
  to: string
  timezone: string
  /** Чей это день: все мастера или только те, кого слышно этому человеку. */
  scope: "all_hosts" | "own_and_granted"
  total: number
  confirmed: number
  cancelled: number
  completed: number
  noShow: number
  byHost: ReadonlyArray<{ host: string; bookings: number }>
  next: ReadonlyArray<{
    id: string
    at: string
    client: string
    service: string | null
    host: string | null
    status: string
  }>
}>

/**
 * День (или неделя) встречами.
 *
 * Отменённые считаются отдельной цифрой, а не выбрасываются: «на сегодня
 * восемь» при трёх отменённых — не ответ на вопрос «сколько придёт».
 */
export async function buildVoiceBookingsSummary(
  access: BookingAccess,
  period: VoiceBookingPeriod,
  now: Date,
  timezone: string,
): Promise<VoiceBookingsSummary> {
  const startDay = isoDay(period === "tomorrow" ? new Date(now.getTime() + 86_400_000) : now, timezone)
  const from = zonedDayStart(startDay, timezone)
  const days = period === "week" ? 7 : 1
  const to = new Date(from.getTime() + days * 86_400_000)

  const rows = await prisma.booking.findMany({
    where: { AND: [bookingScope(access), { startsAt: { gte: from, lt: to } }] },
    select: {
      id: true,
      name: true,
      startsAt: true,
      status: true,
      hostUserId: true,
      bookingPage: { select: { title: true } },
    },
    orderBy: { startsAt: "asc" },
  }) as {
    id: string
    name: string
    startsAt: Date
    status: string
    hostUserId: string
    bookingPage: { title: string } | null
  }[]

  const hosts = await prisma.user.findMany({
    where: {
      organizationId: access.orgId,
      id: { in: [...new Set(rows.map((row) => row.hostUserId))] },
    },
    select: { id: true, name: true },
  }) as { id: string; name: string | null }[]
  const hostName = (id: string) => hosts.find((host) => host.id === id)?.name ?? null

  const perHost = new Map<string, number>()
  for (const row of rows) {
    if (row.status === "cancelled") continue
    const label = hostName(row.hostUserId) ?? "—"
    perHost.set(label, (perHost.get(label) ?? 0) + 1)
  }

  return {
    period,
    from: from.toISOString(),
    to: new Date(to.getTime() - 1).toISOString(),
    timezone,
    scope: access.hostIds === null ? "all_hosts" : "own_and_granted",
    total: rows.length,
    confirmed: rows.filter((row) => row.status === "confirmed").length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    completed: rows.filter((row) => row.status === "completed").length,
    noShow: rows.filter((row) => row.status === "no_show").length,
    byHost: [...perHost.entries()]
      .map(([host, bookings]) => ({ host, bookings }))
      .sort((a, b) => b.bookings - a.bookings),
    // Вслух список не читают дальше нескольких позиций.
    next: rows
      .filter((row) => row.status !== "cancelled" && row.startsAt.getTime() >= now.getTime())
      .slice(0, 6)
      .map((row) => ({
        id: row.id,
        at: hhmm(row.startsAt, timezone),
        client: row.name,
        service: row.bookingPage?.title ?? null,
        host: hostName(row.hostUserId),
        status: SPOKEN_STATUS[row.status] ?? row.status,
      })),
  }
}

/**
 * Полночь этого дня в часовом поясе организации.
 *
 * Своя функция, а не `new Date("…T00:00:00")`: на проде часовой пояс процесса
 * UTC (см. CLAUDE.md), и «сегодня» без пояса компании сдвинуло бы день на
 * четыре часа — то есть ответ «что у меня сегодня» после 20:00 по Баку
 * показывал бы завтрашние записи.
 */
function zonedDayStart(day: string, timezone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`)
  const offset = zoneOffsetMs(guess, timezone)
  return new Date(guess.getTime() - offset)
}

function zoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at)
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0")
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour") % 24,
    field("minute"),
    field("second"),
  )
  return asUtc - at.getTime()
}
