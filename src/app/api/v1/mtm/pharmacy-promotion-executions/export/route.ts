import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import {
  pharmacyPromotionFilterHash,
  pharmacyPromotionFilterValidationError,
  pharmacyPromotionFiltersFromSearchParams,
  pharmacyPromotionHash,
  reconcilePharmacyPromotionLedger,
} from "@/lib/mtm/pharmacy-promotion"
import {
  PHARMACY_PROMOTION_SNAPSHOT_ROW_MAX,
  pharmacyPromotionCapabilities,
  pharmacyPromotionExecutionOrderBy,
  pharmacyPromotionExecutionWhere,
  pharmacyPromotionSelectionHash,
  pharmacyPromotionSnapshotSelect,
} from "@/lib/mtm/pharmacy-promotion-query"
import { contentDispositionAttachment, toCsv } from "@/lib/export/tabular"

const EXPORT_MAX = 20_000

const copy = {
  en: {
    headers: ["Execution ID", "Promotion", "Code", "Type", "Pharmacy", "Address", "Registration code", "Employee", "Team", "Manager", "Plan", "Fact", "Unit", "Execution", "Visit", "L1", "L2", "Fact points", "Reward points", "Difference", "Formula version", "Formula hash", "Source", "Source observed", "Created", "Closed"],
    file: "pharmacy-promotion-executions.csv",
  },
  ru: {
    headers: ["ID выполнения", "Промоакция", "Код", "Тип", "Аптека", "Адрес", "Регистрационный код", "Сотрудник", "Команда", "Менеджер", "План", "Факт", "Единица", "Выполнение", "Визит", "L1", "L2", "Фактические баллы", "Бонусные баллы", "Разница", "Версия формулы", "Хеш формулы", "Источник", "Время источника", "Создано", "Закрыто"],
    file: "выполнения-аптечных-промоакций.csv",
  },
  az: {
    headers: ["İcra ID", "Promosiya", "Kod", "Növ", "Aptek", "Ünvan", "Qeydiyyat kodu", "Əməkdaş", "Komanda", "Menecer", "Plan", "Fakt", "Vahid", "İcra", "Ziyarət", "L1", "L2", "Fakt xalları", "Mükafat xalları", "Fərq", "Formula versiyası", "Formula heşi", "Mənbə", "Mənbə vaxtı", "Yaradılıb", "Bağlanıb"],
    file: "aptek-promosiya-icralari.csv",
  },
} as const

type ExportLocale = keyof typeof copy

