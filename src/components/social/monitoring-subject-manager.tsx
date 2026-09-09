"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Bot, Building2, Check, CirclePause, Link2, Pencil, Plus, ShieldCheck, Tags, Trash2, UserRound, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type AccountOption = {
  id: string
  platform: string
  handle: string
  displayName: string | null
  isActive: boolean
}

type SourceOption = {
  id: string
  platform: string
  sourceType: string
  handle: string | null
  query: string | null
  url: string | null
  ownership: string
  status: string
}

type SubjectAlias = {
  id: string
  kind: string
  value: string
  isNegative: boolean
  isAmbiguous: boolean
}

type MonitoringSubject = {
  id: string
  type: string
  name: string
  description: string | null
  status: "active" | "paused"
  languages: string[]
  geographies: string[]
  requiredContext: string[]
  exclusions: string[]
  assignedAgentId: string | null
  aliases: SubjectAlias[]
  sources: Array<{ sourceId: string; relationType: string; source: SourceOption }>
  replyIdentities: Array<{
    socialAccountId: string
    allowOwnedReply: boolean
    allowExternalReply: boolean
    socialAccount: AccountOption
  }>
  outgoingRelations: Array<{
    id: string
    relatedSubjectId: string
    relationType: string
    relatedSubject: { id: string; name: string; type: string }
  }>
}

type SubjectRelationForm = { relatedSubjectId: string; relationType: string }

type SubjectForm = {
  type: string
  name: string
  description: string
  aliases: string
  ambiguousAliases: string
  handles: string
  hashtags: string
  negativeAliases: string
  requiredContext: string
  exclusions: string
  languages: string
  geographies: string
  replyAccountIds: string[]
  assignedAgentId: string
  relations: SubjectRelationForm[]
}

const SUBJECT_TYPES = ["BRAND", "COMPANY", "PERSON", "PRODUCT", "ORGANIZATION", "TOPIC", "EVENT"] as const
const RELATION_TYPES = ["BRAND_OF", "PRODUCT_OF", "REPRESENTATIVE_OF", "COMPETITOR_OF", "RELATED_TO"] as const

const emptyForm: SubjectForm = {
  type: "BRAND",
  name: "",
  description: "",
  aliases: "",
  ambiguousAliases: "",
  handles: "",
  hashtags: "",
  negativeAliases: "",
  requiredContext: "",
  exclusions: "",
  languages: "",
  geographies: "",
  replyAccountIds: [],
  assignedAgentId: "",
  relations: [],
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)))
}

// Слова-фильтры не уходят в провайдера отдельными поисками: в поиск идёт только
// основной запрос сценария, а эти значения отсеивают нерелевантные находки.
// Поэтому длинный список не расширяет охват, зато замедляет разбор и путает
// оператора — держим его обозримым.
const MAX_FILTER_TERMS = 12
// Однословные термины до этой длины включительно сервер по умолчанию считает
// неоднозначными: без второго сигнала (обязательный контекст, контекстное
// слово, собственный канал бренда) находка по ним не принимается. Держать в
// синхроне с AMBIGUOUS_SINGLE_TOKEN_MAX_LENGTH в monitoring-subjects.ts.
const AMBIGUOUS_TERM_MAX_LENGTH = 8

