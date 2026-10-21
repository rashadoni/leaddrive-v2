"use client"

import { Hint } from "@/components/hint"
import { useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2, Undo2, UsersRound } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT,
  MTM_VISIT_EVALUATION_QUESTION_MAX_LENGTH,
  coerceMtmVisitEvaluationQuestions,
  newVisitEvaluationQuestionId,
  renameVisitEvaluationQuestion,
  visitEvaluationQuestionLabel,
  type MtmVisitEvaluationQuestion,
  type MtmVisitEvaluationQuestionLabels,
} from "@/lib/mtm/visit-evaluation-questions"

type Language = keyof MtmVisitEvaluationQuestionLabels
const LANGUAGES: readonly Language[] = ["az", "ru", "en"]
const LANGUAGE_LABEL_KEYS = { az: "evalQuestionLabelAZ", ru: "evalQuestionLabelRU", en: "evalQuestionLabelEN" } as const

type Editing = { id: string; isNew: boolean; labels: MtmVisitEvaluationQuestionLabels }
type Row =
  | { kind: "question"; question: MtmVisitEvaluationQuestion; index: number }
  | { kind: "removed"; question: MtmVisitEvaluationQuestion; after: string | null }

/**
 * «Оценка на совместном визите» on the «Визит» tab: the questions a manager
 * rates an agent by (owner-approved mockup, 2026-10-21). Every question has
 * its buttons with words — «Изменить», «Удалить» — because a name that opens
 * when clicked was not found: «а как редактировать… или хочу удалить?».
 *
 * It edits this page's draft; the page's «Сохранить» stores it. A question
 * deleted since the last save stays in its place as a line with «Вернуть»
 * until then. What is already rated is not touched either way: every rating
 * keeps the questions it was given against.
 */
