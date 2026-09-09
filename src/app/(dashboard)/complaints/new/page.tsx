"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Sparkles } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { useOrganizationFeature } from "@/hooks/use-organization-feature"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"

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
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const {
    enabled: supportAiDisabled,
    loading: supportAiLoading,
    error: supportAiStateError,
  } = useOrganizationFeature(SUPPORT_AI_DISABLED_FEATURE, orgId)
  const supportAiEnabled = !supportAiLoading && !supportAiStateError && !supportAiDisabled
  const [submitting, setSubmitting] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const [form, setForm] = useState({
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

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  useEffect(() => {
    const params = new URLSearchParams()
    if (form.brand) params.set("brand", form.brand)
    if (form.productionArea) params.set("productionArea", form.productionArea)
    if (form.productCategory) params.set("productCategory", form.productCategory)
    fetch(`/api/v1/complaints/facets?${params.toString()}`, {
      headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setFacets(j.data)
      })
      .catch(() => {})
  }, [orgId, form.brand, form.productionArea, form.productCategory])

  async function aiSuggest() {
    if (!form.content.trim()) return
    setAiLoading(true)
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
    } finally {
      setAiLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
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
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || t("errorSave"))
        return
      }
      router.push(`/complaints/${json.data.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("errorNetwork"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <Link href="/complaints" className="text-sm text-muted-foreground flex items-center gap-1 mb-4 hover:underline">
        <ArrowLeft className="w-4 h-4" /> {t("backToRegistry")}
      </Link>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">{t("newTitle")} <HelpButton slug="complaint-new" variant="label" /></h1>

      <form onSubmit={submit} className="space-y-6">
        <Section title={t("sectionCustomer")}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("fieldFullName")}>
              <Input value={form.customerName} onChange={(e) => setField("customerName", e.target.value)} />
            </Field>
            <Field label={t("fieldPhone")}>
              <Input value={form.phone} onChange={(e) => setField("phone", e.target.value)} placeholder={t("phonePlaceholder")} />
            </Field>
          </div>
        </Section>

        <Section title={t("sectionRequest")}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("fieldSource")}>
              <select
                className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 w-full bg-background text-sm"
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
                className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 w-full bg-background text-sm"
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
              required
              rows={5}
              value={form.content}
              onChange={(e) => setField("content", e.target.value)}
              placeholder={t("contentPlaceholder")}
            />
          </Field>
          {supportAiEnabled && <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={aiSuggest}
              disabled={aiLoading || form.content.trim().length < 20}
              title={t("aiTooltip")}
            >
              <Sparkles className="w-4 h-4 mr-1" />
              {aiLoading ? t("aiAnalyzing") : t("aiSuggest")}
            </Button>
          </div>}
        </Section>

        <Section title={t("sectionProduct")}>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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
                className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 w-full bg-background text-sm"
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

        {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 dark:bg-red-900/20 rounded p-3">{error}</div>}

        <div className="flex gap-2 justify-end">
          <Link href="/complaints">
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </Link>
          <Button type="submit" disabled={submitting || !form.content}>
            {submitting ? t("saving") : t("create")}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3 bg-card">
      <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
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
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label} {required && <span className="text-red-600">*</span>}
      </Label>
      {children}
    </div>
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
