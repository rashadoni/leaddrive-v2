"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { contactClassOptions } from "@/lib/mtm/contact-classes"

/**
 * The client's class (A, B, C, VIP…) where people look for it: on the card's
 * «Категории и оценки» tab, one press per letter.
 *
 * The class used to be reachable only inside the «Изменить контакт» form, as a
 * dropdown among thirty fields, while this tab — named after it — showed a
 * block about reference lists titled «Категории клиента». The owner opened the
 * tab to set a doctor's category and found nothing to press (2026-10-04).
 *
 * Saving is the card's ordinary direct update (the same endpoint and the same
 * optimistic-concurrency token the edit form sends), so it is audited and
 * conflict-checked like any other change. People who may only propose changes
 * see the current class and are told who can change it.
 */
export function MtmContactClassPicker({
  contactId,
  value,
  classes,
  contactUpdatedAt,
  canManage,
  orgId,
  onChanged,
}: {
  contactId: string
  value: string
  /** The tenant's classes (MTM setting `contactClasses`). */
  classes: unknown
  contactUpdatedAt: string
  canManage: boolean
  orgId?: string
  onChanged: () => void | Promise<void>
}) {
  const t = useTranslations("mtmContactDetail")
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState("")
  const options = contactClassOptions(classes, value)

  const choose = async (next: string) => {
    if (next === value || saving) return
    setSaving(next)
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/contacts/${contactId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({ expectedContactUpdatedAt: contactUpdatedAt, category: next }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string } | null
        throw new Error(body?.code === "MTM_CONTACT_CONFLICT" ? t("classConflict") : t("classSaveError"))
      }
      await onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("classSaveError"))
    } finally {
      setSaving(null)
    }
  }

  return (
    <section data-testid="mtm-contact-class" className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">{t("classTitle")}</h2>
          <p className="text-sm text-muted-foreground">{canManage ? t("classDescription") : t("classReadOnly")}</p>
        </div>
        {canManage ? (
          <Link href="/mtm/settings#mtm-contact-card-title" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            {t("classSettings")}
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("classTitle")}>
        {options.map((option) => {
          const selected = option === value
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`mtm-contact-class-${option}`}
              disabled={!canManage || saving !== null}
              onClick={() => void choose(option)}
              className={cn(
                "inline-flex min-h-11 min-w-14 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-zinc-200 bg-background text-foreground dark:border-zinc-700",
                canManage && !selected && "hover:border-zinc-400",
                !canManage && !selected && "opacity-60",
              )}
            >
              {saving === option ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {option}
            </button>
          )
        })}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </section>
  )
}
