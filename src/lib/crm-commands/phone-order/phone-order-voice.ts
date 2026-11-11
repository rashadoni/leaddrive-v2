import type { PrismaClient } from "@prisma/client"

import type { CrmCommandActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { dispatchOrDeferCommandEffects, type CrmCommandExecutionContext } from "@/lib/crm-commands/execution-context"
import { voicePhoneOrderSchemas } from "@/lib/crm-commands/schemas/phone-order"
import { erpConnection, type ErpConnection } from "@/lib/pharmacy-orders/erp-order"
import { notifyPharmacyOfDecision } from "@/lib/pharmacy-orders/manager-notice"
import {
  applyPhoneOrderActionInTx,
  callStillRunning,
  claimPhoneOrderErpSend,
  finishPhoneOrderErpSend,
  PhoneOrderError,
  phoneOrderCatalogItem,
  PHONE_ORDERS_FEATURE,
  type PhoneOrderAction,
  type PhoneOrderErpResult,
  type PickedItem,
} from "@/lib/pharmacy-orders/orders"
import { featureFlagsToArray } from "@/lib/modules"
import { prisma } from "@/lib/prisma"

/**
 * Телефонный заказ голосом (этап 5, владелец 2026-11-10). Те же шаги, что у
 * кнопок карточки заказа (applyPhoneOrderAction), но внутри транзакции
 * голосовой квитанции: правка заказа и результат квитанции фиксируются вместе.
 *
 * Подтверждение при подключённой 1С делится на две половины, как и на экране:
 * в транзакции квитанции заказ только занимается под отправку (`sending`), а
 * сам запрос в 1С (до двух вызовов по 20 с) идёт после коммита —
 * `finishVoicePhoneOrderConfirm`. Упал процесс между ними — заказ остаётся
 * `sending`, через 2 минуты считается «ответа нет», и следующее нажатие на
 * экране сначала спрашивает 1С, есть ли документ: тот же путь, что после
 * падения экрана.
 */

export type VoicePhoneOrderAction =
  | "update_phone_order_line"
  | "add_phone_order_line"
  | "remove_phone_order_line"
  | "confirm_phone_order"
  | "reject_phone_order"

type Execution = CrmCommandExecutionContext & Required<Pick<CrmCommandExecutionContext, "transaction">>

const PHONE_ORDER_MESSAGES: Record<PhoneOrderError["code"], [CrmCommandError["code"], string, 400 | 404 | 409]> = {
  not_found: ["NOT_FOUND", "The phone order was not found", 404],
  stale_revision: ["STALE_WRITE", "The order changed after the draft was prepared; prepare it again", 409],
  not_pending: ["CONFLICT", "The order is no longer waiting for review", 409],
  call_in_progress: ["CONFLICT", "The pharmacy is still on the call; the order can change only after it ends", 409],
  erp_pending: ["CONFLICT", "1C has not answered about this order yet; open the order and press Confirm there", 409],
  erp_unavailable: ["CONFLICT", "The 1C connection is not available right now", 409],
  invalid: ["VALIDATION_FAILED", "Every line needs a catalog product before the order can go", 400],
  erp_unit: ["VALIDATION_FAILED", "A line has no 1C price; pick the product again", 400],
  erp_pharmacy: ["VALIDATION_FAILED", "The order has no pharmacy from 1C; set it on the order card", 400],
  pharmacy_unconfirmed: ["CONFLICT", "The caller only named the pharmacy on the call; confirm it on the order card first", 409],
  catalog_unavailable: ["CONFLICT", "The catalog is not available right now", 409],
}

/** Ошибка заказа — языком квитанции: тот же код, что ведёт её в «не вышло». */
function asCommandError(error: unknown): unknown {
  if (!(error instanceof PhoneOrderError)) return error
  const [code, message, status] = PHONE_ORDER_MESSAGES[error.code]
  return new CrmCommandError(code, message, status, { reason: error.code })
}

/**
 * Товар каталога — каким его знает каталог заказа СЕЙЧАС, а не каким его
 * записала квитанция. Квитанция показала название и цену; поменялись они с тех
 * пор (новая выгрузка 1С) — строка не ляжет по цене, которой человек не видел.
 */
async function currentProduct(tx: Execution["transaction"], orgId: string, orderId: string, payload: Readonly<{
  externalId: string
  productName: string
  unitPrice: string | null
}>): Promise<PickedItem> {
  const item = await phoneOrderCatalogItem(tx, orgId, orderId, payload.externalId)
  const price = item.price?.amount ?? null
  const samePrice = price === null || payload.unitPrice === null
    ? price === payload.unitPrice
    : Number(price) === Number(payload.unitPrice)
  if (item.name !== payload.productName || !samePrice) {
    throw new CrmCommandError("STALE_WRITE", "The product's name or price in 1C changed after the draft was prepared; prepare it again", 409)
  }
  return item
}

/**
 * Всё чтение — через транзакцию квитанции: общий клиент внутри неё ходит
 * другим соединением без контекста организации, и RLS молча отдаёт 0 строк.
 */
async function assertEditable(tx: Execution["transaction"], actor: CrmCommandActorContext, orderId: string) {
  const org = await tx.organization.findUnique({ where: { id: actor.organizationId }, select: { features: true } })
  if (!featureFlagsToArray(org?.features).includes(PHONE_ORDERS_FEATURE)) throw new PhoneOrderError("not_found", 404)
  const head = await tx.pharmacyPhoneOrder.findFirst({
    where: { id: orderId, organizationId: actor.organizationId },
    select: { providerCallId: true, erpState: true },
  })
  if (!head) throw new PhoneOrderError("not_found", 404)
  // Станция сохраняет список после каждой позиции и заменяет его целиком:
  // правка во время звонка была бы затёрта.
  if (await callStillRunning(actor.organizationId, head.providerCallId, tx)) throw new PhoneOrderError("call_in_progress", 409)
  return head
}

function announceDecision(execution: Execution, orgId: string, orderId: string) {
  // Аптека слышит решение в WhatsApp — только после коммита.
  dispatchOrDeferCommandEffects(execution, () => notifyPharmacyOfDecision(prisma as unknown as PrismaClient, orgId, orderId)
    .then(() => undefined))
}

/** Одна голосовая правка заказа. Возвращает id заказа — на него ведёт «готово». */
export async function runVoicePhoneOrderCommand(
  actor: CrmCommandActorContext,
  actionType: VoicePhoneOrderAction,
  rawPayload: unknown,
  execution: Execution,
): Promise<{ orderId: string }> {
  if (!actor.userId) throw new CrmCommandError("FORBIDDEN", "A person must confirm a phone order change", 403)
  const userId = actor.userId
  const orgId = actor.organizationId
  const tx = execution.transaction
  try {
    if (actionType === "update_phone_order_line") {
      const payload = voicePhoneOrderSchemas.updateLine.parse(rawPayload)
      await assertEditable(tx, actor, payload.orderId)
      let revision = payload.revision
      // Товар сначала: количество потом ложится по цене нового товара.
      if (payload.externalId !== undefined) {
        await applyPhoneOrderActionInTx(tx, orgId, userId, payload.orderId,
          { action: "pick_product", revision, lineId: payload.lineId, externalId: payload.externalId },
          await currentProduct(tx, orgId, payload.orderId, {
            externalId: payload.externalId,
            productName: payload.productName ?? "",
            unitPrice: payload.unitPrice ?? null,
          }))
        revision += 1
      }
      if (payload.quantity !== undefined) {
        await applyPhoneOrderActionInTx(tx, orgId, userId, payload.orderId,
          { action: "set_quantity", revision, lineId: payload.lineId, quantity: payload.quantity }, null)
      }
      return { orderId: payload.orderId }
    }
    if (actionType === "add_phone_order_line") {
      const payload = voicePhoneOrderSchemas.addLine.parse(rawPayload)
      await assertEditable(tx, actor, payload.orderId)
      await applyPhoneOrderActionInTx(tx, orgId, userId, payload.orderId, {
        action: "add_line", revision: payload.revision, externalId: payload.externalId,
        quantity: payload.quantity, unit: payload.unit,
      }, await currentProduct(tx, orgId, payload.orderId, payload))
      return { orderId: payload.orderId }
    }
    if (actionType === "remove_phone_order_line") {
      const payload = voicePhoneOrderSchemas.removeLine.parse(rawPayload)
      await assertEditable(tx, actor, payload.orderId)
      await applyPhoneOrderActionInTx(tx, orgId, userId, payload.orderId,
        { action: "remove_line", revision: payload.revision, lineId: payload.lineId }, null)
      return { orderId: payload.orderId }
    }
    if (actionType === "reject_phone_order") {
      const payload = voicePhoneOrderSchemas.reject.parse(rawPayload)
      const head = await assertEditable(tx, actor, payload.orderId)
      // Заказ, который, может быть, уже лежит в 1С, отклоняет только экран
      // после ответа 1С — как и правки (ERP_EDITABLE).
      if (head.erpState === "sending" || head.erpState === "unknown") throw new PhoneOrderError("erp_pending", 409)
      await applyPhoneOrderActionInTx(tx, orgId, userId, payload.orderId,
        { action: "reject", revision: payload.revision, reason: payload.reason } satisfies PhoneOrderAction, null)
      announceDecision(execution, orgId, payload.orderId)
      return { orderId: payload.orderId }
    }
    const payload = voicePhoneOrderSchemas.confirm.parse(rawPayload)
    const head = await assertEditable(tx, actor, payload.orderId)
    let connection: ErpConnection | null
    try { connection = await erpConnection(orgId) } catch { throw new PhoneOrderError("erp_unavailable", 503) }
    if (connection) {
      await claimPhoneOrderErpSend(tx, orgId, payload.orderId, payload.revision)
      return { orderId: payload.orderId }
    }
    if (head.erpState === "sending" || head.erpState === "unknown") throw new PhoneOrderError("erp_unavailable", 503)
    await applyPhoneOrderActionInTx(tx, orgId, userId, payload.orderId,
      { action: "confirm", revision: payload.revision }, null)
    announceDecision(execution, orgId, payload.orderId)
    return { orderId: payload.orderId }
  } catch (error) {
    throw asCommandError(error)
  }
}

export type VoicePhoneOrderConfirmOutcome =
  /** 1С у организации нет: заказ подтверждён в CRM. */
  | Readonly<{ erp: "none" }>
  | Readonly<{ erp: PhoneOrderErpResult["state"]; document: PhoneOrderErpResult["document"] }>

/**
 * Вторая половина голосового подтверждения — после коммита квитанции. Шлёт
 * только то, что заняла ЭТА квитанция только что: заказ в `sending`, занятый
 * не дольше двух минут назад. Иначе ничего не шлёт (заказ закрыт без 1С, или
 * отправку уже ведёт кто-то другой) и отвечает, что видит.
 */
export async function finishVoicePhoneOrderConfirm(
  orgId: string,
  userId: string,
  orderId: string,
): Promise<VoicePhoneOrderConfirmOutcome> {
  const order = await prisma.pharmacyPhoneOrder.findFirst({
    where: { id: orderId, organizationId: orgId },
    select: { status: true, erpState: true, erpAttemptAt: true, erpDocument: true },
  })
  if (!order) return { erp: "unknown", document: null }
  if (order.erpState === null) return { erp: "none" }
  if (order.erpState !== "sending" || !order.erpAttemptAt || Date.now() - order.erpAttemptAt.getTime() > 2 * 60_000) {
    return order.erpState === "created"
      ? { erp: "created", document: order.erpDocument as PhoneOrderErpResult["document"] }
      : { erp: order.erpState === "refused" ? "refused" : "unknown", document: null }
  }
  let connection: ErpConnection | null
  try { connection = await erpConnection(orgId) } catch { connection = null }
  // Подключение пропало между коммитом и отправкой: заказ остаётся `sending`
  // и через две минуты считается «ответа нет» — экран спросит 1С сам.
  if (!connection) return { erp: "unknown", document: null }
  // Спросить 1С сначала: дешевле лишнего запроса, чем документ дважды.
  return finishPhoneOrderErpSend(orgId, userId, orderId, order.erpAttemptAt, connection, true)
    .then((result) => ({ erp: result.state, document: result.document }))
}
