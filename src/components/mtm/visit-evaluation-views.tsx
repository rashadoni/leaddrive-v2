"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, UsersRound } from "lucide-react"
import { Hint } from "@/components/hint"
import { formatDateTime } from "@/lib/format-date"
import { MTM_VISIT_EVALUATION_CRITERIA, type MtmVisitEvaluationScores } from "@/lib/mtm/visit-evaluation-criteria"

/*
 * Joint visit in the office's MTM (owner-approved mockup, 2026-10-20): the
 * manager's rating on a visit card, and «Оценки руководителя» on the agent's
 * page. Both are for the office; an agent never reads a rating.
 */

type Translator = (key: string, values?: Record<string, string | number>) => string

export interface JointVisitReview {
  manager: { id: string; name: string | null }
  evaluations: Array<{
    evaluator: { id: string; name: string }
    scores: MtmVisitEvaluationScores
    average: number | null
    comment: string | null
    createdAt: string
    updatedAt: string
  }>
}

export interface AgentEvaluationsSummary {
  days: number
  timezone: string
  jointVisits: number
  evaluated: number
  average: number | null
  criteria: Array<{ key: string; count: number; average: number | null }>
  recent: Array<{
    visitId: string
    checkInAt: string
    customer: { id: string; name: string | null }
    contact: { id: string; displayName: string | null } | null
    evaluator: { id: string; name: string }
    average: number | null
    comment: string | null
    updatedAt: string
  }>
}

function useScoreText() {
  const locale = useLocale()
  return (value: number) => value.toLocaleString(locale, { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 })
}

/** «Совместный» beside the agent in the list of visits: his manager was on it, by the agent's own answer. */
export function JointVisitMark() {
  const t = useTranslations("mtmJointVisit") as unknown as Translator
  return (
    <Hint text={t("listBadgeHint")}>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-300" data-testid="mtm-visit-joint-mark">
        <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />{t("listBadge")}
      </span>
    </Hint>
  )
}

