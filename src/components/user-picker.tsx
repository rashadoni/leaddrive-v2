"use client"

/**
 * Shared user-picker popover. Roadmap #19 Phase F.
 *
 * Used by the bulk-actions bar on deals + leads (and any future list
 * page) to let an operator reassign multiple records to one user (or
 * unassign them all).
 *
 * UX:
 *   - Button trigger → popover with search input + scrollable user list
 *   - "— Unassign —" pinned at top sends `null` to the API (clears the FK)
 *   - Click outside / Esc closes the popover
 *   - After selection the popover closes; parent receives `onSelect(id|null)`
 *
 * Fetches `/api/v1/users/assignable` once on mount (the same endpoint
 * the task-form's assignee dropdown uses). Cached on the parent if it
 * passes `users` directly — otherwise the picker fetches lazily.
 */

import { useState, useRef, useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, Loader2, User } from "lucide-react"
import { cn } from "@/lib/utils"

export interface UserPickerOption {
  id: string
  name: string
  email?: string
  avatar?: string | null
}

interface Props {
  /** Triggers the API call when null; pass users to skip the fetch */
  users?: UserPickerOption[]
  /** Disable the trigger button (e.g. while a bulk request is in flight) */
  disabled?: boolean
  /** Trigger button label (defaults to "Reassign…") */
  label?: string
  /** Called when the user picks a row. `null` = unassign. */
  onSelect: (userId: string | null) => void | Promise<void>
  /** Override the org header for the lazy fetch path */
  orgId?: string | null
  /** Custom className for the trigger button */
  className?: string
}

export function UserPicker({ users, disabled, label, onSelect, orgId, className }: Props) {
  const t = useTranslations("common")
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [fetched, setFetched] = useState<UserPickerOption[] | null>(users ?? null)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Lazy-load users when first opened (only if parent didn't pass them in)
  useEffect(() => {
    if (!open || fetched !== null) return
    setLoading(true)
    fetch("/api/v1/users/assignable", {
      headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) {
          setFetched([])
          return
        }
        const arr = Array.isArray(j.data) ? j.data : (j.data?.users || [])
        setFetched(arr.map((u: { id: string; name?: string; email?: string; avatar?: string | null }) => ({
          id: u.id,
          name: u.name || u.email || u.id,
          email: u.email,
          avatar: u.avatar ?? null,
        })))
      })
      .catch(() => setFetched([]))
      .finally(() => setLoading(false))
  }, [open, fetched, orgId])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Close on Esc; focus the search input on open
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  const filtered = useMemo(() => {
    const all = fetched ?? users ?? []
    if (!search) return all
    const q = search.toLowerCase()
    return all.filter((u) => u.name.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
  }, [fetched, users, search])

  const pick = async (userId: string | null) => {
    setOpen(false)
    setSearch("")
    await onSelect(userId)
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1 h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-card text-xs hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        aria-label={label || t("reassign") || "Reassign"}
        aria-expanded={open}
      >
        <User className="h-3.5 w-3.5" />
        {label || t("reassign") || "Reassign"}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 right-0 min-w-[240px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md">
          <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchUsers") || "Search users…"}
              className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            {/* Unassign — pinned at top */}
            <button
              type="button"
              onClick={() => pick(null)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2 italic text-muted-foreground"
            >
              {t("unassign") || "— Unassign —"}
            </button>

            {loading && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("loading") || "Loading…"}
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                {t("noResults") || "No users found"}
              </div>
            )}

            {filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pick(u.id)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
              >
                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary shrink-0">
                  {u.name?.charAt(0)?.toUpperCase() || "?"}
                </div>
                <span className="truncate flex-1">{u.name}</span>
                {u.email && <span className="text-muted-foreground/60 truncate text-[10px]">{u.email}</span>}
                <Check className="h-3 w-3 opacity-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