export function VisitEvaluationQuestionSettings({
  value,
  saved,
  onChange,
}: {
  value: unknown
  saved: unknown
  onChange: (value: MtmVisitEvaluationQuestion[]) => void
}) {
  const t = useTranslations("mtmSettingsPage")
  const viewerLocale = useLocale()
  const language: Language = viewerLocale === "az" || viewerLocale === "en" ? viewerLocale : "ru"
  const questions = Array.isArray(value) ? value as MtmVisitEvaluationQuestion[] : coerceMtmVisitEvaluationQuestions(value)
  const savedQuestions = Array.isArray(saved) ? saved as MtmVisitEvaluationQuestion[] : coerceMtmVisitEvaluationQuestions(saved)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [otherLanguagesOpen, setOtherLanguagesOpen] = useState(false)

  const label = (question: Pick<MtmVisitEvaluationQuestion, "labels">) => visitEvaluationQuestionLabel(question, language)
  const inDraft = new Set(questions.map((question) => question.id))

  // The list as it stands, with every question deleted since the last save
  // drawn where it was, after the nearest question above it that is still there.
  const removedAfter = new Map<string | null, MtmVisitEvaluationQuestion[]>()
  savedQuestions.forEach((question, savedIndex) => {
    if (inDraft.has(question.id)) return
    const above = savedQuestions.slice(0, savedIndex).reverse().find((candidate) => inDraft.has(candidate.id))?.id ?? null
    removedAfter.set(above, [...(removedAfter.get(above) ?? []), question])
  })
  const rows: Row[] = (removedAfter.get(null) ?? []).map((question) => ({ kind: "removed" as const, question, after: null }))
  questions.forEach((question, index) => {
    rows.push({ kind: "question", question, index })
    for (const removed of removedAfter.get(question.id) ?? []) rows.push({ kind: "removed", question: removed, after: question.id })
  })

  const startEditing = (question: MtmVisitEvaluationQuestion | null) => {
    setOtherLanguagesOpen(false)
    setEditing(question
      ? { id: question.id, isNew: false, labels: { ...question.labels } }
      : { id: newVisitEvaluationQuestionId(), isNew: true, labels: { az: "", ru: "", en: "" } })
  }

  const editText = (target: Language, text: string) => {
    setEditing((current) => current && {
      ...current,
      labels: target === language ? renameVisitEvaluationQuestion(current.labels, target, text) : { ...current.labels, [target]: text },
    })
  }

  const finishEditing = () => {
    if (!editing) return
    const main = editing.labels[language].trim()
    if (!main) return
    // A language left empty reads as the one written.
    const labels = Object.fromEntries(LANGUAGES.map((other) => [other, editing.labels[other].trim() || main])) as MtmVisitEvaluationQuestionLabels
    onChange(editing.isNew
      ? [...questions, { id: editing.id, labels }]
      : questions.map((question) => question.id === editing.id ? { ...question, labels } : question))
    setEditing(null)
  }

  const remove = (id: string) => {
    if (editing?.id === id) setEditing(null)
    onChange(questions.filter((question) => question.id !== id))
  }

  const restore = (question: MtmVisitEvaluationQuestion, after: string | null) => {
    const at = after === null ? 0 : questions.findIndex((candidate) => candidate.id === after) + 1
    onChange([...questions.slice(0, at), question, ...questions.slice(at)])
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    const [question] = next.splice(index, 1)
    next.splice(target, 0, question)
    onChange(next)
  }

  const full = questions.length >= MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT
  const lastOne = questions.length <= 1

  const editor = (current: Editing) => (
    <div className="space-y-2 pb-3 pl-[4.75rem] pr-1" data-testid="visit-evaluation-question-editor">
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">{t(current.isNew ? "evalQuestionNewText" : "evalQuestionText")}</span>
        <Input
          autoFocus
          value={current.labels[language]}
          maxLength={MTM_VISIT_EVALUATION_QUESTION_MAX_LENGTH}
          placeholder={t("evalQuestionPlaceholder")}
          onChange={(event) => editText(language, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); finishEditing() }
            if (event.key === "Escape") setEditing(null)
          }}
          data-testid="visit-evaluation-question-input"
        />
      </label>
      {otherLanguagesOpen ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {LANGUAGES.filter((other) => other !== language).map((other) => (
            <label key={other} className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t(LANGUAGE_LABEL_KEYS[other])}</span>
              <Input
                value={current.labels[other]}
                maxLength={MTM_VISIT_EVALUATION_QUESTION_MAX_LENGTH}
                onChange={(event) => editText(other, event.target.value)}
              />
            </label>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={otherLanguagesOpen}
          onClick={() => setOtherLanguagesOpen((open) => !open)}
          className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", otherLanguagesOpen && "rotate-180")} aria-hidden="true" />
          {t("evalQuestionOtherLanguages")}
        </button>
        <span className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>{t("evalQuestionCancel")}</Button>
          <Hint wrap text={current.labels[language].trim() ? t("hint.evalQuestionDone") : t("hint.evalQuestionDoneEmpty")}>
            <Button type="button" size="sm" onClick={finishEditing} disabled={!current.labels[language].trim()} data-testid="visit-evaluation-question-done">
              {t("evalQuestionDone")}
            </Button>
          </Hint>
        </span>
      </div>
    </div>
  )

  return (
    <section className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700" aria-labelledby="visit-evaluation-questions-title" data-testid="visit-evaluation-questions">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="visit-evaluation-questions-title" className="text-base font-semibold">{t("evalQuestionsTitle")}</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("evalQuestionsHint")}</p>
        </div>
        <Hint wrap text={full ? t("hint.evalQuestionAddFull", { count: MTM_VISIT_EVALUATION_QUESTION_MAX_COUNT }) : t("hint.evalQuestionAdd")}>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            onClick={() => startEditing(null)}
            disabled={full || editing?.isNew === true}
            data-testid="visit-evaluation-question-add"
          >
            <Plus className="h-4 w-4" />{t("evalQuestionAdd")}
          </Button>
        </Hint>
      </div>

      {/* Two equal halves, like the planner buttons on «Маршруты»: the list and
          the manager's sheet drawn from it stand side by side. */}
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ul className="min-w-0 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700" data-testid="visit-evaluation-question-rows">
          {rows.map((row) => {
            if (row.kind === "removed") {
              return (
                <li key={`removed-${row.question.id}`} className="bg-muted/40" data-testid={`visit-evaluation-question-removed-${row.question.id}`}>
                  <div className="flex flex-wrap items-center gap-2 py-2 pl-[4.75rem] pr-1">
                    <span className="min-w-[8rem] flex-1">
                      <span className="block text-sm font-medium text-muted-foreground">{t("evalQuestionRemoved", { name: label(row.question) })}</span>
                      <span className="block text-xs text-muted-foreground">{t("evalQuestionRemovedHint")}</span>
                    </span>
                    <Hint wrap text={t("hint.evalQuestionRestore")}>
                      <Button type="button" variant="outline" size="sm" onClick={() => restore(row.question, row.after)} disabled={full}>
                        <Undo2 className="mr-1 h-4 w-4" />{t("evalQuestionRestore")}
                      </Button>
                    </Hint>
                  </div>
                </li>
              )
            }
            const { question, index } = row
            const isEditing = editing?.id === question.id
            return (
              <li key={question.id} className={cn(isEditing && "bg-orange-50/60 dark:bg-orange-950/20")} data-testid={`visit-evaluation-question-${question.id}`}>
                {/* On a narrow screen the two buttons go under the name, to the right. */}
                <div className="flex flex-wrap items-center gap-1 py-1.5">
                  <Hint wrap text={t("hint.evalQuestionMoveUp")}>
                    <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-9" aria-label={t("evalQuestionMoveUp")} onClick={() => move(index, -1)} disabled={index === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                  </Hint>
                  <Hint wrap text={t("hint.evalQuestionMoveDown")}>
                    <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-9" aria-label={t("evalQuestionMoveDown")} onClick={() => move(index, 1)} disabled={index === questions.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </Hint>
                  <span className="min-w-[8rem] flex-1 px-1">
                    <span className="block text-sm font-medium" data-testid="visit-evaluation-question-name">{label(question)}</span>
                    {isEditing ? <span className="block text-xs text-muted-foreground">{t("evalQuestionEditing")}</span> : null}
                  </span>
                  {isEditing ? null : (
                    <span className="ml-auto flex shrink-0 gap-1.5">
                      <Hint wrap text={t("hint.evalQuestionEdit")}>
                        <Button type="button" variant="outline" size="sm" onClick={() => startEditing(question)} data-testid="visit-evaluation-question-edit">
                          <Pencil className="mr-1 h-3.5 w-3.5" />{t("evalQuestionEdit")}
                        </Button>
                      </Hint>
                      <Hint wrap text={lastOne ? t("hint.evalQuestionDeleteLast") : t("hint.evalQuestionDelete")}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => remove(question.id)}
                          disabled={lastOne}
                          data-testid="visit-evaluation-question-delete"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />{t("evalQuestionDelete")}
                        </Button>
                      </Hint>
                    </span>
                  )}
                </div>
                {isEditing && editing ? editor(editing) : null}
              </li>
            )
          })}
          {editing?.isNew ? (
            <li className="bg-orange-50/60 dark:bg-orange-950/20" data-testid="visit-evaluation-question-new">
              <div className="flex items-center gap-1 py-1.5 pl-[4.75rem]">
                <span className="text-sm font-medium">{t("evalQuestionAdding")}</span>
              </div>
              {editor(editing)}
            </li>
          ) : null}
        </ul>

        {/* The sheet as the manager's phone draws it from the list on the left. */}
        <aside className="min-w-0 rounded-2xl border border-zinc-200 bg-muted/40 p-4 dark:border-zinc-700" aria-label={t("evalQuestionsPreviewTitle")} data-testid="visit-evaluation-question-preview">
          <p className="text-center text-xs text-muted-foreground">{t("evalQuestionsPreviewTitle")}</p>
          <p className="mt-2 text-sm font-semibold">{t("evalQuestionsPreviewHeading")}</p>
          <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-700">
            {questions.map((question) => (
              <li key={question.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-sm">
                <span className="min-w-[9rem] flex-1">{label(question)}</span>
                <span className="ml-auto flex shrink-0 gap-1" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <span key={score} className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-background text-xs text-muted-foreground dark:border-zinc-700">{score}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 rounded-md bg-background/70 px-3 py-2 text-xs text-muted-foreground">{t("evalQuestionsPreviewNote")}</p>
        </aside>
      </div>

      <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{t("evalQuestionsKeepNote")}</p>
    </section>
  )
}