/** Five dots, as many dark as the score (rounded), the rest grey. */
export function ScoreDots({ value, label }: { value: number; label: string }) {
  const filled = Math.round(value)
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${dot <= filled ? "bg-zinc-700 dark:bg-zinc-200" : "bg-zinc-200 dark:bg-zinc-700"}`}
        />
      ))}
    </span>
  )
}

function BigScore({ value, t }: { value: number | null; t: Translator }) {
  const scoreText = useScoreText()
  if (value === null) return null
  return (
    <p className="shrink-0 text-right tabular-nums">
      <span className="text-3xl font-semibold leading-none text-foreground">{scoreText(value)}</span>{" "}
      <span className="text-sm text-muted-foreground">{t("outOfFive")}</span>
    </p>
  )
}

/** «Совместный визит с руководителем» in the visit card: who was there and how he rated it. */
export function JointVisitReviewBlock({ jointVisit, timezone }: { jointVisit: JointVisitReview; timezone: string }) {
  const t = useTranslations("mtmJointVisit") as unknown as Translator
  const locale = useLocale()
  const scoreText = useScoreText()
  const managerName = jointVisit.manager.name || t("managerFallback")
  const when = (value: string) => formatDateTime(value, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone }) || "—"

  return (
    <section className="border-b border-border px-4 py-3 sm:px-5" data-testid="mtm-visit-joint-block">
      {jointVisit.evaluations.length === 0 ? (
        <div className="flex items-start gap-2">
          <UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("notRated", { name: managerName })}</p>
          </div>
        </div>
      ) : jointVisit.evaluations.map((evaluation) => (
        <div key={evaluation.evaluator.id} data-testid="mtm-visit-evaluation">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("ratedBy", { name: evaluation.evaluator.name, date: when(evaluation.updatedAt) })}
              </p>
            </div>
            <BigScore value={evaluation.average} t={t} />
          </div>
          <dl className="mt-2">
            {MTM_VISIT_EVALUATION_CRITERIA.map((key) => {
              const score = evaluation.scores[key]
              return (
                <div key={key} className="grid grid-cols-[1fr_auto_1.75rem] items-center gap-3 py-1 text-sm">
                  <dt className="text-foreground">{t(`criteria.${key}`)}</dt>
                  {typeof score === "number" ? (
                    <>
                      <dd><ScoreDots value={score} label={t("scoreLabel", { score: scoreText(score) })} /></dd>
                      <dd className="text-right font-semibold tabular-nums">{score}</dd>
                    </>
                  ) : (
                    <dd className="col-span-2 text-right text-xs text-muted-foreground">{t("skipped")}</dd>
                  )}
                </div>
              )
            })}
          </dl>
          {evaluation.comment ? (
            <p className="mt-2 whitespace-pre-line border-l-2 border-zinc-300 pl-3 text-sm text-foreground dark:border-zinc-600">{evaluation.comment}</p>
          ) : null}
        </div>
      ))}
    </section>
  )
}

/** The agent page's ratings, loaded once per agent; null until they come or when they cannot. */
export function useAgentEvaluations(agentId: string, enabled: boolean) {
  const [state, setState] = useState<{ data: AgentEvaluationsSummary | null; error: "forbidden" | "failed" | null }>(
    { data: null, error: null },
  )
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void fetch(`/api/v1/mtm/agents/${encodeURIComponent(agentId)}/evaluations`, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { success?: boolean; data?: AgentEvaluationsSummary } | null
        if (controller.signal.aborted) return
        if (response.ok && body?.success && body.data) setState({ data: body.data, error: null })
        else setState({ data: null, error: response.status === 403 ? "forbidden" : "failed" })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ data: null, error: "failed" })
      })
    return () => controller.abort()
  }, [agentId, enabled])
  return state
}

/** «Оценки руководителя» — the agent page's tab. */
export function MtmAgentEvaluations({ state }: { state: ReturnType<typeof useAgentEvaluations> }) {
  const t = useTranslations("mtmJointVisit") as unknown as Translator
  const locale = useLocale()
  const scoreText = useScoreText()

  if (!state.data && !state.error) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-busy="true" />
  }
  if (state.error || !state.data) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-l-4 border-border border-l-amber-500 bg-card p-4 text-sm text-foreground dark:border-l-amber-500">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{state.error === "forbidden" ? t("forbidden") : t("loadError")}</span>
      </div>
    )
  }

  const data = state.data
  const rated = data.criteria.filter((criterion) => criterion.average !== null)
  // «Слабее всего» only when there is something to compare and one point is lower than the rest.
  const lowest = rated.length >= 2 ? Math.min(...rated.map((criterion) => criterion.average ?? 5)) : null
  const weakest = lowest !== null && rated.filter((criterion) => criterion.average === lowest).length === 1 ? lowest : null
  const day = (value: string) => formatDateTime(value, locale, { day: "numeric", month: "short", timeZone: data.timezone }) || "—"

  if (data.evaluated === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm" data-testid="mtm-agent-evaluations">
        <h2 className="font-semibold text-foreground">{t("periodTitle", { days: data.days })}</h2>
        <p className="mt-1 text-muted-foreground">{t("periodJoint", { count: data.jointVisits })}</p>
        <p className="mt-2 text-muted-foreground">{t("empty")}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card" data-testid="mtm-agent-evaluations">
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">{t("periodTitle", { days: data.days })}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("periodJoint", { count: data.jointVisits })} · {t("periodRated", { count: data.evaluated })}
            </p>
          </div>
          <BigScore value={data.average} t={t} />
        </div>
        <dl className="mt-3 grid gap-x-8 lg:grid-cols-2">
          {data.criteria.map((criterion) => {
            const isWeakest = weakest !== null && criterion.average === weakest
            return (
              <div key={criterion.key} className="grid grid-cols-[1fr_auto_2.25rem] items-center gap-3 py-1.5 text-sm" data-testid={`mtm-agent-evaluation-${criterion.key}`}>
                <dt className={isWeakest ? "font-semibold text-amber-700 dark:text-amber-300" : "text-foreground"}>
                  {isWeakest ? t("weakest", { label: t(`criteria.${criterion.key}`) }) : t(`criteria.${criterion.key}`)}
                </dt>
                {criterion.average !== null ? (
                  <>
                    <dd><ScoreDots value={criterion.average} label={t("scoreLabel", { score: scoreText(criterion.average) })} /></dd>
                    <dd className={`text-right font-semibold tabular-nums ${isWeakest ? "text-amber-700 dark:text-amber-300" : ""}`}>{scoreText(criterion.average)}</dd>
                  </>
                ) : (
                  <dd className="col-span-2 text-right text-xs text-muted-foreground">{t("notRatedYet")}</dd>
                )}
              </div>
            )
          })}
        </dl>
      </div>
      <div className="p-4">
        <h3 className="text-sm font-semibold text-foreground">{t("recentTitle")}</h3>
        <ul className="mt-2 divide-y divide-border">
          {data.recent.map((item) => (
            <li key={item.visitId} className="grid grid-cols-[4.5rem_1fr_auto_auto] items-center gap-3 py-2 text-sm">
              <span className="text-muted-foreground">{day(item.checkInAt)}</span>
              <span className="min-w-0 truncate text-foreground">
                {[item.customer.name, item.contact?.displayName].filter(Boolean).join(" · ") || t("customerFallback")}
                <span className="text-muted-foreground"> · {item.evaluator.name}</span>
              </span>
              <span className="font-semibold tabular-nums">{item.average !== null ? scoreText(item.average) : "—"}</span>
              <Link href={`/mtm/visits?visitId=${encodeURIComponent(item.visitId)}`} className="text-sm font-semibold text-primary hover:underline">
                {t("openVisit")}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
