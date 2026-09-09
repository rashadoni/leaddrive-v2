"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { ArrowLeft, Plus, Trash2, FileInput, Loader2, Pencil, GripVertical } from "lucide-react"
import Link from "next/link"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

// ─── Types ────────────────────────────────────────────────────────────────────

type QuestionType = "text" | "textarea" | "number" | "date" | "select"

type Question = {
  id: string
  label: string
  type: QuestionType
  required: boolean
  options?: string[]
}

type StageSpec = {
  label: string
  assigneeRole: string
  slaHours: string
}

type IntakeForm = {
  id: string
  name: string
  description: string | null
  contractType: string | null
  questions: Question[]
  mapping: Record<string, string>
  defaultStages: StageSpec[]
  isActive: boolean
  createdAt: string
  _count: { submissions: number }
}

const BLANK_STAGE: StageSpec = { label: "", assigneeRole: "manager", slaHours: "" }

const CONTRACT_TYPES = [
  "service_agreement",
  "nda",
  "maintenance",
  "license",
  "sla",
  "other",
]

const MAPPABLE_FIELDS = ["title", "valueAmount", "currency", "notes", "type"]
const QUESTION_TYPES: QuestionType[] = ["text", "textarea", "number", "date", "select"]

// ─── Component ────────────────────────────────────────────────────────────────

