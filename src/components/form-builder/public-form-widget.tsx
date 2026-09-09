"use client"

/**
 * P8 No-Code Form Builder — slice-3 public submit widget.
 *
 * Renders FormFieldSchema[] into HTML inputs + posts to
 * `/api/v1/public/forms/[slug]/submit?org=`. Shows per-field errors
 * inline, success message or redirect on success.
 */
import { useState, type FormEvent } from "react"
import type { FieldError, FormFieldSchema } from "@/lib/form-builder/types"
import { isValidVisitorId, VISITOR_ID_PARAM } from "@/lib/web-tracking-shapes"

// C2 identity stitching: ldtrack.js on the tenant's site decorates links to
// this hosted form with the visitor's anonymous id (?_ldv=...). Echo it into
// the submission so the server can stitch the visitor's browsing history to
// the contact the form resolves.
function visitorIdFromUrl(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get(VISITOR_ID_PARAM)
    return id && isValidVisitorId(id) ? id : null
  } catch {
    return null
  }
}

interface Props {
  organizationId: string
  slug: string
  fields: FormFieldSchema[]
  successMessage: string | null
  redirectUrl: string | null
}

export function PublicFormWidget({ organizationId, slug, fields, successMessage, redirectUrl }: Props) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() => {
    const init: Record<string, string | string[]> = {}
    for (const f of fields) {
      if (f.defaultValue !== undefined) init[f.key] = f.defaultValue
      if (f.type === "checkbox") init[f.key] = []
    }
    return init
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const update = (key: string, value: string | string[]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    setServerError(null)
    setSubmitting(true)
    try {
      const url = `/api/v1/public/forms/${encodeURIComponent(slug)}/submit?org=${encodeURIComponent(organizationId)}`
      const visitorId = visitorIdFromUrl()
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visitorId ? { values, visitorId } : { values }),
      })
      const body: { details?: FieldError[]; error?: string; data?: { redirectUrl?: string | null } } = await res.json()
      if (!res.ok) {
        if (body.details) {
          const fieldErrors: Record<string, string> = {}
          for (const d of body.details) fieldErrors[d.key] = d.message
          setErrors(fieldErrors)
        } else {
          setServerError(body.error || `Submission failed (HTTP ${res.status})`)
        }
        return
      }
      // Success.
      const target = body.data?.redirectUrl || redirectUrl
      // Defense-in-depth: slice-2 server validates redirectUrl is
      // http(s) on write, but a future seed/import path could bypass
      // that gate. Re-check here so a stray `javascript:` URL never
      // executes from this widget.
      if (target && /^https?:\/\//i.test(target)) {
        window.location.href = target
        return
      }
      setSubmitted(true)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Submission failed")
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-4 text-sm text-emerald-700 dark:text-emerald-300">
        {successMessage || "Thanks — your submission was recorded."}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} value={values[f.key]} onChange={(v) => update(f.key, v)} error={errors[f.key]} />
      ))}

      {serverError && (
        <p className="text-sm text-red-600 dark:text-red-400">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </form>
  )
}

function FieldRow({
  field,
  value,
  onChange,
  error,
}: {
  field: FormFieldSchema
  value: string | string[] | undefined
  onChange: (v: string | string[]) => void
  error: string | undefined
}) {
  // Hidden fields are not rendered visually — they only carry default
  // values (e.g. utm_source from URL params populated by a wrapper).
  if (field.type === "hidden") {
    return <input type="hidden" name={field.key} value={typeof value === "string" ? value : ""} />
  }

  const baseInput =
    "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
  const inputClass = `${baseInput} ${error ? "border-red-400 focus:ring-red-500" : "border-zinc-200 dark:border-zinc-700"}`

  let control: React.ReactNode
  if (field.type === "textarea") {
    control = (
      <textarea
        id={field.key}
        name={field.key}
        rows={4}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={`${inputClass} resize-none`}
      />
    )
  } else if (field.type === "select") {
    control = (
      <select
        id={field.key}
        name={field.key}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">— Select —</option>
        {(field.options || []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  } else if (field.type === "radio") {
    control = (
      <div className="space-y-1">
        {(field.options || []).map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={field.key}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    )
  } else if (field.type === "checkbox") {
    const current = Array.isArray(value) ? value : []
    control = (
      <div className="space-y-1">
        {(field.options || []).map((o) => {
          const checked = current.includes(o.value)
          return (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={o.value}
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? Array.from(new Set([...current, o.value]))
                    : current.filter((v) => v !== o.value)
                  onChange(next)
                }}
                className="h-4 w-4"
              />
              <span>{o.label}</span>
            </label>
          )
        })}
      </div>
    )
  } else {
    // Generic single-line input.
    const htmlType =
      field.type === "email" ? "email"
      : field.type === "phone" ? "tel"
      : field.type === "url" ? "url"
      : field.type === "number" ? "number"
      : field.type === "date" ? "date"
      : "text"
    control = (
      <input
        id={field.key}
        name={field.key}
        type={htmlType}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={inputClass}
      />
    )
  }

  return (
    <div className="space-y-1">
      <label htmlFor={field.key} className="block text-sm font-medium">
        {field.label}
        {field.required ? <span className="text-red-500 ml-1">*</span> : null}
      </label>
      {control}
      {field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}
