"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, Stethoscope, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  coerceMtmContactSpecialties,
  contactSpecialtyKey,
  MTM_CONTACT_SPECIALTY_MAX_COUNT,
  MTM_CONTACT_SPECIALTY_MAX_LENGTH,
  splitContactSpecialtyInput,
} from "@/lib/mtm/contact-specialties"

/**
 * The tenant's list of client specialties: what the client form offers and
 * what the «Клиенты» filter lists. Saved with the page's «Сохранить», like the
 * settings above it.
 */
export function ContactSpecialtySettings({
  value,
  onChange,
}: {
  value: unknown
  onChange: (value: string[]) => void
}) {
  const t = useTranslations("mtmSettingsPage")
  const specialties = coerceMtmContactSpecialties(value)
  const [draft, setDraft] = useState("")
  const [notice, setNotice] = useState("")

  const add = (text: string) => {
    const names = splitContactSpecialtyInput(text)
    if (names.length === 0) return
    const known = new Set(specialties.map(contactSpecialtyKey))
    const fresh: string[] = []
    for (const name of names) {
      const key = contactSpecialtyKey(name)
      if (known.has(key)) continue
      known.add(key)
      fresh.push(name.slice(0, MTM_CONTACT_SPECIALTY_MAX_LENGTH))
    }
    if (fresh.length === 0) {
      setNotice(t("specialtiesDuplicate"))
      return
    }
    if (specialties.length + fresh.length > MTM_CONTACT_SPECIALTY_MAX_COUNT) {
      setNotice(t("specialtiesLimit", { count: MTM_CONTACT_SPECIALTY_MAX_COUNT }))
      return
    }
    onChange([...specialties, ...fresh])
    setDraft("")
    setNotice("")
  }

  return (
    <section data-testid="mtm-contact-specialty-settings" className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5" aria-labelledby="mtm-contact-specialties-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-3xl gap-1">
          <h2 id="mtm-contact-specialties-title" className="flex items-center gap-2 text-base font-semibold">
            <Stethoscope className="h-4 w-4 text-primary" />
            {t("specialtiesTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("specialtiesHint")}</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {t("specialtiesCount", { count: specialties.length })}
        </span>
      </div>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add(draft)
        }}
      >
        <label className="grid min-w-0 flex-[1_1_18rem] gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("specialtiesAddLabel")}</span>
          <Input
            data-testid="mtm-contact-specialty-new"
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setNotice("") }}
            // A column copied out of Excel arrives as lines; a one-line input
            // would glue them into one name.
            onPaste={(event) => {
              const text = event.clipboardData.getData("text")
              if (!/[\n\r]/.test(text)) return
              event.preventDefault()
              add(text)
            }}
            placeholder={t("specialtiesAddPlaceholder")}
            maxLength={MTM_CONTACT_SPECIALTY_MAX_LENGTH}
          />
        </label>
        <Button type="submit" variant="outline" className="min-h-10" disabled={!draft.trim()}>
          <Plus className="h-4 w-4" />{t("specialtiesAdd")}
        </Button>
      </form>
      {notice ? <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">{notice}</p> : null}

      {specialties.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("specialtiesEmpty")}</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {specialties.map((name) => (
            <li key={name} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-zinc-200 bg-background pl-3 pr-1 text-sm dark:border-zinc-700">
              <span>{name}</span>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={t("specialtiesRemove", { name })}
                title={t("specialtiesRemove", { name })}
                onClick={() => onChange(specialties.filter((item) => item !== name))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