function filterTermStats(value: string): { count: number; overLimit: boolean; shortTerms: string[] } {
  const terms = splitList(value)
  return {
    count: terms.length,
    overLimit: terms.length > MAX_FILTER_TERMS,
    shortTerms: terms.filter(term => {
      const bare = term.replace(/^[#@]/, "")
      return !bare.includes(" ") && bare.length <= AMBIGUOUS_TERM_MAX_LENGTH
    }),
  }
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value]
}

function subjectToForm(subject: MonitoringSubject): SubjectForm {
  const aliases = (kind: string) => subject.aliases.filter(alias => alias.kind === kind).map(alias => alias.value).join("\n")
  return {
    type: subject.type,
    name: subject.name,
    description: subject.description ?? "",
    aliases: subject.aliases.filter(alias => ["NAME", "TRANSLITERATION", "INFLECTION", "TYPO"].includes(alias.kind) && alias.value !== subject.name && !alias.isAmbiguous).map(alias => alias.value).join("\n"),
    ambiguousAliases: subject.aliases.filter(alias => ["NAME", "TRANSLITERATION", "INFLECTION", "TYPO"].includes(alias.kind) && alias.value !== subject.name && alias.isAmbiguous && !alias.isNegative).map(alias => alias.value).join("\n"),
    handles: aliases("HANDLE"),
    hashtags: aliases("HASHTAG"),
    negativeAliases: subject.aliases.filter(alias => alias.isNegative).map(alias => alias.value).join("\n"),
    requiredContext: subject.requiredContext.join("\n"),
    exclusions: subject.exclusions.join("\n"),
    languages: subject.languages.join(", "),
    geographies: subject.geographies.join(", "),
    replyAccountIds: subject.replyIdentities.map(identity => identity.socialAccountId),
    assignedAgentId: subject.assignedAgentId ?? "",
    relations: subject.outgoingRelations.map(relation => ({
      relatedSubjectId: relation.relatedSubjectId,
      relationType: relation.relationType,
    })),
  }
}

function typeIcon(type: string) {
  if (type === "PERSON") return UserRound
  if (["COMPANY", "ORGANIZATION"].includes(type)) return Building2
  return Tags
}

export function MonitoringSubjectManager({
  accounts,
  headers,
}: {
  accounts: AccountOption[]
  headers: Record<string, string>
}) {
  const t = useTranslations("socialMonitoring.subjects")
  const [subjects, setSubjects] = useState<MonitoringSubject[]>([])
  const [socialAgentId, setSocialAgentId] = useState<string | null>(null)
  const [socialAgents, setSocialAgents] = useState<Array<{ id: string; configName: string; version: number }>>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<MonitoringSubject | null>(null)
  const [form, setForm] = useState<SubjectForm>(emptyForm)

  const activeSubjects = subjects.filter(subject => subject.status === "active").length
  const ambiguousAliases = subjects.reduce((sum, subject) => sum + subject.aliases.filter(alias => alias.isAmbiguous).length, 0)
  const availableAccounts = useMemo(() => accounts.filter(account => account.isActive), [accounts])

  const load = async () => {
    setLoading(true)
    try {
      const [subjectResponse, agentResponse] = await Promise.all([
        fetch("/api/v1/social/monitoring-subjects", { headers }),
        fetch("/api/v1/social/agent", { headers }),
      ])
      const [subjectData, agentData] = await Promise.all([
        subjectResponse.json(),
        agentResponse.json(),
      ])
      if (subjectData.success) setSubjects(subjectData.data.subjects ?? [])
      if (agentData.success) {
        if (agentData.data.configured && agentData.data.id) setSocialAgentId(agentData.data.id)
        setSocialAgents(Array.isArray(agentData.data.agents) ? agentData.data.agents : [])
      }
    } catch {
      toast.error(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, assignedAgentId: socialAgentId ?? "" })
    setOpen(true)
  }

  const openEdit = (subject: MonitoringSubject) => {
    setEditing(subject)
    setForm(subjectToForm(subject))
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim() || saving) return
    setSaving(true)
    try {
      const aliases = [
        // Explicitly-marked ambiguous synonyms come first so a word listed in
        // both boxes keeps the stricter flag after dedupe. Plain aliases send
        // no flag and fall to the server-side single-word default.
        ...splitList(form.ambiguousAliases).map(value => ({ kind: "NAME", value, weight: 0.9, isAmbiguous: true })),
        ...splitList(form.aliases).map(value => ({ kind: "NAME", value, weight: 0.9 })),
        ...splitList(form.handles).map(value => ({ kind: "HANDLE", value, weight: 1 })),
        ...splitList(form.hashtags).map(value => ({ kind: "HASHTAG", value, weight: 0.95 })),
        ...splitList(form.negativeAliases).map(value => ({ kind: "NEGATIVE", value, weight: 1, isNegative: true })),
      ]
      const body = {
        type: form.type,
        name: form.name,
        description: form.description || null,
        languages: splitList(form.languages),
        geographies: splitList(form.geographies),
        requiredContext: splitList(form.requiredContext),
        exclusions: splitList(form.exclusions),
        assignedAgentId: form.assignedAgentId || null,
        aliases,
        replyIdentities: form.replyAccountIds.map((socialAccountId, index) => ({
          socialAccountId,
          priority: index + 1,
          allowOwnedReply: true,
          allowExternalReply: false,
        })),
        relations: form.relations
          .filter(relation => relation.relatedSubjectId && relation.relatedSubjectId !== editing?.id)
          .map(relation => ({ ...relation, weight: 0.75 })),
      }
      const response = await fetch(
        editing ? `/api/v1/social/monitoring-subjects/${editing.id}` : "/api/v1/social/monitoring-subjects",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
      )
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || t("saveFailed"))
      setSubjects(previous => editing
        ? previous.map(subject => subject.id === editing.id ? data.data : subject)
        : [data.data, ...previous])
      setOpen(false)
      toast.success(t("saved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const archive = async (subject: MonitoringSubject) => {
    if (!confirm(t("archiveConfirm", { name: subject.name }))) return
    const response = await fetch(`/api/v1/social/monitoring-subjects/${subject.id}`, { method: "DELETE", headers })
    if (!response.ok) {
      toast.error(t("archiveFailed"))
      return
    }
    setSubjects(previous => previous.filter(item => item.id !== subject.id))
    toast.success(t("archived"))
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-start sm:justify-between dark:border-zinc-700">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-semibold">{t("title")}</h2>
              <Badge variant="outline" className="text-[10px]">{t("preFilterBadge")}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("subtitle")}</p>
          </div>
          <Button size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            {t("newSubject")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3 text-xs">
          <span><strong className="font-semibold tabular-nums">{subjects.length}</strong> <span className="text-muted-foreground">{t("total")}</span></span>
          <span><strong className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{activeSubjects}</strong> <span className="text-muted-foreground">{t("active")}</span></span>
          <span><strong className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">{ambiguousAliases}</strong> <span className="text-muted-foreground">{t("ambiguous")}</span></span>
        </div>
      </section>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : subjects.length === 0 ? (
        <section className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center dark:border-zinc-700">
          <Tags className="mx-auto h-5 w-5 text-orange-500" />
          <p className="mt-3 text-sm font-medium">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{t("emptyHint")}</p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" />{t("createFirst")}</Button>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {subjects.map(subject => {
              const SubjectIcon = typeIcon(subject.type)
              const positiveAliases = subject.aliases.filter(alias => !alias.isNegative).slice(0, 6)
              return (
                <article key={subject.id} className="p-4 transition-colors hover:bg-muted/30">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-300">
                        <SubjectIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold">{subject.name}</h3>
                          <Badge variant="outline" className="text-[10px]">{t(`types.${subject.type}`)}</Badge>
                          <Badge variant={subject.status === "active" ? "success" : "secondary"} className="text-[10px]">
                            {subject.status === "active" ? <Check className="mr-1 h-3 w-3" /> : <CirclePause className="mr-1 h-3 w-3" />}
                            {t(`statuses.${subject.status}`)}
                          </Badge>
                        </div>
                        {subject.description && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{subject.description}</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {positiveAliases.map(alias => <Badge key={alias.id} variant="secondary" className="text-[10px]">{alias.kind === "HANDLE" ? "@" : alias.kind === "HASHTAG" ? "#" : ""}{alias.value.replace(/^[@#]/, "")}</Badge>)}
                          {subject.exclusions.length > 0 && <Badge variant="warning" className="text-[10px]">{t("exclusionsCount", { count: subject.exclusions.length })}</Badge>}
                          {subject.requiredContext.length > 0 && <Badge variant="outline" className="text-[10px]">{t("contextCount", { count: subject.requiredContext.length })}</Badge>}
                          {subject.outgoingRelations.map(relation => (
                            <Badge key={relation.id} variant="outline" className="gap-1 text-[10px]">
                              <Link2 className="h-3 w-3" />
                              {t(`relationTypes.${relation.relationType}`)}: {relation.relatedSubject.name}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{t("sourcesCount", { count: subject.sources.length })}</span>
                          <span>{t("replyProfilesCount", { count: subject.replyIdentities.length })}</span>
                          <span className={subject.assignedAgentId ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                            <Bot className="mr-1 inline h-3 w-3" />{subject.assignedAgentId ? t("agentLinked") : t("agentNotLinked")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5 lg:justify-end">
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openEdit(subject)}><Pencil className="h-3.5 w-3.5" />{t("edit")}</Button>
                      <Button variant="outline" size="sm" className="h-8 px-2 text-muted-foreground hover:text-red-600" onClick={() => archive(subject)} title={t("archive")}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1.5"><Label>{t("type")}</Label><Select value={form.type} onChange={event => setForm(previous => ({ ...previous, type: event.target.value }))}>{SUBJECT_TYPES.map(type => <option key={type} value={type}>{t(`types.${type}`)}</option>)}</Select></div>
              <div className="space-y-1.5"><Label>{t("name")}</Label><Input value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} placeholder={t("namePlaceholder")} /></div>
            </div>
            <div className="space-y-1.5"><Label>{t("description")}</Label><Input value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} /></div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("aliases")}</Label>
                <Textarea rows={3} value={form.aliases} onChange={event => setForm(previous => ({ ...previous, aliases: event.target.value }))} placeholder={t("aliasesPlaceholder")} />
                <p className="text-[11px] leading-4 text-muted-foreground">{t("aliasesScenarioHint")}</p>
                {(() => {
                  const stats = filterTermStats(form.aliases)
                  if (stats.count === 0) return null
                  return (
                    <div className="space-y-0.5 text-[11px] leading-4">
                      <p className={stats.overLimit ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
                        {t("filterTermsCount", { count: stats.count, max: MAX_FILTER_TERMS })}
                      </p>
                      {stats.overLimit && <p className="text-amber-700 dark:text-amber-300">{t("filterTermsOverLimit")}</p>}
                      {stats.shortTerms.length > 0 && (
                        <p className="text-amber-700 dark:text-amber-300">
                          {t("filterTermsTooShort", { terms: stats.shortTerms.slice(0, 3).join(", ") })}
                        </p>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div className="space-y-1.5">
                <Label>{t("ambiguousAliases")}</Label>
                <Textarea rows={3} value={form.ambiguousAliases} onChange={event => setForm(previous => ({ ...previous, ambiguousAliases: event.target.value }))} placeholder={t("ambiguousAliasesPlaceholder")} />
                <p className="text-[11px] leading-4 text-muted-foreground">{t("ambiguousAliasesHint")}</p>
              </div>
              <div className="space-y-1.5"><Label>{t("negativeAliases")}</Label><Textarea rows={3} value={form.negativeAliases} onChange={event => setForm(previous => ({ ...previous, negativeAliases: event.target.value }))} placeholder={t("negativeAliasesPlaceholder")} /></div>
              <div className="space-y-1.5"><Label>{t("handles")}</Label><Textarea rows={2} value={form.handles} onChange={event => setForm(previous => ({ ...previous, handles: event.target.value }))} placeholder="@brand" /></div>
              <div className="space-y-1.5"><Label>{t("hashtags")}</Label><Textarea rows={2} value={form.hashtags} onChange={event => setForm(previous => ({ ...previous, hashtags: event.target.value }))} placeholder="#brand" /></div>
              <div className="space-y-1.5">
                <Label>{t("requiredContext")}</Label>
                <Textarea rows={2} value={form.requiredContext} onChange={event => setForm(previous => ({ ...previous, requiredContext: event.target.value }))} placeholder={t("requiredContextPlaceholder")} />
                {/* Самая опасная настройка карточки: она требует, чтобы КРОМЕ
                    названия бренда в тексте было ещё одно из этих слов. На
                    проде такой список из 8 слов отбросил 61 находку у одного
                    клиента, пока никто не понимал, куда они делись. */}
                {splitList(form.requiredContext).length > 0 && (
                  <p className="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                    {t("requiredContextWarning", { count: splitList(form.requiredContext).length })}
                  </p>
                )}
              </div>
              <div className="space-y-1.5"><Label>{t("exclusions")}</Label><Textarea rows={2} value={form.exclusions} onChange={event => setForm(previous => ({ ...previous, exclusions: event.target.value }))} placeholder={t("exclusionsPlaceholder")} /></div>
              <div className="space-y-1.5"><Label>{t("languages")}</Label><Input value={form.languages} onChange={event => setForm(previous => ({ ...previous, languages: event.target.value }))} placeholder="az, ru, en" /></div>
              <div className="space-y-1.5"><Label>{t("geographies")}</Label><Input value={form.geographies} onChange={event => setForm(previous => ({ ...previous, geographies: event.target.value }))} placeholder={t("geographiesPlaceholder")} /></div>
            </div>

            <fieldset className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <legend className="px-1 text-xs font-medium">{t("replyProfilesTitle")}</legend>
              <p className="mb-2 text-xs leading-5 text-muted-foreground">{t("replyProfilesHint")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableAccounts.map(account => (
                  <label key={account.id} className="flex items-start gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                    <input type="checkbox" className="mt-0.5 rounded" checked={form.replyAccountIds.includes(account.id)} onChange={() => setForm(previous => ({ ...previous, replyAccountIds: toggle(previous.replyAccountIds, account.id) }))} />
                    <span><span className="block font-medium">{account.displayName || account.handle}</span><span className="text-muted-foreground">{account.platform} · {t("ownedRepliesOnly")}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <legend className="px-1 text-xs font-medium">{t("relationsTitle")}</legend>
              <p className="mb-2 text-xs leading-5 text-muted-foreground">{t("relationsHint")}</p>
              <div className="space-y-2">
                {form.relations.map((relation, index) => (
                  <div key={`${index}-${relation.relatedSubjectId}`} className="grid gap-2 sm:grid-cols-[1fr_180px_32px]">
                    <Select
                      aria-label={t("relatedSubject")}
                      value={relation.relatedSubjectId}
                      onChange={event => setForm(previous => ({
                        ...previous,
                        relations: previous.relations.map((item, itemIndex) => itemIndex === index ? { ...item, relatedSubjectId: event.target.value } : item),
                      }))}
                    >
                      <option value="">{t("chooseRelatedSubject")}</option>
                      {subjects.filter(subject => subject.id !== editing?.id).map(subject => (
                        <option key={subject.id} value={subject.id}>{subject.name} · {t(`types.${subject.type}`)}</option>
                      ))}
                    </Select>
                    <Select
                      aria-label={t("relationType")}
                      value={relation.relationType}
                      onChange={event => setForm(previous => ({
                        ...previous,
                        relations: previous.relations.map((item, itemIndex) => itemIndex === index ? { ...item, relationType: event.target.value } : item),
                      }))}
                    >
                      {RELATION_TYPES.map(type => <option key={type} value={type}>{t(`relationTypes.${type}`)}</option>)}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-muted-foreground"
                      onClick={() => setForm(previous => ({ ...previous, relations: previous.relations.filter((_, itemIndex) => itemIndex !== index) }))}
                      aria-label={t("removeRelation")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setForm(previous => ({
                    ...previous,
                    relations: [...previous.relations, { relatedSubjectId: "", relationType: "RELATED_TO" }],
                  }))}
                  disabled={subjects.filter(subject => subject.id !== editing?.id).length === 0}
                >
                  <Plus className="h-3.5 w-3.5" />{t("addRelation")}
                </Button>
              </div>
            </fieldset>

            <label className="block rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-700">
              <span className="block font-medium">{t("linkAgent")}</span>
              <Select
                className="mt-2 w-full"
                value={form.assignedAgentId}
                onChange={event => setForm(previous => ({ ...previous, assignedAgentId: event.target.value }))}
              >
                <option value="">{t("agentSafeDefault")}</option>
                {socialAgents.map(agent => (
                  <option key={agent.id} value={agent.id}>{agent.configName} · v{agent.version}</option>
                ))}
              </Select>
              <span className="mt-1 block leading-5 text-muted-foreground">
                {socialAgents.length > 0 ? t("linkAgentHint") : t("agentNeedsSetup")}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button onClick={save} disabled={!form.name.trim() || saving}>{saving ? t("saving") : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
