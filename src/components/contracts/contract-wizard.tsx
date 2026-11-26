"use client"

/**
 * «Yeni müqavilə» as a wizard (owner 2026-11-25, mock «Мастер договора по ВÖEN»):
 *   1. Şablon   — a template from the library, or a blank contract;
 *   2. Tərəflər — our side from «Settings → Invoices»; the other side by VÖEN
 *                 from the tax registry, its bank from the company card;
 *   3. Şərtlər  — only what neither the CRM nor the registry knows;
 *   4. Yoxlama  — the document as it will be, then a draft or approval.
 *
 * The server builds the text (POST /api/v1/contracts/wizard): the preview is
 * the same code as the contract, so what step 4 shows is what is saved.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, FileText, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Hint } from "@/components/hint"
import { BANK_FIELDS, type BankField } from "@/lib/companies/bank-requisites"

type Bank = Record<BankField, string>
interface Party { name: string; voen: string | null; address: string | null; director: string | null }
interface OurBank { id: string; label: string }
interface TemplateCard { id: string; name: string; description: string | null; clauseCount: number; ownFieldCount: number }
interface DealCompany extends Party { id: string; externalSource: string | null; bank: Record<BankField, string | null> }
interface Context {
  our: Party
  ourBanks: OurBank[]
  templates: TemplateCard[]
  deal: { id: string; name: string; valueAmount: number | null; currency: string | null; company: DealCompany | null } | null
}
/** A template variable as the template editor stores it — `label` is what people read, when the author gave one. */
interface AskedVariable { name: string; type: "string" | "number" | "date" | "boolean"; required: boolean; default?: string | number | boolean; label?: string }
interface Preview {
  renderedBody: string
  missing: string[]
  asked: AskedVariable[]
  standard: string[]
  company: { action: "update" | "create"; id: string | null; name: string; fields: string[] }
}
interface RegistryCard { name: string; legalForm: string | null; legalAddress: string | null; director: string | null; active: boolean | null; vatPayer: boolean | null }

const BLANK_TEMPLATE = "blank"

const emptyBank = (): Bank => Object.fromEntries(BANK_FIELDS.map((f) => [f, ""])) as Bank
const bankFrom = (source: Partial<Record<BankField, string | null>> | null | undefined): Bank =>
  Object.fromEntries(BANK_FIELDS.map((f) => [f, source?.[f] ?? ""])) as Bank
const hasBank = (bank: Bank) => Boolean(bank.bankAccount.trim())

/** `delivery_term` → «Delivery term»: a variable as people read it. */
function fieldLabel(name: string): string {
  const words = name.replace(/_/g, " ").trim()
  return words.charAt(0).toLocaleUpperCase() + words.slice(1)
}

