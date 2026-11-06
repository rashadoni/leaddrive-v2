"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Plus } from "lucide-react"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"

interface Note {
  id: string
  title: string
  content: string
  updatedAt: string
  createdBy?: { id: string; name: string } | null
}

/**
 * «Qeydlər» — the board's notes (Bordio's Notes tool). A list on the left, the
 * open note on the right; «Yadda saxla» writes, «Sil» asks first. Read-only for
 * someone who may see the board but not edit it (the API answers `canWrite`).
 * The text area grows with the text — no inner scroll.
 */
export function BoardNotesPanel({ divisionId }: { divisionId: string }) {
  const t = useTranslations("board")
  const locale = useLocale()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ title: string; content: string }>({ title: "", content: "" })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/v1/divisions/${encodeURIComponent(divisionId)}/notes`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (!alive) return
        const list = (json?.data?.notes ?? []) as Note[]
        setNotes(list)
        setCanWrite(Boolean(json?.data?.canWrite))
        setFailed(false)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [divisionId, reloadKey])

  const selected = useMemo(() => notes?.find((note) => note.id === selectedId) ?? null, [notes, selectedId])
  const isNew = selectedId === "new"
  const dirty = isNew
    ? draft.title.trim().length > 0 || draft.content.length > 0
    : !!selected && (draft.title !== selected.title || draft.content !== selected.content)
  const formatDate = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

  const open = (note: Note) => { setSelectedId(note.id); setDraft({ title: note.title, content: note.content }); setMessage(null) }
  const startNew = () => { setSelectedId("new"); setDraft({ title: "", content: "" }); setMessage(null) }

  async function save() {
    if (!dirty || saving || !draft.title.trim()) return
    setSaving(true)
    setMessage(null)
    const url = isNew
      ? `/api/v1/divisions/${encodeURIComponent(divisionId)}/notes`
      : `/api/v1/divisions/${encodeURIComponent(divisionId)}/notes/${encodeURIComponent(selectedId!)}`
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title: draft.title.trim(), content: draft.content }),
    }).catch(() => null)
    const json = res?.ok ? await res.json().catch(() => null) : null
    if (json?.data?.id) {
      setSelectedId(json.data.id)
      setDraft({ title: json.data.title, content: json.data.content })
      setMessage({ ok: true, text: t("membersSaved") })
      setReloadKey((key) => key + 1)
    } else {
      setMessage({ ok: false, text: t("changeFailed") })
    }
    setSaving(false)
  }

  async function remove() {
    if (!selected) return
    const res = await fetch(`/api/v1/divisions/${encodeURIComponent(divisionId)}/notes/${encodeURIComponent(selected.id)}`, {
      method: "DELETE", credentials: "include",
    })
    if (!res.ok) throw new Error(t("changeFailed"))
    setSelectedId(null)
    setReloadKey((key) => key + 1)
  }

  if (failed) return <p className="px-5 pt-3 text-sm text-destructive">{t("changeFailed")}</p>
  if (!notes) return <p className="px-5 pt-3 text-sm text-muted-foreground">{t("loading")}</p>

  return (
    <div className="grid gap-4 px-5 pb-8 pt-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]" data-testid="board-notes">
      <div className="flex flex-col gap-2">
        {canWrite && (
          <button type="button" data-crm-button="" onClick={startNew} className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
            <Plus className="h-4 w-4" /> {t("newNote")}
          </button>
        )}
        {notes.length === 0 && !isNew ? (
          <p className="text-sm text-muted-foreground">{t("noNotes")}</p>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => open(note)}
              className={`rounded-md border px-3 py-2 text-left ${note.id === selectedId ? "border-foreground" : ""}`}
            >
              <span className="block truncate text-sm font-medium">{note.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatDate(note.updatedAt)}{note.createdBy?.name ? ` · ${note.createdBy.name}` : ""}
              </span>
            </button>
          ))
        )}
      </div>

      {(selected || isNew) ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <input
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            readOnly={!canWrite}
            placeholder={t("noteTitle")}
            maxLength={200}
            className="w-full rounded-md border bg-background px-3 py-2 text-base font-semibold outline-none"
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
            readOnly={!canWrite}
            placeholder={t("noteText")}
            rows={Math.max(8, draft.content.split("\n").length + 1)}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none"
          />
          {canWrite && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-crm-button="default"
                onClick={save}
                disabled={!dirty || saving || !draft.title.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("membersSave")}
              </button>
              {selected && (
                <button type="button" data-crm-button="" onClick={() => setConfirmDelete(true)} className="rounded-md border px-3 py-2 text-sm text-destructive">
                  {t("deleteNote")}
                </button>
              )}
              {message && <span className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</span>}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{notes.length > 0 ? t("pickNote") : ""}</p>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={remove}
        itemName={selected?.title}
      />
    </div>
  )
}