export default function IntakeFormsPage() {
  const { data: session } = useSession()
  const t = useTranslations("intakeForms")
  useAutoTour("intakeForms")
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "superadmin"

  const [forms, setForms] = useState<IntakeForm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingForm, setEditingForm] = useState<IntakeForm | null>(null)
  const [formName, setFormName] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formContractType, setFormContractType] = useState("")
  const [formIsActive, setFormIsActive] = useState(true)
  const [questions, setQuestions] = useState<Question[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [defaultStages, setDefaultStages] = useState<StageSpec[]>([])
  const [optionsInput, setOptionsInput] = useState<Record<string, string>>({})

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/contract-intake-forms")
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setForms(json.data)
    } catch {
      setError(t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { loadForms() }, [loadForms])

  function openCreate() {
    setEditingForm(null)
    setFormName("")
    setFormDescription("")
    setFormContractType("")
    setFormIsActive(true)
    setQuestions([])
    setMapping({})
    setDefaultStages([])
    setOptionsInput({})
    setEditorOpen(true)
  }

  function openEdit(form: IntakeForm) {
    setEditingForm(form)
    setFormName(form.name)
    setFormDescription(form.description ?? "")
    setFormContractType(form.contractType ?? "")
    setFormIsActive(form.isActive)
    setQuestions(form.questions)
    setMapping(form.mapping)
    setDefaultStages(form.defaultStages)
    setOptionsInput({})
    setEditorOpen(true)
  }

  function addQuestion() {
    const newQ: Question = { id: `q${Date.now()}`, label: "", type: "text", required: false }
    setQuestions((qs) => [...qs, newQ])
  }

  function updateQuestion(idx: number, patch: Partial<Question>) {
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)))
  }

  function removeQuestion(idx: number) {
    const removed = questions[idx]
    setQuestions((qs) => qs.filter((_, i) => i !== idx))
    if (removed) {
      setMapping((m) => {
        const copy = { ...m }
        delete copy[removed.id]
        return copy
      })
    }
  }

  async function handleSave() {
    if (!formName.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        contractType: formContractType || undefined,
        isActive: formIsActive,
        questions,
        mapping,
        defaultStages: defaultStages
          .filter((s) => s.label.trim())
          .map((s) => ({
            label: s.label,
            assigneeRole: s.assigneeRole || undefined,
            slaHours: s.slaHours ? parseInt(s.slaHours) : undefined,
          })),
      }
      const url = editingForm
        ? `/api/v1/contract-intake-forms/${editingForm.id}`
        : "/api/v1/contract-intake-forms"
      const method = editingForm ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? t("saveError")); return }
      setEditorOpen(false)
      loadForms()
    } catch {
      setError(t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(form: IntakeForm) {
    if (!confirm(t("deactivateConfirm"))) return
    try {
      await fetch(`/api/v1/contract-intake-forms/${form.id}`, { method: "DELETE" })
      loadForms()
    } catch {
      setError(t("deactivateError"))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="animate-spin text-muted-foreground h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3" data-tour-id="intake-forms-header">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileInput className="h-5 w-5" />
            {t("title")}
            <HelpButton slug="intake-forms" variant="label" />
            <TourReplayButton tourId="intakeForms" />
          </h1>
          <PageDescription text={t("description")} />
        </div>
        {isAdmin && (
          <Button className="ml-auto" onClick={openCreate} data-tour-id="intake-forms-new">
            <Plus className="h-4 w-4 mr-1" /> {t("newForm")}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {forms.length === 0 ? (
        <Card data-tour-id="intake-forms-list">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
            <FileInput className="h-12 w-12 opacity-30" />
            <p className="text-sm font-medium text-foreground">{t("noForms")}</p>
            <p className="max-w-xl text-sm leading-6">{t("noFormsHint")}</p>
            {isAdmin && (
              <Button variant="outline" onClick={openCreate}>{t("createFirst")}</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-tour-id="intake-forms-list">
          {forms.map((form) => (
            <Card key={form.id} className={!form.isActive ? "opacity-60" : ""}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{form.name}</span>
                      {!form.isActive && <Badge variant="secondary">{t("inactive")}</Badge>}
                      {form.contractType && (
                        <Badge variant="outline" className="text-xs">{form.contractType}</Badge>
                      )}
                    </div>
                    {form.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 truncate">{form.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {form.questions.length} {t("questions")} · {form._count.submissions} {t("submissions")}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(form)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {form.isActive && (
                        <Button variant="ghost" size="icon" onClick={() => handleDeactivate(form)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Editor Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingForm ? t("editForm") : t("newForm")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>{t("formName")} *</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t("formNamePlaceholder")} />
                <p className="text-xs text-muted-foreground">{t("formNameHint")}</p>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>{t("formDescription")}</Label>
                <Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder={t("formDescriptionPlaceholder")} />
                <p className="text-xs text-muted-foreground">{t("formDescriptionHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("defaultContractType")}</Label>
                <select
                  value={formContractType}
                  onChange={(e) => setFormContractType(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-3 py-2 text-sm"
                >
                  <option value="">{t("anyType")}</option>
                  {CONTRACT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{t("defaultContractTypeHint")}</p>
              </div>
              <div className="space-y-1.5 pt-6">
                <div className="flex items-center gap-2">
                  <Switch checked={formIsActive} onCheckedChange={setFormIsActive} />
                  <Label>{t("activeForm")}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{t("activeFormHint")}</p>
              </div>
            </div>

            {/* Questions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">{t("questions")}</Label>
                <Button variant="outline" size="sm" onClick={addQuestion}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t("addQuestion")}
                </Button>
              </div>
              {questions.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-200 px-4 py-5 text-sm text-muted-foreground dark:border-zinc-700">
                  <p className="font-medium text-foreground">{t("noQuestions")}</p>
                  <p className="mt-1 leading-6">{t("noQuestionsHint")}</p>
                  <Button variant="outline" size="sm" onClick={addQuestion} className="mt-3">
                    <Plus className="h-3.5 w-3.5 mr-1" /> {t("addQuestion")}
                  </Button>
                </div>
              )}
              {questions.map((q, idx) => (
                <Card key={q.id} className="border border-border/50">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-4 w-4 mt-2 text-muted-foreground shrink-0" />
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">{t("questionLabel")} *</Label>
                          <Input
                            value={q.label}
                            onChange={(e) => updateQuestion(idx, { label: e.target.value })}
                            placeholder={t("questionLabelPlaceholder")}
                          />
                          <p className="text-xs text-muted-foreground">{t("questionLabelHint")}</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t("questionType")}</Label>
                          <select
                            value={q.type}
                            onChange={(e) => updateQuestion(idx, { type: e.target.value as QuestionType })}
                            className="flex h-8 w-full rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-sm"
                          >
                            {QUESTION_TYPES.map((qt) => (
                              <option key={qt} value={qt}>{qt}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t("mapToField")}</Label>
                          <select
                            value={mapping[q.id] ?? ""}
                            onChange={(e) =>
                              setMapping((m) => {
                                const copy = { ...m }
                                if (e.target.value) copy[q.id] = e.target.value
                                else delete copy[q.id]
                                return copy
                              })
                            }
                            className="flex h-8 w-full rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-sm"
                          >
                            <option value="">{t("noMapping")}</option>
                            {MAPPABLE_FIELDS.map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                          <p className="text-xs text-muted-foreground">{t("mapToFieldHint")}</p>
                        </div>
                        {q.type === "select" && (
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">{t("selectOptions")} ({t("commaSeparated")})</Label>
                            <Input
                              value={optionsInput[q.id] ?? (q.options ?? []).join(", ")}
                              onChange={(e) => {
                                setOptionsInput((o) => ({ ...o, [q.id]: e.target.value }))
                                updateQuestion(idx, {
                                  options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                                })
                              }}
                              placeholder="Option A, Option B, Option C"
                            />
                            <p className="text-xs text-muted-foreground">{t("selectOptionsHint")}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={q.required}
                            onCheckedChange={(v) => updateQuestion(idx, { required: v })}
                          />
                          <Label className="text-xs">{t("required")}</Label>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeQuestion(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Default Approval Stages */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">{t("defaultStages")}</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDefaultStages((s) => [...s, { ...BLANK_STAGE }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t("addStage")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("defaultStagesHint")}</p>
              {defaultStages.map((stage, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{idx + 1}.</span>
                  <Input
                    value={stage.label}
                    onChange={(e) =>
                      setDefaultStages((s) => s.map((st, i) => i === idx ? { ...st, label: e.target.value } : st))
                    }
                    placeholder={t("stageLabelPlaceholder")}
                    className="flex-1"
                  />
                  <select
                    value={stage.assigneeRole}
                    onChange={(e) =>
                      setDefaultStages((s) => s.map((st, i) => i === idx ? { ...st, assigneeRole: e.target.value } : st))
                    }
                    className="h-8 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-2 text-sm"
                  >
                    {["admin", "manager", "member"].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <Input
                    value={stage.slaHours}
                    onChange={(e) =>
                      setDefaultStages((s) => s.map((st, i) => i === idx ? { ...st, slaHours: e.target.value } : st))
                    }
                    placeholder={t("slaHoursPlaceholder")}
                    className="w-20 h-8"
                    type="number"
                    min={1}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDefaultStages((s) => s.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving && <Loader2 className="animate-spin h-4 w-4 mr-1" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
