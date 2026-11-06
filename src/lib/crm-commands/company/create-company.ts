import type { Company, Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireFieldPermissions } from "@/lib/field-filter"
import { createNotification } from "@/lib/notifications"
import { routeNewCompanyToTerritories } from "@/lib/territory-routing"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { createCompanyCommandSchema, type CreateCompanyCommandInput } from "../schemas/company"

/**
 * Создание компании-клиента одной командой.
 *
 * Зачем команда, а не прямой вызов Prisma: голос создаёт компанию ровно тем же
 * путём, которым её создаёт экран `/api/v1/companies` — те же права на поля,
 * тот же журнал, то же уведомление и то же авто-распределение по территориям.
 * Расхождение здесь означало бы, что созданное голосом не видит тот, кто
 * отвечает за территорию, — и узнать об этом было бы не по чему.
 *
 * Владелец 2026-11-06: «создай клиента, название компании fanumsec» — действия
 * для этого у помощника не было вовсе, и фраза превращалась в ЛИД. Лид — это
 * ещё не клиент: его квалифицируют, а потом превращают в сделку.
 */

export interface CompanyDuplicateCandidate {
  id: string
  name: string
  city: string | null
  phone: string | null
}

export interface CreateCompanyCommandResult {
  entity: Company
  warnings: Array<{
    code: "POSSIBLE_DUPLICATE"
    candidates: CompanyDuplicateCandidate[]
  }>
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid company"
}

/** Организационно-правовые формы: они есть у половины названий и ничего не различают. */
const LEGAL_FORMS = new Set([
  "mmc", "asc", "qsc", "llc", "ltd", "inc", "gmbh", "ooo", "oao", "zao", "pao", "ip", "sp",
  "ооо", "оао", "зао", "пао", "ип", "ао",
])

/**
 * Слово, по которому ищется похожая компания.
 *
 * Сравнивать названия целиком нельзя: «Fanumsec» и «Fanumsec MMC» — почти
 * наверняка одна компания, но ни одно из них не содержит другого целиком, и
 * проверка «название содержит название» молча пропускает дубль (на этом
 * первая версия и попалась). Поэтому берётся самое длинное значимое слово —
 * у «Fanumsec MMC» это «Fanumsec», — и оно находит обе записи в любом
 * порядке создания. Форма («MMC», «ООО») отбрасывается: она не различает.
 */
export function companyDuplicateNeedle(name: string): string | null {
  const words = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !LEGAL_FORMS.has(word))
    .sort((a, b) => b.length - a.length)
  return words[0] ?? null
}

/**
 * Компания с похожим названием уже есть.
 *
 * Человек должен увидеть её ПЕРЕД подтверждением, а не найти второй карточкой
 * потом. Это предупреждение, а не запрет: два юридических лица с похожими
 * названиями — обычное дело, и решает человек.
 */
async function findDuplicateCandidates(
  db: Pick<Prisma.TransactionClient, "company">,
  organizationId: string,
  name: string,
): Promise<CompanyDuplicateCandidate[]> {
  const needle = companyDuplicateNeedle(name)
  if (!needle) return []
  const rows = await db.company.findMany({
    where: {
      organizationId,
      name: { contains: needle, mode: "insensitive" },
    },
    select: { id: true, name: true, city: true, phone: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  }) as CompanyDuplicateCandidate[]
  return rows
}

function dispatchCreatedCompanyEffects(
  actor: CrmCommandActorContext,
  company: Company,
): void {
  const orgId = actor.organizationId
  logAudit(orgId, "create", "company", company.id, company.name)
  createNotification({
    organizationId: orgId,
    type: "info",
    title: "Новая компания",
    message: `Добавлена компания «${company.name}»`,
    entityType: "company",
    entityId: company.id,
  }).catch(() => {})
  // Как и на экране: представителей территории, под чьи правила компания
  // подходит, предупреждает маршрутизация, и её отказ не роняет создание.
  routeNewCompanyToTerritories(prisma, {
    orgId,
    company: {
      id: company.id,
      name: company.name,
      country: company.country,
      industry: company.industry,
      employeeCount: company.employeeCount,
    },
  }).catch(() => {})
}

export async function createCompanyCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<CreateCompanyCommandResult> {
  const parsed = createCompanyCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))

  const { organizationId: orgId, role } = actor
  const db = execution?.transaction ?? prisma
  const fieldPermissions = await requireFieldPermissions(orgId, role, "company")
  const input = requireWritableFields(
    parsed.data as Record<string, unknown>,
    fieldPermissions,
    role,
  ) as CreateCompanyCommandInput

  const duplicateCandidates = await findDuplicateCandidates(db, orgId, input.name)
  const company = await db.company.create({
    data: {
      organizationId: orgId,
      name: input.name,
      industry: input.industry,
      // Пустая строка — это «не сказано», а не значение: схема принимает её
      // вместо URL и почты, чтобы форма могла прислать очищенное поле.
      website: input.website || null,
      phone: input.phone,
      email: input.email || null,
      address: input.address,
      city: input.city,
      country: input.country,
      description: input.description,
    },
  })

  dispatchOrDeferCommandEffects(execution, () => {
    dispatchCreatedCompanyEffects(actor, company)
  })

  return {
    entity: company,
    warnings: duplicateCandidates.length > 0
      ? [{ code: "POSSIBLE_DUPLICATE", candidates: duplicateCandidates }]
      : [],
  }
}
