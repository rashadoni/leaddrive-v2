"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Search } from "lucide-react"

export interface OrgUser { id: string; name: string; email?: string; avatar?: string | null }

/** Full access on one board: view, create, edit, every column move — finishing
 *  a task included, as in Bordio (2026-11-08) — comment. */
export const MEMBER_FLAGS = {
  canView: true, canEdit: true, canCreateTask: true, canComment: true,
  canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true,
  canMoveToReview: true, canMoveBack: true, canMoveToDone: true,
}

// ── Reusable member picker: search box + scrollable checkbox list ────────────
// `state` is the users-fetch lifecycle. Before it existed, a failed fetch
// (403 module gate / 500 / network) left `users` empty forever and the picker
// showed an endless "loading" row with no hint anything went wrong.
export type PickerState = "loading" | "error" | "ready"
/** `fullHeight`: the whole list in the page flow — for a page tab; a dialog keeps its short scrolling list. */
export function MemberPicker({ users, state, selected, onToggle, fullHeight = false }: { users: OrgUser[]; state: PickerState; selected: Set<string>; onToggle: (id: string) => void; fullHeight?: boolean }) {
  const t = useTranslations("board")
  const [q, setQ] = useState("")
  const filtered = useMemo(() => {
    // Tokenised match: every whitespace-separated word must appear somewhere in
    // name+email. A whole-phrase includes() made "madina agh" miss
    // "Mədinə Ağayeva <madina.aghayeva@…>" (dot between the email words, and the
    // display name spells it with Azerbaijani letters).
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return users
    return users.filter((u) => {
      const hay = `${u.name} ${u.email ?? ""}`.toLowerCase()
      return tokens.every((tok) => hay.includes(tok))
    })
  }, [users, q])
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 rounded-md border bg-background px-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchUsers")}
          className="w-full bg-transparent py-1.5 text-sm outline-none"
        />
      </div>
      <div className={fullHeight ? "rounded-md border" : "max-h-44 overflow-y-auto rounded-md border"}>
        {state === "loading" ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</p>
        ) : state === "error" ? (
          <p className="px-3 py-2 text-sm text-destructive">{t("loadUsersFailed")}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">—</p>
        ) : (
          filtered.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => onToggle(u.id)} />
              <span className="truncate">{u.name}</span>
              {u.email && <span className="ml-auto truncate text-xs text-muted-foreground">{u.email}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  )
}
