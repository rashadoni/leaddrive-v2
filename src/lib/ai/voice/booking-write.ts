import type { Prisma } from "@prisma/client"
import type { CrmCommandActorContext } from "@/lib/crm-commands/actor-context"
import type { CrmCommandExecutionContext } from "@/lib/crm-commands/execution-context"
import { CrmCommandError, type CrmCommandErrorCode } from "@/lib/crm-commands/errors"
import { BookingCommandError } from "@/lib/booking/command-error"
import { runBookingCommand } from "@/lib/booking/commands"
import { voiceBookingAccess } from "./booking-read"

/**
 * Три действия над бронью голосом: отменить, отметить итог, отметить депозит.
 *
 * Своей логики здесь нет и быть не должно: всё делает `runBookingCommand` —
 * та же команда, что за кнопками в панели. Она сверяет версию записи, держит
 * блокировки, пишет неизменяемое событие, ставит задание на письмо клиенту и
 * помнит себя по ключу идемпотентности. Этот файл только переводит полезную
 * нагрузку квитанции в её вход и выполняет её в транзакции голоса.
 *
 * Чего здесь нет — переноса и создания записи. Им нужна свежая (15 секунд)
 * проверка занятости с внешним календарём, то есть сетевой вызов до восьми
 * секунд: держать на нём открытую транзакцию с захваченными строками нельзя.
 * Это отдельное устройство, и решение по нему за владельцем.
 */

export type VoiceBookingActionType =
  | "cancel_booking"
  | "set_booking_outcome"
  | "set_booking_deposit"

type JsonObject = Record<string, unknown>

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Ключ идемпотентности — это сама квитанция.
 *
 * Повторное нажатие «Отменить» или повтор фиксации после обрыва сети не
 * отменяют встречу дважды: команда узнаёт свой прежний ответ по этому ключу и
 * возвращает его. Поэтому ключом должен быть идентификатор заявки, а не
 * случайная строка на каждый вызов.
 */
function idempotencyKeyOf(actor: CrmCommandActorContext): string {
  const key = actor.actionIntentId
  if (!key || key.length < 16) {
    throw refusal("MISSING_IDEMPOTENCY_KEY")
  }
  return key.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100)
}

/**
 * Отказ команды брони — это ОКОНЧАТЕЛЬНЫЙ отказ квитанции, а не сбой.
 *
 * Фиксация голоса различает их по типу ошибки: `CrmCommandError` закрывает
 * заявку с кодом и объяснением, а всё прочее считается «попробуйте ещё» и
 * оставляет заявку занятой до истечения аренды — то есть одна отклонённая
 * отмена заблокировала бы человеку следующую фразу на минуту.
 *
 * Коды CRM-команд — закрытый список, поэтому свой код брони кладётся в
 * `safeDetails`: он нужен в журнале и на экране, а решение «отказ или сбой»
 * принимается по общему коду.
 */
const REFUSALS: Record<string, { code: CrmCommandErrorCode; status: 400 | 403 | 404 | 409; message: string }> = {
  VERSION_CONFLICT: { code: "STALE_WRITE", status: 409, message: "Запись изменилась, пока квитанция была на экране" },
  NOT_FOUND: { code: "NOT_FOUND", status: 404, message: "Такой записи у вас нет" },
  FORBIDDEN: { code: "FORBIDDEN", status: 403, message: "Этого мастера вы не ведёте" },
  INVALID_STATE: { code: "CONFLICT", status: 409, message: "С записью в этом состоянии так нельзя" },
  CORRECTION_REQUIRES_REASON: { code: "CONFLICT", status: 409, message: "Исправление уже отмеченной записи нужно объяснить" },
  SLOT_TAKEN: { code: "CONFLICT", status: 409, message: "Это время уже занято" },
  AVAILABILITY_CHANGED: { code: "CONFLICT", status: 409, message: "Занятость изменилась, проверьте время заново" },
  RESCHEDULE_NEEDS_OWN_TRANSACTION: { code: "CONFLICT", status: 409, message: "Перенос голосом пока не делается" },
  INVALID_INPUT: { code: "VALIDATION_FAILED", status: 400, message: "Не хватает данных для этого действия" },
  INVALID_HOST: { code: "VALIDATION_FAILED", status: 400, message: "Этот мастер не принимает по этой услуге" },
}

function refusal(bookingCode: string): CrmCommandError {
  const known = REFUSALS[bookingCode]
  return new CrmCommandError(
    known?.code ?? "CONFLICT",
    known?.message ?? "Действие над записью отклонено",
    known?.status ?? 409,
    { bookingCode },
  )
}

function asRefusal(error: unknown): never {
  if (error instanceof BookingCommandError) throw refusal(error.code)
  throw error
}

export async function runVoiceBookingCommand(
  actor: CrmCommandActorContext,
  actionType: VoiceBookingActionType,
  bookingId: string,
  payload: JsonObject,
  execution: CrmCommandExecutionContext,
): Promise<{ bookingId: string; version: number }> {
  const tx = execution.transaction as Prisma.TransactionClient | undefined
  if (!tx) {
    // Голосовое исполнение всегда идёт в транзакции: без неё запись в CRM и
    // результат заявки разъехались бы.
    throw refusal("TRANSACTION_REQUIRED")
  }
  if (!actor.userId) throw refusal("FORBIDDEN")

  // Пределы доступа читаются ТОЙ ЖЕ транзакцией: через глобальный клиент под
  // FORCE RLS доверенности координатора вернулись бы пустыми, и он потерял бы
  // право на мастера, которое у него есть.
  const access = await voiceBookingAccess({
    orgId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    // Голосовая запись принципиально сессионная: подтверждение и фиксация
    // идут через withRlsSessionAuth, ключ интеграции сюда не попадает.
    principalType: "session",
  }, tx)
  if (!access) throw refusal("FORBIDDEN")

  const version = Number(payload.expectedVersion)
  if (!Number.isInteger(version) || version < 0) {
    throw refusal("INVALID_INPUT")
  }
  const idempotencyKey = idempotencyKeyOf(actor)

  try {
    if (actionType === "cancel_booking") {
      const result = await runBookingCommand(access, bookingId, {
        operation: "cancel",
        version,
        idempotencyKey,
        note: "",
        reason: asString(payload.reason) ?? "",
        notifyCustomer: payload.notifyCustomer !== false,
      }, tx)
      return { bookingId: result.id, version: result.version }
    }

    if (actionType === "set_booking_outcome") {
      const outcome = payload.outcome === "no_show" ? "no_show" : "completed"
      const result = await runBookingCommand(access, bookingId, {
        operation: "outcome",
        version,
        idempotencyKey,
        outcome,
        note: asString(payload.note) ?? "",
        reason: asString(payload.reason) ?? "",
        notifyCustomer: true,
      }, tx)
      return { bookingId: result.id, version: result.version }
    }

    const deposit = payload.deposit === "refunded" ? "refunded" : "paid"
    const result = await runBookingCommand(access, bookingId, {
      operation: "deposit",
      version,
      idempotencyKey,
      deposit,
      note: "",
      reason: "",
      notifyCustomer: false,
    }, tx)
    return { bookingId: result.id, version: result.version }
  } catch (error) {
    asRefusal(error)
  }
}
