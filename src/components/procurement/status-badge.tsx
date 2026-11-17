"use client"

import { useTranslations } from "next-intl"

const ORDER_TINT: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  approved: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  sent: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  in_production: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  in_transit: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  partially_received: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
  received: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
}

const REQUEST_TINT: Record<string, string> = {
  draft: ORDER_TINT.draft,
  submitted: ORDER_TINT.pending_approval,
  in_progress: ORDER_TINT.sent,
  ordered: ORDER_TINT.received,
  closed: ORDER_TINT.cancelled,
  cancelled: ORDER_TINT.cancelled,
}

export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations("procurement.common.orderStatus")
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_TINT[status] ?? ORDER_TINT.draft}`}>{t.has(status) ? t(status as never) : status}</span>
}

export function RequestStatusBadge({ status }: { status: string }) {
  const t = useTranslations("procurement.common.requestStatus")
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_TINT[status] ?? REQUEST_TINT.draft}`}>{t.has(status) ? t(status as never) : status}</span>
}

export function LateBadge() {
  const t = useTranslations("procurement.common")
  return <span className="inline-flex rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">{t("late")}</span>
}
