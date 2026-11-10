import { z } from "zod"

/**
 * Что голос кладёт в квитанцию телефонного заказа (этап 5, 2026-11-10).
 * Чистые схемы: реестр голоса попадает и в браузерный бандл.
 *
 * Все id и товар каталога кладёт сервер (propose-resolve), не модель: заказ,
 * строку и товар он нашёл сам, под организацией. `revision` — версия заказа,
 * которую человек видит в квитанции: изменился заказ (станция дописала,
 * менеджер поправил на экране) — квитанция устарела, и правка не ложится
 * вслепую.
 */
const id = z.string().min(1).max(64)
const revision = z.number().int().positive()
const quantity = z.number().int().min(1).max(100_000)
/** Товар каталога 1С, как его нашёл сервер: с ценой, по которой ляжет строка. */
const product = {
  externalId: z.uuid(),
  itemCode: z.string().max(64),
  productName: z.string().min(1).max(500),
  sourceName: z.string().min(1).max(500),
  unitPrice: z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/).nullable(),
}

export const voicePhoneOrderSchemas = {
  /** Сменить количество строки, товар строки или и то и другое. */
  updateLine: z.strictObject({
    orderId: id, revision, lineId: id,
    quantity: quantity.optional(),
    externalId: product.externalId.optional(),
    itemCode: product.itemCode.optional(),
    productName: product.productName.optional(),
    sourceName: product.sourceName.optional(),
    unitPrice: product.unitPrice.optional(),
  }).refine((value) => value.quantity !== undefined || value.externalId !== undefined, {
    message: "Name a new quantity or a new product",
  }).refine((value) => value.externalId === undefined || (
    value.itemCode !== undefined && value.productName !== undefined
    && value.sourceName !== undefined && value.unitPrice !== undefined
  ), { message: "A product comes with its catalog details" }),
  addLine: z.strictObject({
    orderId: id, revision, ...product, quantity,
    unit: z.string().trim().toLowerCase().min(1).max(24),
  }),
  removeLine: z.strictObject({ orderId: id, revision, lineId: id }),
  confirm: z.strictObject({ orderId: id, revision }),
  reject: z.strictObject({ orderId: id, revision, reason: z.string().trim().min(1).max(500) }),
} as const