const valueCopy: Record<ExportLocale, {
  execution: Record<string, string>
  visit: Record<string, string>
  review: Record<string, string>
  source: Record<string, string>
  unknownExecution: string
  unknownVisit: string
  unknownReview: string
  unknownSource: string
}> = {
  en: {
    execution: { DRAFT: "Draft", READY: "Ready", IN_REVIEW: "In review", APPROVED: "Approved", RETURNED: "Returned", REJECTED: "Rejected", REVERSED: "Reversed" },
    visit: { CHECKED_IN: "Checked in", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled" },
    review: { NOT_READY: "Blocked", READY: "Ready", APPROVED: "Approved", RETURNED: "Returned", REJECTED: "Rejected" },
    source: { FIELD_AGENT_WEB: "Field agent · web", FIELD_AGENT_MOBILE: "Field agent · mobile" },
    unknownExecution: "Unknown execution status",
    unknownVisit: "Unknown visit status",
    unknownReview: "Unknown review status",
    unknownSource: "Source system not identified",
  },
  ru: {
    execution: { DRAFT: "Черновик", READY: "Готово", IN_REVIEW: "На проверке", APPROVED: "Одобрено", RETURNED: "Возвращено", REJECTED: "Отклонено", REVERSED: "Сторнировано" },
    visit: { CHECKED_IN: "Визит начат", CHECKED_OUT: "Визит завершён", CANCELLED: "Визит отменён" },
    review: { NOT_READY: "Заблокировано", READY: "Готово", APPROVED: "Одобрено", RETURNED: "Возвращено", REJECTED: "Отклонено" },
    source: { FIELD_AGENT_WEB: "Полевой сотрудник · веб", FIELD_AGENT_MOBILE: "Полевой сотрудник · мобильное приложение" },
    unknownExecution: "Статус выполнения неизвестен",
    unknownVisit: "Статус визита неизвестен",
    unknownReview: "Статус проверки неизвестен",
    unknownSource: "Система-источник не определена",
  },
  az: {
    execution: { DRAFT: "Qaralama", READY: "Hazır", IN_REVIEW: "Yoxlanılır", APPROVED: "Təsdiqlənib", RETURNED: "Qaytarılıb", REJECTED: "Rədd edilib", REVERSED: "Geri çevrilib" },
    visit: { CHECKED_IN: "Vizit başlayıb", CHECKED_OUT: "Vizit tamamlanıb", CANCELLED: "Vizit ləğv edilib" },
    review: { NOT_READY: "Bloklanıb", READY: "Hazır", APPROVED: "Təsdiqlənib", RETURNED: "Qaytarılıb", REJECTED: "Rədd edilib" },
    source: { FIELD_AGENT_WEB: "Sahə əməkdaşı · veb", FIELD_AGENT_MOBILE: "Sahə əməkdaşı · mobil tətbiq" },
    unknownExecution: "İcra statusu məlum deyil",
    unknownVisit: "Vizit statusu məlum deyil",
    unknownReview: "Yoxlama statusu məlum deyil",
    unknownSource: "Mənbə sistemi müəyyən edilməyib",
  },
}

function localizedValue(map: Record<string, string>, value: string | null | undefined, fallback: string) {
  if (!value) return ""
  return map[value] ?? fallback
}

const exportInclude = {
  target: {
    include: {
      promotionVersion: {
        include: {
          promotion: { select: { code: true } },
          type: { select: { code: true, nameRu: true, nameAz: true, nameEn: true } },
        },
      },
    },
  },
  visit: { select: { status: true } },
  ledgerEntries: { select: { bucket: true, delta: true } },
} satisfies Prisma.MtmPharmacyPromotionExecutionInclude

type ExportExecutionRow = Prisma.MtmPharmacyPromotionExecutionGetPayload<{
  include: typeof exportInclude
}>

export const GET = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  const url = new URL(req.url)
  const filters = pharmacyPromotionFiltersFromSearchParams(url.searchParams)
  const invalid = pharmacyPromotionFilterValidationError(filters)
  if (invalid) return NextResponse.json({ error: "Invalid promotion filter", ...invalid }, { status: 400 })
  const locale = url.searchParams.get("locale") === "az"
    ? "az"
    : url.searchParams.get("locale") === "en" ? "en" : "ru"
  const requestedSnapshot = url.searchParams.get("snapshotId") ?? ""

  try {
    const settings = await getMtmSettings(auth.orgId)
    const capabilities = pharmacyPromotionCapabilities(actor, settings.pharmacyPromotionPostingEnabled)
    if (!capabilities.canExport) return NextResponse.json({ error: "Export is not permitted", code: "MTM_PHARMACY_EXPORT_DENIED" }, { status: 403 })
    const where = pharmacyPromotionExecutionWhere({
      organizationId: auth.orgId,
      actor,
      filters,
      timezone: settings.timezone,
    })
    const filterHash = pharmacyPromotionFilterHash(filters)
    const scopedAgentIds = actor.scopedAgentIds === null
      ? null
      : [...actor.scopedAgentIds].sort()
    const scopeHash = pharmacyPromotionHash({
      organizationId: auth.orgId,
      role: actor.role,
      agentId: actor.agentId,
      scopedAgentIds,
    })
    const snapshot = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [total, executionFreshness, ledgerFreshness, visitFreshness, ledgerTotals, snapshotRows] = await Promise.all([
        tx.mtmPharmacyPromotionExecution.count({ where }),
        tx.mtmPharmacyPromotionExecution.aggregate({ where, _max: { updatedAt: true } }),
        tx.mtmPharmacyPointsLedgerEntry.aggregate({
          where: { organizationId: auth.orgId, execution: where },
          _max: { occurredAt: true },
        }),
        tx.mtmVisit.aggregate({
          where: {
            organizationId: auth.orgId,
            pharmacyPromotionExecutions: { some: where },
          },
          _max: { updatedAt: true },
        }),
        tx.mtmPharmacyPointsLedgerEntry.groupBy({
          by: ["bucket"],
          where: { organizationId: auth.orgId, execution: where },
          _sum: { delta: true },
          orderBy: { bucket: "asc" },
        }),
        tx.mtmPharmacyPromotionExecution.findMany({
          where,
          orderBy: { id: "asc" },
          take: PHARMACY_PROMOTION_SNAPSHOT_ROW_MAX,
          select: pharmacyPromotionSnapshotSelect,
        }),
      ])
      const snapshotId = pharmacyPromotionHash({
        filterHash,
        scopeHash,
        total,
        executionUpdatedAt: executionFreshness._max.updatedAt,
        ledgerOccurredAt: ledgerFreshness._max.occurredAt,
        visitUpdatedAt: visitFreshness._max.updatedAt,
        ledgerTotals,
        selectionHash: pharmacyPromotionSelectionHash(snapshotRows),
      })
      if (!requestedSnapshot || requestedSnapshot !== snapshotId) {
        return { kind: "stale" as const, snapshotId }
      }
      if (total > EXPORT_MAX) {
        return { kind: "too-large" as const, snapshotId, total }
      }
      const rows = await tx.mtmPharmacyPromotionExecution.findMany({
        where,
        orderBy: pharmacyPromotionExecutionOrderBy(filters),
        take: EXPORT_MAX,
        include: exportInclude,
      })
      return { kind: "ready" as const, snapshotId, rows }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    })
    if (snapshot.kind === "stale") {
      return NextResponse.json({
        error: "Registry snapshot changed; refresh before export",
        code: "MTM_PHARMACY_EXPORT_SNAPSHOT_STALE",
        snapshotId: snapshot.snapshotId,
      }, { status: 409 })
    }
    if (snapshot.kind === "too-large") {
      return NextResponse.json({
        error: `Export is limited to ${EXPORT_MAX} rows; narrow the filters`,
        code: "MTM_PHARMACY_EXPORT_TOO_LARGE",
        total: snapshot.total,
        limit: EXPORT_MAX,
      }, { status: 413 })
    }
    const outputRows = snapshot.rows.map((row: ExportExecutionRow) => {
      const factEntries = row.ledgerEntries.filter((entry) => entry.bucket === "FACT_POINTS")
      const rewardEntries = row.ledgerEntries.filter((entry) => entry.bucket === "REWARD_POINTS")
      const factPoints = factEntries.length ? reconcilePharmacyPromotionLedger(factEntries) : null
      const rewardPoints = rewardEntries.length ? reconcilePharmacyPromotionLedger(rewardEntries) : null
      const version = row.target.promotionVersion
      const promotionName = locale === "az" ? version.nameAz : locale === "en" ? version.nameEn : version.nameRu
      const typeName = locale === "az" ? version.type.nameAz : locale === "en" ? version.type.nameEn : version.type.nameRu
      return [
        row.id,
        promotionName,
        version.promotion.code,
        `${typeName} (${version.type.code})`,
        row.target.customerNameSnapshot,
        row.target.customerAddressSnapshot,
        row.target.customerRegistrationSnapshot,
        row.target.agentNameSnapshot,
        row.target.teamNameSnapshot,
        row.target.managerNameSnapshot,
        row.planQuantitySnapshot.toString(),
        row.actualQuantity.toString(),
        row.unit,
        localizedValue(valueCopy[locale].execution, row.status, valueCopy[locale].unknownExecution),
        localizedValue(valueCopy[locale].visit, row.visit?.status, valueCopy[locale].unknownVisit),
        localizedValue(valueCopy[locale].review, row.l1State, valueCopy[locale].unknownReview),
        localizedValue(valueCopy[locale].review, row.l2State, valueCopy[locale].unknownReview),
        factPoints,
        rewardPoints,
        factPoints === null && rewardPoints === null
          ? null
          : new Prisma.Decimal(factPoints ?? 0).minus(rewardPoints ?? 0).toFixed(4),
        row.formulaVersion,
        row.formulaHash,
        localizedValue(valueCopy[locale].source, row.sourceSystem, valueCopy[locale].unknownSource),
        row.sourceObservedAt,
        row.createdAt,
        row.closedAt,
      ]
    })
    const csv = toCsv([...copy[locale].headers], outputRows)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDispositionAttachment(copy[locale].file),
        "Cache-Control": "private, no-store",
        "X-MTM-Filter-Hash": filterHash,
        "X-MTM-Snapshot-Id": snapshot.snapshotId,
      },
    })
  } catch (error) {
    console.error("[MTM/pharmacy-promotion export]", error)
    return NextResponse.json({ error: "Export failed", code: "MTM_PHARMACY_EXPORT_FAILED" }, { status: 500 })
  }
})
