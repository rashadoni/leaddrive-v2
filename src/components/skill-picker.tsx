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
  emptyHint?: string
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Chip multi-select for skill tags. Normalising every value to lowercase + picking from a shared
 * canonical list (the org's queue skills) is what stops the free-text drift — "Technical" / "texniki"
 * / "tech" can no longer diverge because agents pick, they don't type. Only the queue form (allowAdd)
 * introduces new canonical tags.
 */
export function SkillPicker({ value, onChange, options, allowAdd = false, addPlaceholder, emptyHint }: SkillPickerProps) {
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
      <div className="flex flex-wrap gap-1.5">
        {all.length === 0 && (
          <span className="text-xs text-muted-foreground">
            {emptyHint || (allowAdd ? "Add a skill below." : "No skills defined yet — create a queue with skills first.")}
          </span>
        )}
        {all.map((skill) => {
          const isSel = selected.includes(skill)
          return (
            <button
              key={skill}
              type="button"
              onClick={() => toggle(skill)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                isSel
                  ? "border-primary bg-primary text-primary-foreground"
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
            placeholder={addPlaceholder || "new skill…"}
            className="h-8 text-sm"
          />
          <Button type="button" size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>Add</Button>
        </div>
      )}
    </div>
  )
}
