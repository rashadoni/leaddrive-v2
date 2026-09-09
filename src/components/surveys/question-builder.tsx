"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Plus, Trash2, GripVertical } from "lucide-react"

export type QType = "nps" | "rating" | "text" | "choice" | "yesno"

export interface Question {
  id: string
  type: QType
  label: string
  required?: boolean
  max?: number
  options?: string[]
}

interface Props {
  value: Question[]
  onChange: (next: Question[]) => void
}

function rid() {
  return "q_" + Math.random().toString(36).slice(2, 9)
}

export function QuestionBuilder({ value, onChange }: Props) {
  const update = (idx: number, patch: Partial<Question>) => {
    const next = value.map((q, i) => (i === idx ? { ...q, ...patch } : q))
    onChange(next)
  }
  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next)
  }
  const add = (type: QType) => {
    const base: Question = { id: rid(), type, label: "" }
    if (type === "rating") base.max = 5
    if (type === "nps") base.max = 10
    if (type === "choice") base.options = ["Option 1", "Option 2"]
    onChange([...value, base])
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">No questions yet. Add one below.</p>
      )}
      {value.map((q, idx) => (
        <div key={q.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => move(idx, -1)} disabled={idx === 0} className="disabled:opacity-30 text-muted-foreground hover:text-foreground">
                <GripVertical className="h-3 w-3 rotate-90" />
              </button>
            </div>
            <Select value={q.type} onChange={e => update(idx, { type: e.target.value as QType })} className="h-8 w-32 text-xs">
              <option value="nps">NPS (0–10)</option>
              <option value="rating">Rating</option>
              <option value="text">Text</option>
              <option value="choice">Choice</option>
              <option value="yesno">Yes / No</option>
            </Select>
            <Input
              value={q.label}
              onChange={e => update(idx, { label: e.target.value })}
              placeholder="Question text"
              className="h-8 flex-1 text-xs"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              <input type="checkbox" checked={!!q.required} onChange={e => update(idx, { required: e.target.checked })} />
              Required
            </label>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-500" onClick={() => remove(idx)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {q.type === "rating" && (
            <div className="flex items-center gap-2 pl-8">
              <Label className="text-xs text-muted-foreground">Max</Label>
              <Input
                type="number"
                min={3}
                max={10}
                value={q.max ?? 5}
                onChange={e => update(idx, { max: parseInt(e.target.value) || 5 })}
                className="h-7 w-20 text-xs"
              />
            </div>
          )}

          {q.type === "choice" && (
            <div className="pl-8 space-y-1">
              {(q.options || []).map((opt, oIdx) => (
                <div key={oIdx} className="flex items-center gap-2">
                  <Input
                    value={opt}
                    onChange={e => {
                      const opts = [...(q.options || [])]
                      opts[oIdx] = e.target.value
                      update(idx, { options: opts })
                    }}
                    className="h-7 flex-1 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      const opts = (q.options || []).filter((_, i) => i !== oIdx)
                      update(idx, { options: opts })
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => update(idx, { options: [...(q.options || []), `Option ${(q.options?.length || 0) + 1}`] })}
              >
                <Plus className="h-3 w-3" /> Add option
              </Button>
            </div>
          )}
        </div>
      ))}

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("nps")}>
          <Plus className="h-3.5 w-3.5" /> NPS
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("rating")}>
          <Plus className="h-3.5 w-3.5" /> Rating
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("text")}>
          <Plus className="h-3.5 w-3.5" /> Text
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("choice")}>
          <Plus className="h-3.5 w-3.5" /> Choice
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => add("yesno")}>
          <Plus className="h-3.5 w-3.5" /> Yes/No
        </Button>
      </div>
    </div>
  )
}
