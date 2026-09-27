"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SkillPickerProps {
  /** Selected skills (canonical, lowercase). */
  value: string[]
  onChange: (skills: string[]) => void
  /** Canonical skills available to pick (e.g. the org's queue skills). */
  options: string[]
  /** Admin-only: allow introducing a NEW canonical tag (queue form). Agents pick-only. */
  allowAdd?: boolean
  addPlaceholder?: string
  addLabel?: string
  emptyHint?: string
  ariaLabel?: string
  disabled?: boolean
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Chip multi-select for skill tags. Normalising every value to lowercase + picking from a shared
 * canonical list (the org's queue skills) is what stops the free-text drift — "Technical" / "texniki"
 * / "tech" can no longer diverge because agents pick, they don't type. Only the queue form (allowAdd)
 * introduces new canonical tags.
 */
export function SkillPicker({ value, onChange, options, allowAdd = false, addPlaceholder, addLabel, emptyHint, ariaLabel, disabled = false }: SkillPickerProps) {
  const [draft, setDraft] = useState("")
  const selected = value.map(norm)
  // Canonical options ∪ already-selected (so a skill not yet in any queue still shows + stays selected).
  const all = Array.from(new Set([...options.map(norm), ...selected].filter(Boolean))).sort()

  const toggle = (skill: string) => {
    const s = norm(skill)
    onChange(selected.includes(s) ? selected.filter((v) => v !== s) : [...selected, s])
  }
  const add = () => {
    const s = norm(draft)
    if (s && !selected.includes(s)) onChange([...selected, s])
    setDraft("")
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel} data-testid="skill-picker-options">
        {all.length === 0 && (
          <span className="text-xs text-muted-foreground">
            {emptyHint}
          </span>
        )}
        {all.map((skill) => {
          const isSel = selected.includes(skill)
          return (
            <button
              key={skill}
              type="button"
              aria-pressed={isSel}
              onClick={() => toggle(skill)}
              disabled={disabled}
              data-testid="skill-picker-option"
              data-skill={skill}
              className={cn(
                "inline-flex min-h-11 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60",
                isSel
                  ? "border-primary bg-primary text-zinc-950"
                  : "border-zinc-200 dark:border-zinc-700 bg-background hover:bg-muted"
              )}
            >
              {isSel && <Check className="h-3 w-3" />}
              {skill}
            </button>
          )
        })}
      </div>
      {allowAdd && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
            placeholder={addPlaceholder}
            className="min-h-11 text-sm"
            disabled={disabled}
          />
          <Button type="button" variant="outline" className="min-h-11" onClick={add} disabled={disabled || !draft.trim()}>{addLabel}</Button>
        </div>
      )}
    </div>
  )
}
