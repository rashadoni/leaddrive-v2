"use client"

/**
 * M1 — Template picker modal.
 *
 * Shown when the user creates a new email template and picks editorType="visual".
 * Displays the 6 pre-built presets + a "Blank" option.
 *
 * Props:
 *   open         — controlled visibility
 *   onSelect(id) — called with preset id ("blank" | preset.id)
 *   onClose      — called when user dismisses without picking
 */

import { useTranslations } from "next-intl"
import { EMAIL_TEMPLATE_PRESETS, type EmailTemplatePreset } from "./email-templates"

interface TemplatePickerProps {
  open: boolean
  onSelect: (presetId: string) => void
  onClose: () => void
}

const BLANK: EmailTemplatePreset = {
  id: "blank",
  name: "Blank",
  description: "Start from scratch",
  emoji: "📄",
  category: "general",
  html: "",
}

export function TemplatePicker({ open, onSelect, onClose }: TemplatePickerProps) {
  const t = useTranslations("emailEditor")
  const labelKey = (id: string, kind: "Name" | "Desc") =>
    (id === "blank" ? `blank${kind}` : `preset${id[0].toUpperCase()}${id.slice(1)}${kind}`) as Parameters<typeof t>[0]
  if (!open) return null

  const all = [BLANK, ...EMAIL_TEMPLATE_PRESETS]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="relative w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-5 border-b">
            <h2 className="text-lg font-semibold">{t("pickTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("pickSubtitle")}
            </p>
          </div>

          {/* Grid */}
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {all.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelect(preset.id)}
                className="group flex flex-col items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-left transition-all hover:border-primary hover:bg-primary/5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-3xl leading-none">{preset.emoji}</span>
                <div>
                  <p className="text-sm font-semibold group-hover:text-primary transition-colors">
                    {t(labelKey(preset.id, "Name"))}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {t(labelKey(preset.id, "Desc"))}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