export function ContractWizard({ dealId }: { dealId: string | null }) {
  const t = useTranslations("contractWizard")
  const tb = useTranslations("companyBank")
  const locale = useLocale()
  const router = useRouter()
  const lang = locale === "ru" || locale === "en" ? locale : "az"

  const [step, setStep] = useState(1)
  const [ctx, setCtx] = useState<Context | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState<string>(BLANK_TEMPLATE)
  const [ourBank, setOurBank] = useState<string>("")
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyHadBank, setCompanyHadBank] = useState(false)
  const [voen, setVoen] = useState("")
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [director, setDirector] = useState("")
  const [bank, setBank] = useState<Bank>(emptyBank())
  const [saveBank, setSaveBank] = useState(true)
  const [typed, setTyped] = useState<Record<string, string | number | boolean>>({})

  const [lookup, setLookup] = useState<{ state: "idle" | "busy" | "found" | "error"; card?: RegistryCard; message?: string; duplicate?: { id: string; name: string } | null }>({ state: "idle" })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<null | "draft" | "approve">(null)

  // ── What the wizard starts from ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/contracts/wizard${dealId ? `?deal=${encodeURIComponent(dealId)}` : ""}`)
      .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
      .then(({ ok, status, json }) => {
        if (cancelled) return
        if (!ok || !json?.success) {
          setLoadError(status === 403 ? t("errNoRight") : t("errLoad"))
          return
        }
        const data = json.data as Context
        setCtx(data)
        setTemplateId(data.templates[0]?.id ?? BLANK_TEMPLATE)
        setOurBank(data.ourBanks[0]?.id ?? "")
        const company = data.deal?.company
        if (company) {
          setCompanyId(company.id)
          setVoen(company.voen ?? "")
          setName(company.name)
          setAddress(company.address ?? "")
          setDirector(company.director ?? "")
          const cardBank = bankFrom(company.bank)
          setBank(cardBank)
          setCompanyHadBank(hasBank(cardBank))
        }
      })
      .catch(() => !cancelled && setLoadError(t("errLoad")))
    return () => {
      cancelled = true
    }
  }, [dealId, t])

  // ── VÖEN → registry, and the company card if the CRM has one ───────────
  const lookUp = useCallback(async () => {
    const digits = voen.replace(/\D/g, "")
    if (digits.length !== 10) {
      setLookup({ state: "error", message: t("errVoen") })
      return
    }
    setLookup({ state: "busy" })
    const res = await fetch("/api/v1/companies/registry-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voen: digits }),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => null) : null
    const duplicate = (json?.data?.duplicate ?? json?.duplicate ?? null) as { id: string; name: string } | null
    if (duplicate) {
      // The CRM already knows this company: its card is the counterparty, its bank fills the form.
      const card = await fetch(`/api/v1/companies/${encodeURIComponent(duplicate.id)}`).then((r) => r.json()).catch(() => null)
      const row = card?.data
      setCompanyId(duplicate.id)
      if (row) {
        setName(row.name ?? duplicate.name)
        if (row.address) setAddress(row.address)
        if (row.director) setDirector(row.director)
        const cardBank = bankFrom(row)
        if (hasBank(cardBank)) setBank(cardBank)
        setCompanyHadBank(hasBank(cardBank))
      }
    } else {
      setCompanyId(null)
      setCompanyHadBank(false)
    }
    if (res?.ok && json?.success) {
      // The contract names the company as the registry does — its legal name and
      // address — even when the CRM card is called otherwise; the card keeps its name.
      const card = json.data.card as RegistryCard
      setName(card.name)
      if (card.legalAddress) setAddress(card.legalAddress)
      if (card.director) setDirector(card.director)
      setLookup({ state: "found", card, duplicate })
      return
    }
    const code = json?.code
    setLookup({
      state: "error",
      duplicate,
      message: code === "NOT_FOUND" ? t("errNotFound") : code === "INVALID_VOEN" ? t("errVoen") : t("errRegistry"),
    })
  }, [voen, t])

  // ── The server's preview of the document ───────────────────────────────
  const requestBody = useCallback(
    (previewOnly: boolean) => ({
      preview: previewOnly,
      templateId: templateId === BLANK_TEMPLATE ? null : templateId,
      dealId: ctx?.deal?.id ?? null,
      companyId,
      counterparty: {
        voen: voen.trim() || null,
        name: name.trim(),
        address: address.trim() || null,
        director: director.trim() || null,
        bank: Object.fromEntries(BANK_FIELDS.map((f) => [f, bank[f].trim() || null])),
        saveBank,
      },
      ourBank: ourBank || null,
      typed,
      lang,
    }),
    [templateId, ctx, companyId, voen, name, address, director, bank, saveBank, ourBank, typed, lang],
  )

  const refreshPreview = useCallback(async () => {
    setPreviewBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/contracts/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(true)),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(json?.code === "TEMPLATE_INVALID" ? t("errTemplate") : json?.error || t("errPreview"))
        return
      }
      setPreview(json.data as Preview)
    } catch {
      setError(t("errPreview"))
    } finally {
      setPreviewBusy(false)
    }
  }, [requestBody, t])

  useEffect(() => {
    if (step >= 3) void refreshPreview()
    // Step 3 asks the server which fields are left; step 4 shows the document.
    // Typing on step 3 is sent when the person moves on, not on every key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Fields on step 3 still empty, by the person's latest typing.
  const stillMissing = useMemo(() => {
    if (!preview) return []
    return preview.asked.filter((v) => v.required && v.default === undefined && (typed[v.name] === undefined || typed[v.name] === "")).map((v) => v.name)
  }, [preview, typed])

  const labelOf = useCallback(
    (name: string) => preview?.asked.find((v) => v.name === name)?.label?.trim() || fieldLabel(name),
    [preview],
  )

  const create = async (andApprove: boolean) => {
    setSaving(andApprove ? "approve" : "draft")
    setError(null)
    try {
      const res = await fetch("/api/v1/contracts/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(false)),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(
          json?.code === "MISSING_FIELDS"
            ? t("errMissing", { fields: (json.missing as string[]).map(labelOf).join(", ") })
            : json?.code === "COMPANY_WRITE_DENIED"
              ? t("errCompanyRight")
              : json?.error || t("errCreate"),
        )
        return
      }
      const id = json.data.contract.id as string
      if (templateId === BLANK_TEMPLATE) router.push(`/contracts/${id}/editor`)
      else router.push(andApprove ? `/contracts/${id}?approve=1` : `/contracts/${id}`)
    } catch {
      setError(t("errCreate"))
    } finally {
      setSaving(null)
    }
  }

  if (loadError) return <div className="rounded-lg border bg-card p-6 text-sm text-destructive">{loadError}</div>
  if (!ctx) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    )
  }

  const ourIncomplete = !ctx.our.voen || !ctx.our.address || !ctx.our.director
  const canLeaveParties = name.trim().length > 0
  const steps = [t("stepTemplate"), t("stepParties"), t("stepTerms"), t("stepCheck")]
  const filledCount = preview ? preview.standard.length + preview.asked.filter((v) => !stillMissing.includes(v.name)).length : 0
  const totalCount = preview ? preview.standard.length + preview.asked.length : 0

  return (
    <div className="space-y-4" data-testid="contract-wizard">
      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("title")}>
        {steps.map((label, i) => {
          const n = i + 1
          const reachable = n <= step || (n === step + 1 && (step !== 2 || canLeaveParties))
          return (
            <button
              key={label}
              type="button"
              onClick={() => reachable && setStep(n)}
              aria-current={step === n ? "step" : undefined}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${step === n ? "border-primary bg-primary/5" : "bg-card"} ${reachable ? "" : "opacity-60"}`}
            >
              <span className="block font-semibold">{`${n}. ${label}`}</span>
            </button>
          )
        })}
      </nav>

      {ctx.deal && (
        <p className="text-sm text-muted-foreground">
          {t("fromDeal")}: <span className="font-medium text-foreground">{ctx.deal.name}</span>
        </p>
      )}

      {/* ── 1. Template ─────────────────────────────────────────────── */}
      {step === 1 && (
        <section className="space-y-4 rounded-xl border bg-card p-4" data-testid="wizard-step-template">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ctx.templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setTemplateId(tpl.id)}
                className={`rounded-lg border p-3 text-left ${templateId === tpl.id ? "border-primary bg-primary/5" : ""}`}
                data-testid={`wizard-template-${tpl.id}`}
              >
                <span className="block font-semibold">{tpl.name}</span>
                <span className="block text-xs text-muted-foreground">{t("templateMeta", { clauses: tpl.clauseCount, fields: tpl.ownFieldCount })}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTemplateId(BLANK_TEMPLATE)}
              className={`rounded-lg border p-3 text-left ${templateId === BLANK_TEMPLATE ? "border-primary bg-primary/5" : ""}`}
              data-testid="wizard-template-blank"
            >
              <span className="block font-semibold">{t("blankTitle")}</span>
              <span className="block text-xs text-muted-foreground">{t("blankHint")}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("templatesFrom")}{" "}
              <Link href="/contracts/templates" className="underline">
                {t("templatesLink")}
              </Link>
            </span>
            <Button onClick={() => setStep(2)}>
              {t("next")} <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {/* ── 2. Parties ──────────────────────────────────────────────── */}
      {step === 2 && (
        <section className="space-y-4" data-testid="wizard-step-parties">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{t("ourSide")}</h3>
                <Hint text={t("fromSettingsHint")}>
                  <span tabIndex={0} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    {t("fromSettings")}
                  </span>
                </Hint>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("company")}</dt>
                <dd>{ctx.our.name || "—"}</dd>
                <dt className="text-muted-foreground">VÖEN</dt>
                <dd>{ctx.our.voen || "—"}</dd>
                <dt className="text-muted-foreground">{t("address")}</dt>
                <dd>{ctx.our.address || "—"}</dd>
                <dt className="text-muted-foreground">{t("director")}</dt>
                <dd>{ctx.our.director || "—"}</dd>
              </dl>
              {ourIncomplete && (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" data-testid="wizard-our-incomplete">
                  {t("ourIncomplete")}{" "}
                  <Link href="/settings/invoice-settings" className="underline">
                    {t("ourSettingsLink")}
                  </Link>
                </p>
              )}
              <div>
                <Label htmlFor="wizard-our-bank">{t("ourBank")}</Label>
                {ctx.ourBanks.length > 0 ? (
                  <Select id="wizard-our-bank" value={ourBank} onChange={(e) => setOurBank(e.target.value)}>
                    {ctx.ourBanks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                    <option value="">{t("noOurBank")}</option>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("noOurBanks")}</p>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border bg-card p-4">
              <h3 className="font-semibold">{t("counterparty")}</h3>
              <div>
                <Label htmlFor="wizard-voen">VÖEN</Label>
                {/* Ten digits must stay readable on a phone: the button drops under the field there. */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="wizard-voen" inputMode="numeric" className="min-w-[12ch] sm:flex-1" value={voen} onChange={(e) => setVoen(e.target.value)} placeholder="0000000000" />
                  <Hint text={t("lookupHint")} wrap>
                    <Button type="button" variant="outline" onClick={lookUp} disabled={lookup.state === "busy"} data-testid="wizard-lookup">
                      {lookup.state === "busy" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
                      {t("lookup")}
                    </Button>
                  </Hint>
                </div>
              </div>
              {lookup.state === "found" && lookup.card && (
                <div
                  className={`space-y-1 rounded-md border p-3 text-sm ${lookup.card.active === false ? "border-destructive bg-destructive/5" : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"}`}
                  data-testid="wizard-registry-card"
                >
                  <p className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> {t("foundInRegistry")}
                  </p>
                  {lookup.card.legalForm && <p className="text-muted-foreground">{lookup.card.legalForm}</p>}
                  {lookup.card.vatPayer !== null && <p>{lookup.card.vatPayer ? t("vatPayer") : t("notVatPayer")}</p>}
                  {lookup.card.active === false && <p className="font-medium text-destructive">{t("inactiveCompany")}</p>}
                </div>
              )}
              {lookup.state === "error" && <p className="text-sm text-destructive">{lookup.message}</p>}
              {companyId ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="wizard-company-known">
                  <Building2 className="h-3.5 w-3.5" /> {t("companyKnown")}
                </p>
              ) : (
                name.trim() && <p className="text-xs text-muted-foreground">{t("companyNew")}</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="wizard-name">{`${t("company")} *`}</Label>
                  <Input id="wizard-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="wizard-address">{t("address")}</Label>
                  <Input id="wizard-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="wizard-director">{t("director")}</Label>
                  <Input id="wizard-director" value={director} onChange={(e) => setDirector(e.target.value)} />
                </div>
              </div>
              <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                  {tb("title")}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${companyHadBank ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"}`}>
                    {companyHadBank ? t("bankFromCard") : t("bankNotOnCard")}
                  </span>
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {BANK_FIELDS.map((field) => (
                    <div key={field}>
                      <Label htmlFor={`wizard-${field}`}>{tb(field)}</Label>
                      <Input id={`wizard-${field}`} value={bank[field]} onChange={(e) => setBank((b) => ({ ...b, [field]: e.target.value }))} />
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={saveBank} onChange={(e) => setSaveBank(e.target.checked)} className="accent-[hsl(var(--primary))]" />
                  {t("saveBank")}
                </label>
              </fieldset>
            </div>
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> {t("back")}
            </Button>
            <Hint text={canLeaveParties ? null : t("nameRequired")} wrap>
              <Button onClick={() => setStep(3)} disabled={!canLeaveParties}>
                {t("next")} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Hint>
          </div>
        </section>
      )}

      {/* ── 3. Terms ────────────────────────────────────────────────── */}
      {step === 3 && (
        <section className="space-y-4 rounded-xl border bg-card p-4" data-testid="wizard-step-terms">
          {previewBusy && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
            </p>
          ) : templateId === BLANK_TEMPLATE ? (
            <p className="text-sm text-muted-foreground">{t("blankTerms")}</p>
          ) : preview ? (
            <>
              <p className="text-sm font-medium" data-testid="wizard-filled-count">
                {t("filledCount", { filled: filledCount, total: totalCount })}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{t("auto")}</span>
                  <p>{t("autoFields", { count: preview.standard.length })}</p>
                </div>
                {preview.asked.map((v) => (
                  <div key={v.name}>
                    <Label htmlFor={`wizard-var-${v.name}`} className="flex flex-wrap items-center gap-2">
                      {labelOf(v.name)}
                      {v.required && v.default === undefined ? " *" : ""}
                      <code className="text-[11px] text-muted-foreground">{`{{${v.name}}}`}</code>
                      {v.default !== undefined && <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{t("fromTemplate")}</span>}
                    </Label>
                    {v.type === "boolean" ? (
                      <input
                        id={`wizard-var-${v.name}`}
                        type="checkbox"
                        checked={typed[v.name] === true}
                        onChange={(e) => setTyped((x) => ({ ...x, [v.name]: e.target.checked }))}
                      />
                    ) : (
                      <Input
                        id={`wizard-var-${v.name}`}
                        type={v.type === "number" ? "number" : v.type === "date" ? "date" : "text"}
                        value={typed[v.name] === undefined ? "" : String(typed[v.name])}
                        placeholder={v.default !== undefined ? String(v.default) : undefined}
                        onChange={(e) =>
                          setTyped((x) => {
                            const raw = e.target.value
                            const next = { ...x }
                            if (raw === "") delete next[v.name]
                            else next[v.name] = v.type === "number" ? Number(raw) : raw
                            return next
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              {stillMissing.length > 0 && (
                <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" data-testid="wizard-missing">
                  {t("missingFields", { count: stillMissing.length, fields: stillMissing.map(labelOf).join(", ") })}
                </p>
              )}
            </>
          ) : null}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> {t("back")}
            </Button>
            <Button onClick={() => setStep(4)}>
              {t("check")} <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {/* ── 4. Check ────────────────────────────────────────────────── */}
      {step === 4 && (
        <section className="space-y-4 rounded-xl border bg-card p-4" data-testid="wizard-step-check">
          {previewBusy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
            </p>
          )}
          {preview && !previewBusy && (
            <>
              <p className="text-sm text-muted-foreground" data-testid="wizard-company-plan">
                <Building2 className="mr-1 inline h-4 w-4" />
                {preview.company.action === "create"
                  ? t("planCreate", { name: preview.company.name })
                  : preview.company.fields.length > 0
                    ? t("planUpdate", { name: preview.company.name, fields: preview.company.fields.map((f) => (BANK_FIELDS.includes(f as BankField) ? tb(f as BankField) : t(`field_${f}` as "field_voen"))).join(", ") })
                    : t("planKeep", { name: preview.company.name })}
              </p>
              <div className="rounded-lg border bg-background p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4" /> {t("documentPreview")}
                </div>
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-testid="wizard-document">
                  {preview.renderedBody}
                </div>
              </div>
              {preview.missing.length > 0 && (
                <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  {t("missingFields", { count: preview.missing.length, fields: preview.missing.map(labelOf).join(", ") })}
                </p>
              )}
            </>
          )}
          {error && <p className="text-sm text-destructive" data-testid="wizard-error">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> {t("back")}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Hint text={t("saveDraftHint")} wrap>
                <Button variant="outline" onClick={() => create(false)} disabled={saving !== null || previewBusy || (preview?.missing.length ?? 0) > 0} data-testid="wizard-save-draft">
                  {saving === "draft" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {templateId === BLANK_TEMPLATE ? t("saveAndWrite") : t("saveDraft")}
                </Button>
              </Hint>
              {templateId !== BLANK_TEMPLATE && (
                <Hint text={t("sendApprovalHint")} wrap>
                  <Button onClick={() => create(true)} disabled={saving !== null || previewBusy || (preview?.missing.length ?? 0) > 0} data-testid="wizard-send-approval">
                    {saving === "approve" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    {t("sendApproval")}
                  </Button>
                </Hint>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

/** The page around the wizard: back to the list, the title, one line on what happens. */
export function ContractWizardScreen({ dealId }: { dealId: string | null }) {
  const t = useTranslations("contractWizard")
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/contracts">
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("backToList")}
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ContractWizard dealId={dealId} />
    </div>
  )
}
