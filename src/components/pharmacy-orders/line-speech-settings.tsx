"use client"

import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { PhoneOrdersViews } from "./phone-orders-views"

type Speech = { greeting: string; closing: string; manner: string; knowledge: string; rules: string }
type Data = { speech: Speech; defaults: { greeting: string; closing: string }; notesMax: number; canEdit: boolean }
type Field = keyof Speech

const CARD = "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
const ALWAYS = ["alwaysCatalog", "alwaysSaves", "alwaysAsks", "alwaysUnits", "alwaysStock", "alwaysCancel", "alwaysLanguage", "alwaysVoice", "alwaysMedical"] as const

/**
 * What the phone order line says (owner, 2026-10-31, mockup «Давай»): the
 * greeting, the goodbye and the company's notes. The order desk's own rules
 * are listed below the form and are not editable here.
 */
export function LineSpeechSettings() {
  const t = useTranslations("pharmacyPhoneOrders")
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<Speech | null>(null)
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "failed" | "too_long" } | { kind: "invalid"; field: Field }>({ kind: "idle" })
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let live = true
    void fetch("/api/v1/pharmacy-orders/line-speech", { cache: "no-store" }).then(async response => {
      if (!live) return
      if (!response.ok) { setLoadFailed(true); return }
      const value = (await response.json()).data as Data
      setData(value); setDraft(value.speech)
    })
    return () => { live = false }
  }, [])

  const set = (field: Field) => (value: string) => { setDraft(current => current && { ...current, [field]: value }); setState({ kind: "idle" }) }
  const save = async () => {
    if (!draft || !data) return
    setState({ kind: "saving" })
    const response = await fetch("/api/v1/pharmacy-orders/line-speech", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft),
    })
    const body = await response.json().catch(() => ({}))
    if (response.ok) { setData({ ...data, speech: body.data.speech }); setDraft(body.data.speech); setState({ kind: "saved" }); return }
    if (body?.error === "too_long") setState({ kind: "too_long" })
    else if (body?.error === "invalid" && typeof body.field === "string") setState({ kind: "invalid", field: body.field as Field })
    else setState({ kind: "failed" })
  }

  const used = draft ? draft.manner.trim().length + draft.knowledge.trim().length + draft.rules.trim().length : 0
  const left = data ? data.notesMax - used : 0
  const changed = Boolean(data && draft && (Object.keys(draft) as Field[]).some(key => draft[key] !== data.speech[key]))
  const readOnly = !data?.canEdit

  const fieldError = (field: Field) => state.kind === "invalid" && state.field === field
    ? <p className="text-xs text-red-600">{t(field === "greeting" || field === "closing" ? "speechInvalidPhrase" : "speechInvalidNote")}</p> : null
  const phrase = (field: "greeting" | "closing", max: number) => (
    <section className={CARD}>
      <h2 className="font-semibold">{t(field === "greeting" ? "speechGreeting" : "speechClosing")}</h2>
      <p className="text-xs text-muted-foreground">{t(field === "greeting" ? "speechGreetingHint" : "speechClosingHint")}</p>
      <Input value={draft?.[field] ?? ""} maxLength={max} disabled={readOnly} onChange={event => set(field)(event.target.value)} />
      {fieldError(field)}
      <p className="text-right text-xs text-muted-foreground">{(draft?.[field] ?? "").length} / {max}</p>
    </section>
  )
  const note = (field: "manner" | "knowledge" | "rules") => (
    <section className={CARD}>
      <h2 className="font-semibold">{t(`speech_${field}`)}</h2>
      <p className="text-xs text-muted-foreground">{t(`speech_${field}Hint`)}</p>
      <Textarea value={draft?.[field] ?? ""} disabled={readOnly} placeholder={t(`speech_${field}Placeholder`)}
        className={cn("[field-sizing:content]", field === "knowledge" ? "min-h-[120px]" : "min-h-[96px]")}
        onChange={event => set(field)(event.target.value)} />
      {fieldError(field)}
    </section>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-7">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PhoneOrdersViews active="speech" />
      {loadFailed ? <p className="text-sm text-red-600">{t("errorGeneric")}</p> : !data || !draft ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <span className="font-medium">{t("speechIntro")}</span>
            <span className="text-muted-foreground">{t(readOnly ? "speechIntroReadOnly" : "speechIntroHint")}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {phrase("greeting", 200)}
            {phrase("closing", 120)}
          </div>
          {note("knowledge")}
          <div className="grid gap-4 md:grid-cols-2">
            {note("manner")}
            {note("rules")}
          </div>
          {readOnly ? null : (
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("text-sm", left < 0 || state.kind === "too_long" ? "font-semibold text-red-600" : "text-muted-foreground")}>
                {t("speechBudget", { left: Math.max(left, 0), max: data.notesMax })}
              </span>
              {state.kind === "saved" ? <span className="text-sm font-medium text-emerald-600">{t("speechSaved")}</span> : null}
              {state.kind === "failed" ? <span className="text-sm text-red-600">{t("errorGeneric")}</span> : null}
              <span className="ml-auto" />
              <Button variant="outline" onClick={() => { setDraft({ ...data.defaults, manner: "", knowledge: "", rules: "" }); setState({ kind: "idle" }) }}>
                {t("speechReset")}
              </Button>
              <Button disabled={!changed || left < 0 || state.kind === "saving"} onClick={() => void save()}>{t("save")}</Button>
            </div>
          )}
          <section className="rounded-xl border border-border bg-card p-4 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <h2 className="mb-2 font-semibold">{t("speechAlwaysTitle")}</h2>
            <ul className="grid gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
              {ALWAYS.map(key => <li key={key}>· {t(key)}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
