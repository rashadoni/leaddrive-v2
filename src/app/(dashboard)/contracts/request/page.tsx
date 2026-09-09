"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, FileInput, Loader2, CheckCircle, Inbox } from "lucide-react"
import Link from "next/link"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"

// ─── Types ────────────────────────────────────────────────────────────────────

type QuestionType = "text" | "textarea" | "number" | "date" | "select"

type Question = {
  id: string
  label: string
  type: QuestionType
  required: boolean
  options?: string[]
}

type IntakeForm = {
  id: string
  name: string
  description: string | null
  contractType: string | null
  questions: Question[]
  mapping: Record<string, string>
  defaultStages: unknown[]
  isActive: boolean
}

type SubmitResult = {
  submissionId: string
  contractId: string
  contractStatus: string
  autoRouted: boolean
  stagesCreated: number
}

type Submission = {
  id: string
  status: string
  submittedAt: string
  form: { id: string; name: string; contractType: string | null }
  contract: {
    id: string
    contractNumber: string | null
    title: string | null
    status: string
  } | null
  submittedBy?: string | null
}

// ─── Submissions Queue (admin/manager) ────────────────────────────────────────

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending:   "default",
  processing: "secondary",
  completed: "outline",
  rejected:  "destructive",
}

function SubmissionsQueue() {
  const t = useTranslations("contractRequest")
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/contract-intake-submissions?limit=50")
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? t("loadError"))
        return
      }
      const json = await res.json()
      setSubmissions(json.data?.submissions ?? [])
    } catch {
      setError(t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="animate-spin text-muted-foreground h-6 w-6" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
        {error}
      </div>
    )
  }

  if (submissions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          {t("noSubmissions")}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {submissions.map((s) => (
        <Card key={s.id}>
          <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">
                {s.form.name}
                {s.form.contractType && (
                  <span className="text-muted-foreground ml-1">({s.form.contractType})</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(s.submittedAt).toLocaleString()}
                {s.submittedBy && <span className="ml-2">· {s.submittedBy}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Badge variant={STATUS_VARIANTS[s.status] ?? "secondary"}>
                {s.status}
              </Badge>
              {s.contract && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/contracts/${s.contract.id}`}>
                    {s.contract.contractNumber ?? t("viewDraft")}
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContractRequestPage() {
  const t = useTranslations("contractRequest")
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role ?? ""
  const isQueueViewer = role === "superadmin" || role === "admin" || role === "manager"

  const [activeTab, setActiveTab] = useState<"form" | "queue">("form")

  const [forms, setForms] = useState<IntakeForm[]>([])
  const [loadingForms, setLoadingForms] = useState(true)
  const [selectedFormId, setSelectedFormId] = useState<string>("")
  const [selectedForm, setSelectedForm] = useState<IntakeForm | null>(null)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const loadForms = useCallback(async () => {
    setLoadingForms(true)
    try {
      const res = await fetch("/api/v1/contract-intake-forms?isActive=true")
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setForms(json.data)
    } catch {
      setError(t("loadError"))
    } finally {
      setLoadingForms(false)
    }
  }, [t])

  useEffect(() => { loadForms() }, [loadForms])

  useEffect(() => {
    const form = forms.find((f) => f.id === selectedFormId) ?? null
    setSelectedForm(form)
    setResponses({})
    setError(null)
  }, [selectedFormId, forms])

  function setResponse(questionId: string, value: string) {
    setResponses((r) => ({ ...r, [questionId]: value }))
  }

  async function handleSubmit() {
    if (!selectedForm) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/v1/contract-intake-forms/${selectedForm.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? t("submitError"))
        return
      }
      setResult(json.data)
    } catch {
      setError(t("submitError"))
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Success state ────────────────────────────────────────────────────────

  if (result) {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <Card>
          <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-14 w-14 text-green-500" />
            <h2 className="text-xl font-semibold">{t("successTitle")}</h2>
            <p className="text-muted-foreground text-sm">{t("successDescription")}</p>
            {result.autoRouted && (
              <p className="text-sm text-muted-foreground">
                {t("autoRouted", { stages: result.stagesCreated })}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" asChild>
                <Link href="/contracts">{t("viewContracts")}</Link>
              </Button>
              <Button asChild>
                <Link href={`/contracts/${result.contractId}`}>{t("viewDraft")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Page header ──────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/contracts"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileInput className="h-5 w-5" />
            {t("title")}
            <HelpButton slug="contracts-request" variant="label" />
          </h1>
          <PageDescription text={t("description")} />
        </div>
      </div>

      {/* Tab strip — only shown when the user can also see the queue */}
      {isQueueViewer && (
        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setActiveTab("form")}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (activeTab === "form"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <span className="flex items-center gap-1.5">
              <FileInput className="h-3.5 w-3.5" />
              {t("tabSubmitRequest")}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors " +
              (activeTab === "queue"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            <span className="flex items-center gap-1.5">
              <Inbox className="h-3.5 w-3.5" />
              {t("tabSubmissionsQueue")}
            </span>
          </button>
        </div>
      )}

      {/* ── Queue tab ────────────────────────────────────────────────────── */}
      {activeTab === "queue" && isQueueViewer && (
        <SubmissionsQueue />
      )}

      {/* ── Submit Request tab (or full page for non-queue-viewers) ─────── */}
      {activeTab === "form" && (
        <>
          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {loadingForms ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="animate-spin text-muted-foreground h-6 w-6" />
            </div>
          ) : forms.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                {t("noActiveForms")}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* Form picker */}
                <div className="space-y-1.5">
                  <Label>{t("selectFormType")}</Label>
                  <select
                    value={selectedFormId}
                    onChange={(e) => setSelectedFormId(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-3 py-2 text-sm"
                  >
                    <option value="">{t("selectFormPlaceholder")}</option>
                    {forms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}{f.contractType ? ` (${f.contractType})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedForm && (
                  <>
                    {selectedForm.description && (
                      <p className="text-sm text-muted-foreground -mt-2">{selectedForm.description}</p>
                    )}

                    {/* Dynamic questions */}
                    <div className="space-y-4">
                      {selectedForm.questions.map((q) => (
                        <div key={q.id} className="space-y-1.5">
                          <Label>
                            {q.label}
                            {q.required && <span className="text-destructive ml-1">*</span>}
                          </Label>
                          {q.type === "textarea" ? (
                            <Textarea
                              value={responses[q.id] ?? ""}
                              onChange={(e) => setResponse(q.id, e.target.value)}
                              rows={3}
                            />
                          ) : q.type === "select" ? (
                            <select
                              value={responses[q.id] ?? ""}
                              onChange={(e) => setResponse(q.id, e.target.value)}
                              className="flex h-10 w-full rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-card px-3 py-2 text-sm"
                            >
                              <option value="">{t("selectOption")}</option>
                              {(q.options ?? []).map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
                              value={responses[q.id] ?? ""}
                              onChange={(e) => setResponse(q.id, e.target.value)}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <Button
                      className="w-full"
                      onClick={handleSubmit}
                      disabled={submitting}
                    >
                      {submitting && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                      {t("submit")}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
