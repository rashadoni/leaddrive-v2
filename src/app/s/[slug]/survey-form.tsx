"use client"

import { useState } from "react"
import { Check } from "lucide-react"

interface Question {
  id: string
  type: "nps" | "rating" | "text" | "choice" | "yesno"
  label: string
  required?: boolean
  max?: number
  options?: string[]
}

interface Props {
  slug: string
  type: string
  questions: Question[]
  thankYouText: string
  primaryColor?: string
  initialScore?: number | null
  initialComment?: string | null
  initialEmail?: string | null
  initialPhone?: string | null
  initialTicketId?: string | null
}

export function SurveyForm({ slug, type, questions, thankYouText, primaryColor = "#EA580C", initialScore, initialComment, initialEmail, initialPhone, initialTicketId }: Props) {
  const isRevisiting = initialScore !== null && initialScore !== undefined
  const effective: Question[] = questions && questions.length > 0 ? questions : [
    {
      id: "score",
      type: type === "nps" ? "nps" : type === "ces" ? "rating" : type === "csat" ? "rating" : "text",
      label:
        type === "nps" ? "How likely are you to recommend us to a friend or colleague?" :
        type === "csat" ? "How satisfied are you?" :
        type === "ces" ? "How easy was it?" :
        "Your feedback",
      max: type === "ces" ? 7 : 5,
    },
  ]

  // Seed the score field from the prior response (so reopening from a second
  // channel shows what they picked last time).
  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {}
    if (initialScore != null) {
      const q = effective.find(q => q.type === "nps" || q.type === "rating")
      if (q) init[q.id] = initialScore
    }
    return init
  })
  const [comment, setComment] = useState(initialComment || "")
  const [email, setEmail] = useState(initialEmail || "")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  // The primary score used for type-level category computation is the first nps/rating answer
  const primaryScoreQuestion = effective.find(q => q.type === "nps" || q.type === "rating")
  const primaryScore = primaryScoreQuestion ? answers[primaryScoreQuestion.id] : undefined

  const submit = async () => {
    setError("")
    // Check required
    for (const q of effective) {
      if (q.required && (answers[q.id] == null || answers[q.id] === "")) {
        setError(`Please answer: ${q.label || q.id}`)
        return
      }
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/v1/public/surveys/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: typeof primaryScore === "number" ? primaryScore : undefined,
          comment: comment || undefined,
          email: email || undefined,
          phone: initialPhone || undefined,
          ticketId: initialTicketId || undefined,
          answers,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Submission failed")
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="py-8 text-center">
        <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <p className="text-lg font-medium">{thankYouText}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {isRevisiting && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800 p-3 text-sm">
          <p className="font-medium text-orange-900 dark:text-orange-200">
            You&apos;ve already rated this ({initialScore}).
          </p>
          <p className="text-xs text-orange-800/80 dark:text-orange-300/80 mt-0.5">
            Change your score or comment below and hit Update to revise your response.
          </p>
        </div>
      )}
      {effective.map(q => (
        <QuestionInput
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))}
        />
      ))}

      <div>
        <label className="text-sm font-medium block mb-1">Additional comment (optional)</label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          className="w-full rounded-lg border px-3 py-2 text-sm bg-background resize-none"
          placeholder="What's the reason for your feedback?"
        />
      </div>

      <div>
        <label className="text-sm font-medium block mb-1">Email (optional)</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
          placeholder="you@example.com"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-lg text-white py-2.5 text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: primaryColor }}
      >
        {submitting ? "Submitting…" : isRevisiting ? "Update response" : "Submit feedback"}
      </button>
    </div>
  )
}

function QuestionInput({ question: q, value, onChange }: {
  question: Question
  value: any
  onChange: (v: any) => void
}) {
  if (q.type === "nps") {
    return (
      <div>
        <p className="text-sm font-medium mb-3">
          {q.label || "How likely are you to recommend us?"}{q.required && " *"}
        </p>
        <div className="grid grid-cols-11 gap-1 sm:gap-1.5">
          {Array.from({ length: 11 }).map((_, i) => {
            const selected = value === i
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChange(i)}
                className={`aspect-square rounded-lg border text-sm font-medium transition-all ${
                  selected ? "bg-primary text-primary-foreground border-primary scale-105" : "bg-background hover:border-primary/50"
                }`}
              >{i}</button>
            )
          })}
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>Not at all likely</span>
          <span>Extremely likely</span>
        </div>
      </div>
    )
  }

  if (q.type === "rating") {
    const max = q.max ?? 5
    return (
      <div>
        <p className="text-sm font-medium mb-3">{q.label || "Rate your experience"}{q.required && " *"}</p>
        <div className="flex gap-1.5">
          {Array.from({ length: max }).map((_, i) => {
            const v = i + 1
            const selected = value === v
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange(v)}
                className={`w-10 h-10 rounded-lg border text-sm font-medium transition-all ${
                  selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/50"
                }`}
              >{v}</button>
            )
          })}
        </div>
      </div>
    )
  }

  if (q.type === "choice") {
    return (
      <div>
        <p className="text-sm font-medium mb-3">{q.label}{q.required && " *"}</p>
        <div className="space-y-1.5">
          {(q.options || []).map((opt, i) => {
            const selected = value === opt
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChange(opt)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-all ${
                  selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/50"
                }`}
              >{opt}</button>
            )
          })}
        </div>
      </div>
    )
  }

  if (q.type === "yesno") {
    return (
      <div>
        <p className="text-sm font-medium mb-3">{q.label}{q.required && " *"}</p>
        <div className="flex gap-2">
          {["yes", "no"].map(v => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${
                value === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/50"
              }`}
            >{v}</button>
          ))}
        </div>
      </div>
    )
  }

  // text
  return (
    <div>
      <p className="text-sm font-medium mb-2">{q.label}{q.required && " *"}</p>
      <textarea
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-lg border px-3 py-2 text-sm bg-background resize-none"
      />
    </div>
  )
}
