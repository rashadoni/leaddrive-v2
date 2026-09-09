"use client"

/**
 * CustomFieldFilterBar — chip-style filter UI for custom field values.
 *
 * Renders above the InlineTasksTable. Shows active filters as removable
 * chips, plus a "+ Filter" button that opens a popover to add new filters.
 *
 * For each select/boolean custom field, the user can choose one or more
 * allowed values; tasks whose customFields[fieldName] is NOT in the set
 * are filtered out.
 *
 * For text/number/date/textarea fields, filtering by exact value is
 * deferred (less useful than free-text search — out of scope for v1).
 *
 * Filter state shape: { [fieldName]: string[] }
 *   Empty array OR missing key = no filter on that field.
 */

import { useState, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Plus, X, Filter, Check } from "lucide-react"
import type { CustomFieldDef } from "@/components/tasks/inline-tasks-table"

interface Props {
  defs: CustomFieldDef[]
  filters: Record<string, string[]>
  onFiltersChange: (next: Record<string, string[]>) => void
}

export function CustomFieldFilterBar({ defs, filters, onFiltersChange }: Props) {
  const t = useTranslations("tasks")
  const [addOpen, setAddOpen] = useState(false)
  const [editingField, setEditingField] = useState<string | null>(null)
  const addContainerRef = useRef<HTMLDivElement>(null)

  // Only filterable types (others don't make sense as multi-select chips)
  const filterableDefs = defs.filter(d => d.isActive && (d.fieldType === "select" || d.fieldType === "boolean"))

  // Fields with no active filter — candidates to add
  const availableToAdd = filterableDefs.filter(d => !filters[d.fieldName] || filters[d.fieldName].length === 0)

  // Filter entries to RENDER as chips: those with values OR currently being edited
  // (the empty-value case appears right after "+ Filter > Outcome" and stays
  //  visible until user picks values OR clicks outside without picking).
  const visibleEntries = Object.entries(filters).filter(
    ([fieldName, values]) => values.length > 0 || editingField === fieldName,
  )
  // Entries that ACTUALLY filter — used for the "Clear all" check
  const activeEntries = Object.entries(filters).filter(([, values]) => values.length > 0)

  // Close popover on outside click
  useEffect(() => {
    if (!addOpen) return
    const handler = (e: MouseEvent) => {
      if (addContainerRef.current && !addContainerRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [addOpen])

  const removeFilter = (fieldName: string) => {
    const next = { ...filters }
    delete next[fieldName]
    onFiltersChange(next)
  }

  const clearAll = () => onFiltersChange({})

  const setFieldFilter = (fieldName: string, values: string[]) => {
    const next = { ...filters }
    if (values.length === 0) delete next[fieldName]
    else next[fieldName] = values
    onFiltersChange(next)
  }

  // Hide bar entirely when nothing to show AND nothing to add
  if (filterableDefs.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-1">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1 mr-1">
        <Filter className="h-3 w-3" />
        {t("inlineFilterLabel")}
      </span>

      {visibleEntries.length === 0 && (
        <span className="text-xs text-muted-foreground italic">{t("inlineFilterNone")}</span>
      )}

      {visibleEntries.map(([fieldName, values]) => {
        const def = defs.find(d => d.fieldName === fieldName)
        if (!def) return null
        const isEditing = editingField === fieldName
        return (
          <FilterChip
            key={fieldName}
            def={def}
            values={values}
            isEditing={isEditing}
            onOpen={() => setEditingField(isEditing ? null : fieldName)}
            onClose={() => setEditingField(null)}
            onChange={(next) => setFieldFilter(fieldName, next)}
            onRemove={() => removeFilter(fieldName)}
          />
        )
      })}

      {/* + Filter button (hidden when no more fields to add) */}
      {availableToAdd.length > 0 && (
        <div ref={addContainerRef} className="relative">
          <button
            type="button"
            onClick={() => setAddOpen(o => !o)}
            title={t("inlineAddFilterTooltip")}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-zinc-300 dark:border-zinc-600 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-3 w-3" />
            {t("inlineFilterButton")}
          </button>
          {addOpen && (
            <div className="absolute z-50 mt-1 min-w-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md py-1">
              {availableToAdd.map(def => (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => {
                    setAddOpen(false)
                    // Seed with empty array so chip appears, then open editor
                    onFiltersChange({ ...filters, [def.fieldName]: [] })
                    setEditingField(def.fieldName)
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  {def.fieldLabel}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeEntries.length > 1 && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
        >
          {t("inlineClearAllFilters")}
        </button>
      )}
    </div>
  )
}

// ─── Individual filter chip ──────────────────────────────────────
function FilterChip({
  def, values, isEditing, onOpen, onClose, onChange, onRemove,
}: {
  def: CustomFieldDef
  values: string[]
  isEditing: boolean
  onOpen: () => void
  onClose: () => void
  onChange: (next: string[]) => void
  onRemove: () => void
}) {
  const t = useTranslations("tasks")
  const containerRef = useRef<HTMLDivElement>(null)

  // Mirror handlers/values into refs so the outside-click listener stays stable.
  // Without this, the parent passes a fresh `onRemove` and (potentially) `onClose`
  // on every render — re-binding the document listener on every parent update,
  // and risking a stale `values` snapshot at click time.
  const onCloseRef = useRef(onClose)
  const onRemoveRef = useRef(onRemove)
  const valuesRef = useRef(values)
  useEffect(() => {
    onCloseRef.current = onClose
    onRemoveRef.current = onRemove
    valuesRef.current = values
  })

  // Close editor on outside click. Effect re-binds ONLY when isEditing toggles.
  useEffect(() => {
    if (!isEditing) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCloseRef.current()
        // If user closed editor without selecting any values, remove the chip
        if (valuesRef.current.length === 0) onRemoveRef.current()
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [isEditing])

  // Available options depend on type
  const options = def.fieldType === "boolean" ? ["true", "false"] : (def.options || [])

  const toggle = (opt: string) => {
    if (values.includes(opt)) onChange(values.filter(v => v !== opt))
    else onChange([...values, opt])
  }

  const labelForOption = (opt: string) => {
    if (def.fieldType === "boolean") return opt === "true" ? t("inlineBooleanYes") : t("inlineBooleanNo")
    return opt
  }

  const summary = values.length === 0
    ? t("inlineFilterAny")
    : values.length <= 2
      ? values.map(labelForOption).join(", ")
      : `${values.length} selected`

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors",
          isEditing && "ring-2 ring-primary/40",
        )}
      >
        <span className="font-medium">{def.fieldLabel}:</span>
        <span className="font-normal">{summary}</span>
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="inline-flex p-0.5 ml-0.5 rounded hover:bg-primary/20"
        >
          <X className="h-3 w-3" />
        </span>
      </button>

      {isEditing && (
        <div className="absolute z-50 left-0 top-full mt-1 min-w-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md py-1">
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t("inlineNoOptionsDefined")}</div>
          )}
          {options.map(opt => {
            const checked = values.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2",
                  checked && "bg-muted/60 font-medium",
                )}
              >
                <span className={cn(
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600",
                )}>
                  {checked && <Check className="h-2.5 w-2.5" />}
                </span>
                <span>{labelForOption(opt)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
