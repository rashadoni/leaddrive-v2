"use client"

/**
 * «Названия в вашей компании»: what this organisation books, and who does it.
 *
 * The module was written for salons, so every screen said «service» and
 * «master». A coworking books rooms and nobody does them; a clinic books an
 * appointment with a doctor (owner, 2026-11-12). The two nouns are a setting
 * now, and this is where they are set.
 *
 * Three things make it readable rather than two mystery fields, which is what
 * the owner asked for in the same breath («чтоб было интуитивно… максимально
 * понятно»):
 *
 *   1. Ready-made pairs first. One tap says «we are a clinic» and both words
 *      are filled — most organisations never touch the fields at all.
 *   2. «Nobody does it» is a checkbox, not an empty field. An empty field
 *      means «not filled in»; a room that books itself is a decision.
 *   3. A preview of the client's own form underneath, with the words in it.
 *      The setting is invisible everywhere else until a client opens WhatsApp.
 */
import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { BOOKING_VOCABULARY_PRESETS, matchingPreset, type BookingVocabulary } from "@/lib/booking/vocabulary"

type Locale = "az" | "ru" | "en"

export function BookingVocabularyCard() {
  const t = useTranslations("booking")
  const locale = (useLocale() as Locale) ?? "az"
  const [stored, setStored] = useState<BookingVocabulary | null>(null)
  const [draft, setDraft] = useState<BookingVocabulary>({ item: null, host: null, noHost: false })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/booking-pages/vocabulary", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!body?.success || controller.signal.aborted) return
        setStored(body.data.vocabulary)
        setDraft(body.data.vocabulary)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function save() {
    setSaving(true); setError(""); setSaved(false)
    const response = await fetch("/api/v1/booking-pages/vocabulary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setSaving(false)
    if (!response?.ok || !body?.success) { setError(t("errSave")); return }
    setStored(body.data.vocabulary)
    setDraft(body.data.vocabulary)
    setSaved(true)
  }

  if (!stored) return null
  const chosen = matchingPreset(draft, locale)
  const changed = draft.item !== stored.item || draft.host !== stored.host || draft.noHost !== stored.noHost
  /** What the words look like on a client's screen right now. */
  const itemWord = draft.item ?? t("stepService")
  const hostWord = draft.host ?? t("colHosts")

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Tags className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t("vocabTitle")}</h2>
            <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">{t("vocabDesc")}</p>
          </div>
        </div>

        {/* The pairs first: one tap is the whole setting for most people. */}
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("vocabPresets")}>
          {BOOKING_VOCABULARY_PRESETS.map((preset) => {
            const words = preset.words[locale] ?? preset.words.az
            const active = chosen === preset.id
            return <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => setDraft({ item: words.item, host: words.host, noHost: Boolean(preset.noHost) })}
              className={cn("min-h-11 rounded-lg border px-3 text-sm transition-colors",
                active ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted")}
            >
              {words.item}{words.host ? ` · ${words.host}` : ` · ${t("vocabNoHostShort")}`}
            </button>
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="w-56 space-y-1">
            <Label htmlFor="vocab-item">{t("vocabItem")}</Label>
            <Input
              id="vocab-item"
              value={draft.item ?? ""}
              placeholder={t("stepService")}
              maxLength={30}
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, item: event.target.value || null })}
              className="min-h-11"
            />
          </div>
          <div className="w-56 space-y-1">
            <Label htmlFor="vocab-host">{t("vocabHost")}</Label>
            <Input
              id="vocab-host"
              value={draft.host ?? ""}
              placeholder={t("colHosts")}
              maxLength={30}
              disabled={saving || draft.noHost}
              onChange={(event) => setDraft({ ...draft, host: event.target.value || null })}
              className="min-h-11"
            />
          </div>
          {/* «Nobody does it» is a decision, not an empty field. */}
          <label className="flex min-h-11 items-center gap-2 self-end text-sm">
            <Checkbox
              checked={draft.noHost}
              disabled={saving}
              onCheckedChange={(value) => setDraft({ ...draft, noHost: value === true, host: value === true ? null : draft.host })}
            />
            <span>{t("vocabNoHost")}</span>
          </label>
        </div>

        {/* The one place these words are read by somebody who is not staff. */}
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("vocabPreview")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[itemWord, ...(draft.noHost ? [] : [hostWord]), t("vocabPreviewDay"), t("vocabPreviewTime")].map((word, index) => <span
              key={`${word}-${index}`}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
            >{word}</span>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("vocabPreviewHint")}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={saving || !changed} onClick={() => void save()}>{t("save")}</Button>
          {saved && !changed ? <span role="status" className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" aria-hidden="true" />{t("vocabSaved")}
          </span> : null}
          {error ? <span role="alert" className="text-sm text-destructive">{error}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}
