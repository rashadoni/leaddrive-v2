"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { useOrganizationFeature } from "@/hooks/use-organization-feature"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  complaintChildHref,
  safeComplaintReturnTo,
} from "@/lib/complaints/workspace-state"
import {
  complaintDraftStorageKey,
  hasComplaintDraftContent,
  parseComplaintDraft,
  serializeComplaintDraft,
  type ComplaintDraftForm,
} from "@/lib/complaints/complaint-draft"

type Facets = {
  brands: string[]
  productionAreas: string[]
  productCategories: string[]
  complaintObjects: string[]
  departments: string[]
}

export default function NewComplaintPage() {
  const t = useTranslations("complaints")
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = safeComplaintReturnTo(searchParams.get("returnTo"))
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const {
    enabled: supportAiDisabled,
    hasLoaded: supportAiHasLoaded,
    loading: supportAiLoading,
    error: supportAiStateError,
  } = useOrganizationFeature(SUPPORT_AI_DISABLED_FEATURE, orgId)
  const supportAiEnabled = Boolean(orgId && supportAiHasLoaded && !supportAiLoading && !supportAiStateError && !supportAiDisabled)
  const [submitting, setSubmitting] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState("")
  const [aiError, setAiError] = useState("")
  const [facetsError, setFacetsError] = useState("")
  const [facetsRetry, setFacetsRetry] = useState(0)
  const [draftReady, setDraftReady] = useState(false)
  const [draftRecovered, setDraftRecovered] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [facets, setFacets] = useState<Facets>({
    brands: [],
    productionAreas: [],
    productCategories: [],
    complaintObjects: [],
    departments: [],
  })

  const SOURCES = [
    { value: "hotline", label: t("sourceHotline") },
    { value: "email", label: t("sourceEmail") },
    { value: "sales_rep", label: t("sourceSalesRep") },
    { value: "whatsapp", label: t("sourceWhatsapp") },
    { value: "instagram", label: t("sourceInstagram") },
    { value: "facebook", label: t("sourceFacebook") },
    { value: "web_chat", label: t("sourceWebChat") },
  ]

  const [form, setForm] = useState<ComplaintDraftForm>({
    customerName: "",
    phone: "",
    source: "hotline",
    complaintType: "complaint",
    brand: "",
    productionArea: "",
    productCategory: "",
    complaintObject: "",
    complaintObjectDetail: "",
    content: "",
    responsibleDepartment: "",
    riskLevel: "medium",
  })
  const draftKey = orgId ? complaintDraftStorageKey(String(orgId)) : ""
  const detailHref = useMemo(() => (id: string) => complaintChildHref(`/complaints/${id}`, returnTo), [returnTo])

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setValidationError("")
  }

  useEffect(() => {
    setDraftReady(false)
    setDraftRecovered(false)
    if (!draftKey) return
    try {
      const draft = parseComplaintDraft(localStorage.getItem(draftKey))
      if (draft) {
        setForm(draft.form)
        setDraftRecovered(true)
      }
    } catch {
      // Storage availability must not block complaint creation.
    } finally {
      setDraftReady(true)
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftReady || !draftKey) return
    const timeout = window.setTimeout(() => {
      try {
        if (hasComplaintDraftContent(form)) localStorage.setItem(draftKey, serializeComplaintDraft(form))
        else localStorage.removeItem(draftKey)
      } catch {}
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [draftKey, draftReady, form])

  useEffect(() => {
    if (!hasComplaintDraftContent(form)) return
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", protectDraft)
    return () => window.removeEventListener("beforeunload", protectDraft)
  }, [form])

  useEffect(() => {
    setFacetsError("")
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams()
      if (form.brand) params.set("brand", form.brand)
      if (form.productionArea) params.set("productionArea", form.productionArea)
      if (form.productCategory) params.set("productCategory", form.productCategory)
      try {
        const response = await fetch(`/api/v1/complaints/facets?${params.toString()}`, {
          headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
          signal: controller.signal,
        })
        const json = await response.json().catch(() => null)
        if (!response.ok || !json?.success) throw new Error("facets")
        if (!controller.signal.aborted) setFacets(json.data)
      } catch {
        if (!controller.signal.aborted) setFacetsError(t("facetsLoadError"))
      }
    }, 250)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [facetsRetry, orgId, form.brand, form.productionArea, form.productCategory, t])

  function navigateSafely(target: string) {
    if (hasComplaintDraftContent(form)) {
      setPendingNavigation(target)
      return
    }
    router.push(target)
  }

  async function aiSuggest() {
    if (!form.content.trim()) return
    setAiLoading(true)
    setAiError("")
    try {
      const res = await fetch("/api/v1/complaints/ai-categorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          content: form.content,
          brand: form.brand || undefined,
          productCategory: form.productCategory || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json?.data) throw new Error(t("aiUnavailable"))
      if (json?.data) {
        setForm((f) => ({
          ...f,
          riskLevel: json.data.riskLevel || f.riskLevel,
          responsibleDepartment:
            json.data.department && json.data.department !== "other"
              ? json.data.department
              : f.responsibleDepartment,
          complaintType: json.data.complaintType || f.complaintType,
        }))
      }
    } catch (failure) {
      setAiError(failure instanceof Error ? failure.message : t("aiUnavailable"))
    } finally {
      setAiLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setValidationError("")
    if (!form.content.trim()) {
      setValidationError(t("contentRequired"))
      return
    }
    if (form.content.trim().length > 10000) {
      setValidationError(t("contentTooLong"))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/v1/complaints", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          ...form,
          phone: form.phone || null,
          brand: form.brand || null,
          productionArea: form.productionArea || null,
          productCategory: form.productCategory || null,
          complaintObject: form.complaintObject || null,
          complaintObjectDetail: form.complaintObjectDetail || null,
          responsibleDepartment: form.responsibleDepartment || null,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(res.status === 403 ? t("permissionError") : t("errorSave"))
        return
      }
      try { if (draftKey) localStorage.removeItem(draftKey) } catch {}
      router.push(detailHref(json.data.id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errorNetwork"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SupportPageShell
      data-testid="complaint-new-workspace"
      width="narrow"
      title={t("newTitle")}
      leading={<Button data-testid="complaint-new-back" type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label={t("backToRegistry")} onClick={() => navigateSafely(returnTo)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>}
      utilities={<HelpButton slug="complaint-new" variant="icon" />}
    >

      {draftRecovered && <p data-testid="complaint-new-draft-recovered" role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t("draftRecovered")}</p>}

      <form data-testid="complaint-new-form" onSubmit={submit} className="space-y-4">
        <Section title={t("sectionCustomer")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("fieldFullName")}>
              <Input data-testid="complaint-new-customer" value={form.customerName} onChange={(e) => setField("customerName", e.target.value)} />
            </Field>
            <Field label={t("fieldPhone")}>
              <Input value={form.phone} onChange={(e) => setField("phone", e.target.value)} placeholder={t("phonePlaceholder")} />
            </Field>
          </div>
        </Section>

        <Section title={t("sectionRequest")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("fieldSource")}>
              <select
                className="h-11 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700 sm:h-9"
                value={form.source}
                onChange={(e) => setField("source", e.target.value)}
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("fieldType")}>
              <select
                className="h-11 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700 sm:h-9"
                value={form.complaintType}
                onChange={(e) => setField("complaintType", e.target.value)}
              >
                <option value="complaint">{t("typeComplaint")}</option>
                <option value="suggestion">{t("typeSuggestion")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("fieldContent")} required>
            <Textarea
              data-testid="complaint-new-content"
              required
              rows={5}
              value={form.content}
              onChange={(e) => setField("content", e.target.value)}
              placeholder={t("contentPlaceholder")}
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? "complaint-content-error" : undefined}
            />
          </Field>
          {validationError && <p id="complaint-content-error" role="alert" className="text-xs text-red-700 dark:text-red-300">{validationError}</p>}
          {supportAiEnabled && <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={aiSuggest}
              disabled={aiLoading || form.content.trim().length < 20}
              title={t("aiTooltip")}
              className="h-11 sm:h-9"
            >
              {aiLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="mr-1 h-4 w-4" />}
              {aiLoading ? t("aiAnalyzing") : t("aiSuggest")}
            </Button>
          </div>}
          {supportAiLoading && <p role="status" className="text-xs text-muted-foreground">{t("aiChecking")}</p>}
          {supportAiHasLoaded && supportAiDisabled && <p className="text-xs text-muted-foreground">{t("aiDisabled")}</p>}
          {supportAiStateError && <p role="status" className="text-xs text-muted-foreground">{t("aiUnavailableManual")}</p>}
          {aiError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{aiError}</p>}
        </Section>

        <Section title={t("sectionProduct")}>
          {facetsError && <div data-testid="complaint-new-facets-error" role="alert" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between"><span>{facetsError}</span><Button data-testid="complaint-new-retry-facets" type="button" size="sm" variant="outline" className="h-11 sm:h-9" onClick={() => setFacetsRetry(value => value + 1)}><RefreshCw className="h-3.5 w-3.5" />{t("retry")}</Button></div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("fieldBrand")}>
              <InputWithDatalist
                id="brand-list"
                options={facets.brands}
                value={form.brand}
                onChange={(v) => {
                  setField("brand", v)
                  if (v !== form.brand) {
                    setField("productionArea", "")
                    setField("productCategory", "")
                    setField("complaintObject", "")
                  }
                }}
              />
            </Field>
            <Field label={t("fieldProductionArea")}>
              <InputWithDatalist
                id="area-list"
                options={facets.productionAreas}
                value={form.productionArea}
                onChange={(v) => {
                  setField("productionArea", v)
                  if (v !== form.productionArea) {
                    setField("productCategory", "")
                    setField("complaintObject", "")
                  }
                }}
              />
            </Field>
            <Field label={t("fieldProductCategory")}>
              <InputWithDatalist
                id="cat-list"
                options={facets.productCategories}
                value={form.productCategory}
                onChange={(v) => {
                  setField("productCategory", v)
                  if (v !== form.productCategory) setField("complaintObject", "")
                }}
              />
            </Field>
            <Field label={t("fieldComplaintObject")}>
              <InputWithDatalist
                id="obj-list"
                options={facets.complaintObjects}
                value={form.complaintObject}
                onChange={(v) => setField("complaintObject", v)}
              />
            </Field>
            <Field label={t("fieldComplaintObjectDetail")}>
              <Input value={form.complaintObjectDetail} onChange={(e) => setField("complaintObjectDetail", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title={t("sectionAssignment")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("fieldResponsibleDepartment")}>
              <InputWithDatalist
                id="dept-list"
                options={facets.departments}
                value={form.responsibleDepartment}
                onChange={(v) => setField("responsibleDepartment", v)}
                placeholder={t("departmentPlaceholder")}
              />
            </Field>
            <Field label={t("fieldRiskLevel")}>
              <select
                className="h-11 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700 sm:h-9"
                value={form.riskLevel}
                onChange={(e) => setField("riskLevel", e.target.value)}
              >
                <option value="low">{t("riskLowOption")}</option>
                <option value="medium">{t("riskMediumOption")}</option>
                <option value="high">{t("riskHighOption")}</option>
              </select>
            </Field>
          </div>
        </Section>

        {error && <div data-testid="complaint-new-error" role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">{error}</div>}

        <div className="sticky bottom-2 flex justify-end gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <Button data-testid="complaint-new-cancel" type="button" variant="outline" className="h-11 sm:h-9" disabled={submitting} onClick={() => navigateSafely(returnTo)}>
            {t("cancel")}
          </Button>
          <Button data-testid="complaint-new-submit" type="submit" className="h-11 sm:h-9" disabled={submitting || !form.content.trim()}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{submitting ? t("saving") : t("create")}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={Boolean(pendingNavigation)}
        onOpenChange={open => { if (!open) setPendingNavigation(null) }}
        title={t("leaveDraftTitle")}
        description={t("leaveDraftHint")}
        confirmLabel={t("leaveKeepDraft")}
        confirmVariant="default"
        onConfirm={async () => {
          const target = pendingNavigation
          if (!target) return
          try { if (draftKey) localStorage.setItem(draftKey, serializeComplaintDraft(form)) } catch {}
          setPendingNavigation(null)
          router.push(target)
        }}
      />
    </SupportPageShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  children,
  required,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <Label className="grid gap-1.5 text-xs [&_input]:h-11 sm:[&_input]:h-9">
      <span>{label} {required && <span className="text-red-600">*</span>}</span>
      {children}
    </Label>
  )
}

function InputWithDatalist({
  id,
  options,
  value,
  onChange,
  placeholder,
}: {
  id: string
  options: string[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <>
      <Input
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}
