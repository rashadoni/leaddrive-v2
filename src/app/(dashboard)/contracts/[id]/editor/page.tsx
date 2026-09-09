"use client"

/**
 * Contract Editor — Slice 1, Step 4 (+ audit-fix pass 2026-06-10).
 *
 * 3-pane shell: left outline (LIVE, click → scroll-to-heading), center TipTap
 * canvas, right Variables fill panel. Debounced autosave → PUT /body (derives
 * renderedBody + the (b) whitespace guard). Flushes the pending save on
 * navigate-away AND on pagehide; exit is gated when the last save failed.
 *
 * Audit-fix pass (critique 2026-06-10):
 *  - P0: TableKit loaded — without it ProseMirror's schema flattened <table>
 *    bodies and the first autosave minted a table-less version (silent data
 *    corruption). Link was DISABLED here until toolbar Phase 2 (same day):
 *    it is now enabled with the SHARED protocol allowlist
 *    (src/lib/clm/link-protocols — http/https/mailto) + forced
 *    rel="noopener noreferrer". The canvas-shows-what-the-server-keeps
 *    invariant holds on every link path: isAllowedUri gates autolink +
 *    paste, applyLink gates the toolbar dialog — all three (incl. the
 *    server hook) import the same predicate module.
 *  - P1: outline items are buttons (focus(pos) + scrollIntoView); exit-safety
 *    (await save on Done/back, leave-anyway dialog on failure, pagehide
 *    keepalive flush); read-only banner for terminal statuses + in-flight
 *    envelopes; Variables empty-state teaches instead of confusing; full
 *    next-intl chrome (en/ru/az); Dialog instead of window.confirm.
 *  - P2: toolbar gains Undo/Redo/HR/Code/Table, aria-pressed + role=toolbar +
 *    focus-visible rings, shortcut hints in tooltips; full-bleed geometry
 *    (-m-8 against the dashboard main padding); applyVars uses a function
 *    replacement so typed values containing "$&"/"$$" can't corrupt the body.
 */
import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { TableKit } from "@tiptap/extension-table"
import TextAlign from "@tiptap/extension-text-align"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import Typography from "@tiptap/extension-typography"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import { CharacterCount } from "@tiptap/extensions"
import { isAllowedContractLinkInput } from "@/lib/clm/link-protocols"
import {
  ArrowLeft, Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Check, Loader2, AlertCircle, FileText, MoreHorizontal, Download, Upload,
  Undo2, Redo2, Minus, SquareCode, Table as TableIcon, Lock,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Subscript as SubIcon, Superscript as SupIcon,
  RemoveFormatting, TableProperties, Link as LinkIcon, Highlighter, ImagePlus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { toast } from "sonner"
import { findResidualVars } from "@/lib/clm/residual-vars"
import { HelpButton } from "@/components/help/help-button"

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

type SaveState = "idle" | "saving" | "saved" | "error"
interface EditorMeta { title: string; contractNumber: string | null; status: string }
interface OutlineItem { level: number; text: string; pos: number }

const AUTOSAVE_MS = 1200
// Client mirror of the server's EDITABLE_STATUSES (mint-body-version.ts is
// server-only — it imports prisma — so the list is duplicated here on purpose).
const EDITABLE_STATUSES = ["draft", "pending_approval", "approved", "active", "renewing"]

// Class-based TextAlign (toolbar-expansion plan, P1#1): renderHTML emits
// `ta-<dir>` classes instead of inline style — sanitizeContractBody keeps its
// style ban intact and allowlists exactly these four classes (ta-* hook).
// parseHTML also reads legacy inline style so imported .docx bodies keep
// their alignment in the canvas instead of silently dropping it.
const ClassTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element: HTMLElement) => {
              for (const a of this.options.alignments) {
                if (element.classList.contains(`ta-${a}`)) return a
              }
              const fromStyle = element.style.textAlign
              return this.options.alignments.includes(fromStyle) ? fromStyle : this.options.defaultAlignment
            },
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.textAlign || attributes.textAlign === this.options.defaultAlignment) return {}
              return { class: `ta-${attributes.textAlign}` }
            },
          },
        },
      },
    ]
  },
})

export default function ContractEditorPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()
  const t = useTranslations("contracts.editor")
  const tc = useTranslations("contracts") // statusXxx keys (mirror of the contract page's map)

  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<EditorMeta | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [vars, setVars] = useState<string[]>([]) // unresolved {{var}} tokens
  const [values, setValues] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false) // .docx import in flight
  const [pendingImport, setPendingImport] = useState<File | null>(null) // confirm dialog
  const [leaveTo, setLeaveTo] = useState<string | null>(null) // exit-despite-failed-save dialog
  // null = editable; otherwise why the canvas is locked
  const [readOnly, setReadOnly] = useState<null | "terminal" | "envelope">(null)
  // Phase 2 link dialog (toolbar Popover): URL input state
  const [linkOpen, setLinkOpen] = useState(false)
  const [imgUploading, setImgUploading] = useState(false) // Phase 3 image upload in flight
  const [linkUrl, setLinkUrl] = useState("")

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef(false) // gate autosave until the initial content is loaded
  const dirtyRef = useRef(false) // unsaved edits pending (for the navigate-away flush)
  const fileInputRef = useRef<HTMLInputElement | null>(null) // hidden .docx picker
  const imageInputRef = useRef<HTMLInputElement | null>(null) // hidden image picker (Phase 3)
  const editorRef = useRef<Editor | null>(null) // latest editor for the pagehide handler

  const refreshOutline = useCallback((ed: Editor | null) => {
    if (!ed) return
    const items: OutlineItem[] = []
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        items.push({ level: node.attrs.level as number, text: node.textContent, pos })
      }
    })
    setOutline(items)
  }, [])

  const refreshVars = useCallback((ed: Editor | null) => {
    if (!ed) return
    setVars(findResidualVars(ed.getText()))
  }, [])

  /** Returns true when the save persisted. */
  const doSave = useCallback(
    async (html: string, keepalive = false): Promise<boolean> => {
      setSaveState("saving")
      try {
        const res = await fetch(`/api/v1/contracts/${id}/body`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyHtml: html }),
          keepalive, // survive a navigate-away flush
        })
        if (res.ok) {
          dirtyRef.current = false
          setSaveState("saved")
          return true
        }
        const j = await res.json().catch(() => ({}))
        setSaveState("error")
        if (j.code === "ENVELOPE_IN_FLIGHT") {
          // Lock the canvas — every further keystroke would 409 the same way.
          setReadOnly("envelope")
          // Stable id: the autosave loop would otherwise stack identical toasts.
          toast.error(j.error ?? t("saveFailed"), { id: "envelope-in-flight" })
        } else {
          toast.error(j.error ?? t("saveFailed"))
        }
        return false
      } catch {
        setSaveState("error")
        return false
      }
    },
    [id, t],
  )

  const scheduleSave = useCallback(
    (html: string) => {
      dirtyRef.current = true
      setSaveState("saving")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void doSave(html), AUTOSAVE_MS)
    },
    [doSave],
  )

  const editor = useEditor({
    extensions: [
      // Phase 2: link re-enabled — sanitizeContractBody now allows a[href]
      // for absolute http/https/mailto URLs and FORCES rel="noopener
      // noreferrer" server-side (the canvas mirrors the same rel). The
      // toolbar dialog + the canvas validate the same protocol allowlist, so
      // what renders is what the server keeps. openOnClick stays off while
      // editing.
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { rel: "noopener noreferrer" },
          // Codex P1: autolink/paste must mirror the server allowlist —
          // TipTap's default URI policy also accepts ftp/tel/sms/etc., which
          // the sanitizer strips on save (canvas would lie). The SHARED
          // predicate (src/lib/clm/link-protocols) is the same module the
          // server hook and applyLink use, so the three can't drift.
          isAllowedUri: (url: string) => isAllowedContractLinkInput(url).ok,
        },
      }),
      // P0: legal bodies live on tables (payment schedules, SLAs). Without a
      // table extension ProseMirror flattens them and the first autosave mints
      // a table-less version.
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: t("placeholder") }),
      // Phase 1 typeset essentials — every HTML-affecting one is paired with
      // a sanitizeContractBody allowlist delta + round-trip tests.
      ClassTextAlign.configure({ types: ["heading", "paragraph"] }),
      Subscript,
      Superscript,
      Typography, // input transforms only (—, «», …) — no sanitizer impact
      CharacterCount, // editor-only counter — no HTML output
      Highlight, // Phase 2: plain <mark> (multicolor off) — paired in sanitizer
      // Phase 3: block images — src is restricted to THIS org's
      // /uploads/contract-images/ by the upload route + server sanitizer;
      // base64 stays off so nothing bypasses the upload path.
      Image.configure({ allowBase64: false }),
    ],
    content: "",
    immediatelyRender: false, // Next.js SSR: avoid hydration mismatch
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[60vh] " +
          "[&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg " +
          "[&_table]:w-full [&_td]:border [&_th]:border [&_td]:p-1.5 [&_th]:p-1.5 [&_th]:bg-muted/50",
      },
    },
    onUpdate: ({ editor: ed }) => {
      refreshOutline(ed)
      refreshVars(ed)
      if (readyRef.current) scheduleSave(ed.getHTML())
    },
  })

  // Load the seeded editor body once.
  useEffect(() => {
    let ignore = false
    if (!editor) return
    setLoading(true)
    fetch(`/api/v1/contracts/${id}/editor`)
      .then((r) => r.json())
      .then((j) => {
        if (ignore) return
        if (j.success) {
          setMeta({ title: j.data.title, contractNumber: j.data.contractNumber, status: j.data.status })
          editor.commands.setContent(j.data.bodyHtml || "", { emitUpdate: false })
          refreshOutline(editor)
          refreshVars(editor)
          readyRef.current = true
          // Truthful idle state: the canvas now equals the server's body.
          setSaveState("saved")
          if (!EDITABLE_STATUSES.includes(j.data.status)) setReadOnly("terminal")
        } else {
          toast.error(j.error ?? t("loadFailed"))
        }
        setLoading(false)
      })
      .catch(() => {
        if (!ignore) {
          toast.error(t("loadFailed"))
          setLoading(false)
        }
      })
    return () => {
      ignore = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [id, editor, refreshOutline, refreshVars, t])

  // Keep the canvas locked while read-only or mid-import (an autosave PUT
  // racing the import POST + reload would interleave two bodies).
  useEffect(() => {
    if (!editor) return
    editor.setEditable(readOnly === null && !importing)
  }, [editor, readOnly, importing])

  // Browser-tab title — lawyers live in multi-tab; "LeadDrive" × 6 is useless.
  useEffect(() => {
    if (meta) document.title = `${meta.contractNumber || meta.title} — LeadDrive`
  }, [meta])

  // pagehide flush: tab close / hard navigation inside the debounce window
  // must not drop the last keystroke batch. keepalive lets the PUT outlive
  // the document.
  useEffect(() => {
    editorRef.current = editor
  }, [editor])
  useEffect(() => {
    const onPageHide = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const ed = editorRef.current
      if (dirtyRef.current && ed) void doSave(ed.getHTML(), true)
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [doSave])

  // Exit: AWAIT the pending save; on failure keep the user here and offer an
  // explicit "leave anyway" — Done must never silently discard edits.
  const exitTo = useCallback(
    async (path: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (dirtyRef.current && editor && readOnly === null) {
        const ok = await doSave(editor.getHTML())
        if (!ok) {
          setLeaveTo(path)
          return
        }
      }
      router.push(path)
    },
    [editor, doSave, router, readOnly],
  )

  // Fill: replace each {{var}} that has a value with the (HTML-escaped) value.
  // Function replacement — a typed value containing "$&"/"$$" must be inserted
  // literally, not expanded as a replacement pattern.
  const applyVars = useCallback(() => {
    if (!editor) return
    let html = editor.getHTML()
    const filled: string[] = []
    const missed: string[] = []
    for (const name of vars) {
      // Object.hasOwn guard: a {{__proto__}} token must read "" not Object.prototype.
      const val = (Object.hasOwn(values, name) ? values[name] : "").trim()
      if (!val) continue
      // Pattern-safe: findResidualVars constrains names to [A-Za-z_]\w* — no
      // regex metachars can reach this template (see residual-vars.ts).
      const re = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "g")
      if (re.test(html)) {
        re.lastIndex = 0
        const escaped = escapeHtml(val)
        html = html.replace(re, () => escaped)
        filled.push(name)
      } else {
        // listed (from getText) but not matchable in getHTML — e.g. the token
        // got split across inline marks. Don't clear the typed value.
        missed.push(name)
      }
    }
    if (filled.length) {
      editor.commands.setContent(html, { emitUpdate: true }) // re-scan + autosave
      setValues((v) => {
        const next = { ...v }
        for (const n of filled) delete next[n]
        return next
      })
    }
    if (missed.length) toast(t("autoFillMissed", { vars: missed.join(", ") }))
  }, [editor, vars, values, t])

  // Export: open the server-rendered PDF in a new tab; popup blockers eat
  // window.open silently, so surface that.
  const exportPdf = useCallback(() => {
    const w = window.open(`/api/v1/contracts/${id}/pdf`, "_blank", "noopener")
    if (!w) toast.error(t("pdfPopupBlocked"))
  }, [id, t])

  // Import: POST the .docx, then reload the freshly-minted body into the editor.
  // This REPLACES the current body (old version stays in history) — the Dialog
  // confirms before invoking.
  const handleImportDocx = useCallback(
    async (file: File) => {
      setImporting(true)
      try {
        const form = new FormData()
        form.append("file", file)
        const res = await fetch(`/api/v1/contracts/${id}/import-docx`, { method: "POST", body: form })
        const j = await res.json()
        if (!res.ok || !j.success) {
          toast.error(j.error ?? t("importFailed"))
          return
        }
        // Reload the minted body so the canvas reflects the import.
        const r = await fetch(`/api/v1/contracts/${id}/editor`)
        const data = await r.json()
        if (data.success && editor) {
          editor.commands.setContent(data.data.bodyHtml || "", { emitUpdate: false })
          refreshOutline(editor)
          refreshVars(editor)
          setSaveState("saved")
        }
        const warn = Array.isArray(j.data?.warnings) ? j.data.warnings.length : 0
        toast.success(
          t("importedToast", { version: j.data.versionNo }) + (warn ? t("importedWarnSuffix", { count: warn }) : ""),
        )
      } catch {
        toast.error(t("importFailed"))
      } finally {
        setImporting(false)
      }
    },
    [id, editor, refreshOutline, refreshVars, t],
  )

  // Outline → jump: focus(pos) sets the selection inside the heading and
  // scrolls the canvas to it.
  const jumpToHeading = useCallback(
    (pos: number) => {
      if (!editor) return
      editor.chain().focus(pos + 1).run()
    },
    [editor],
  )

  // Phase 2: apply the link dialog. Mirrors the SAME protocol allowlist the
  // server hook enforces (http/https/mailto, absolute only) so the canvas
  // never shows a link the sanitizer would strip on save. A bare domain gets
  // https:// prepended as a convenience; empty input unsets the link.
  const applyLink = useCallback(() => {
    if (!editor) return
    const raw = linkUrl.trim()
    if (!raw) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      setLinkOpen(false)
      return
    }
    // Shared predicate (src/lib/clm/link-protocols) — same module as the
    // server hook and isAllowedUri, so the three gates can't drift.
    const { ok, href } = isAllowedContractLinkInput(raw)
    if (!ok) {
      toast.error(t("tbLinkInvalid"))
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    setLinkOpen(false)
  }, [editor, linkUrl, t])

  // Phase 3: image upload → insert. The route stores under
  // /uploads/contract-images/<org>/ — the only src shape the sanitizer
  // keeps and the F-41 gate serves (auth + own-org check).
  const uploadImage = useCallback(async (file: File) => {
    if (!editor) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("imgTooLarge"))
      return
    }
    setImgUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/v1/contracts/upload-image", { method: "POST", body: fd })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success || !json?.url) {
        toast.error(json?.error || t("imgUploadError"))
        return
      }
      // alt = original name sans extension — it becomes "[alt]" in the
      // signed plaintext, so a meaningful name beats img-<hash>.
      const alt = file.name.replace(/\.[^.]+$/, "").slice(0, 80)
      editor.chain().focus().setImage({ src: json.url, alt }).run()
    } catch {
      toast.error(t("imgUploadError"))
    } finally {
      setImgUploading(false)
    }
  }, [editor, t])

  // Translated status label (audit P3: the badge showed the raw lowercase enum).
  // Mirrors the contract page's statusLabels map; unknown values fall back raw.
  const STATUS_KEY: Record<string, string> = {
    draft: "statusDraft", pending_approval: "statusPendingApproval", approved: "statusApproved",
    rejected: "statusRejected", cancelled: "statusCancelled", active: "statusActive",
    expired: "statusExpired", renewed: "statusRenewed", renewing: "statusRenewing", terminated: "statusTerminated",
  }
  const statusLabel = (s: string) => (STATUS_KEY[s] ? tc(STATUS_KEY[s]) : s)

  const canEdit = readOnly === null && !importing
  const tb = (active: boolean) =>
    `h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ` +
    `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ` +
    `disabled:opacity-40 disabled:pointer-events-none ${
      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
    }`

  return (
    <div className="-m-8 flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2.5 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => void exitTo(`/contracts/${id}`)} aria-label={t("backToContract")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{meta?.title ?? "…"}</h1>
            {meta && <Badge variant="secondary" className="shrink-0 text-xs">{statusLabel(meta.status)}</Badge>}
            <HelpButton slug="contract-editor" variant="icon" className="shrink-0" />
            {/* Unresolved-vars awareness on EVERY viewport (the fill pane itself is lg+) */}
            {vars.length > 0 && (
              <Badge variant="outline" className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-700">
                {t("unresolvedBadge", { count: vars.length })}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{meta?.contractNumber || "—"}</p>
        </div>

        {/* Save / import indicator */}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          {importing ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("importing")}</>
          ) : (
            <>
              {saveState === "saving" && (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("saving")}</>)}
              {saveState === "saved" && (<><Check className="h-3.5 w-3.5 text-emerald-600" /> {t("saved")}</>)}
              {saveState === "error" && (<span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3.5 w-3.5" /> {t("saveFailed")}</span>)}
            </>
          )}
        </span>

        <Button variant="default" size="sm" onClick={() => void exitTo(`/contracts/${id}`)}>
          {t("done")}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1.5">
            <PopoverClose asChild>
              <button onClick={() => void exitTo(`/contracts/${id}`)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
                <FileText className="h-4 w-4 text-muted-foreground" /> {t("openContract")}
              </button>
            </PopoverClose>
            <PopoverClose asChild>
              <button onClick={exportPdf} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors">
                <Download className="h-4 w-4 text-muted-foreground" /> {t("exportPdf")}
              </button>
            </PopoverClose>
            <PopoverClose asChild>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing || readOnly !== null}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-4 w-4 text-muted-foreground" />
                )}
                {importing ? t("importing") : t("importDocx")}
              </button>
            </PopoverClose>
          </PopoverContent>
        </Popover>

        {/* Hidden .docx picker — Import REPLACES the current body, so a Dialog confirms first. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = "" // allow re-picking the same file
            if (f) setPendingImport(f)
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) void uploadImage(f)
          }}
        />
      </div>

      {/* ── Read-only banner ── */}
      {readOnly && meta && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 shrink-0">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {readOnly === "terminal" ? t("readOnlyTerminal", { status: statusLabel(meta.status) }) : t("readOnlyEnvelope")}
        </div>
      )}

      {/* ── Toolbar ── */}
      {editor && (
        <div role="toolbar" aria-label={t("toolbarLabel")} className="flex items-center gap-1 overflow-x-auto border-b bg-muted/30 px-4 py-1.5 shrink-0">
          <button type="button" className={tb(false)} disabled={!canEdit || !editor.can().undo()} title={t("tbUndo")} aria-label={t("tbUndo")} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></button>
          <button type="button" className={tb(false)} disabled={!canEdit || !editor.can().redo()} title={t("tbRedo")} aria-label={t("tbRedo")} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive("bold"))} disabled={!canEdit} aria-pressed={editor.isActive("bold")} title={t("tbBold")} aria-label={t("tbBold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("italic"))} disabled={!canEdit} aria-pressed={editor.isActive("italic")} title={t("tbItalic")} aria-label={t("tbItalic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("underline"))} disabled={!canEdit} aria-pressed={editor.isActive("underline")} title={t("tbUnderline")} aria-label={t("tbUnderline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("strike"))} disabled={!canEdit} aria-pressed={editor.isActive("strike")} title={t("tbStrike")} aria-label={t("tbStrike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive("heading", { level: 1 }))} disabled={!canEdit} aria-pressed={editor.isActive("heading", { level: 1 })} title={t("tbH1")} aria-label={t("tbH1")} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("heading", { level: 2 }))} disabled={!canEdit} aria-pressed={editor.isActive("heading", { level: 2 })} title={t("tbH2")} aria-label={t("tbH2")} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("heading", { level: 3 }))} disabled={!canEdit} aria-pressed={editor.isActive("heading", { level: 3 })} title={t("tbH3")} aria-label={t("tbH3")} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive("bulletList"))} disabled={!canEdit} aria-pressed={editor.isActive("bulletList")} title={t("tbBullet")} aria-label={t("tbBullet")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("orderedList"))} disabled={!canEdit} aria-pressed={editor.isActive("orderedList")} title={t("tbOrdered")} aria-label={t("tbOrdered")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("blockquote"))} disabled={!canEdit} aria-pressed={editor.isActive("blockquote")} title={t("tbQuote")} aria-label={t("tbQuote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive("codeBlock"))} disabled={!canEdit} aria-pressed={editor.isActive("codeBlock")} title={t("tbCode")} aria-label={t("tbCode")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><SquareCode className="h-4 w-4" /></button>
          <button type="button" className={tb(false)} disabled={!canEdit} title={t("tbHr")} aria-label={t("tbHr")} onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive({ textAlign: "left" }))} disabled={!canEdit} aria-pressed={editor.isActive({ textAlign: "left" })} title={t("tbAlignLeft")} aria-label={t("tbAlignLeft")} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive({ textAlign: "center" }))} disabled={!canEdit} aria-pressed={editor.isActive({ textAlign: "center" })} title={t("tbAlignCenter")} aria-label={t("tbAlignCenter")} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive({ textAlign: "right" }))} disabled={!canEdit} aria-pressed={editor.isActive({ textAlign: "right" })} title={t("tbAlignRight")} aria-label={t("tbAlignRight")} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive({ textAlign: "justify" }))} disabled={!canEdit} aria-pressed={editor.isActive({ textAlign: "justify" })} title={t("tbAlignJustify")} aria-label={t("tbAlignJustify")} onClick={() => editor.chain().focus().setTextAlign("justify").run()}><AlignJustify className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive("subscript"))} disabled={!canEdit} aria-pressed={editor.isActive("subscript")} title={t("tbSub")} aria-label={t("tbSub")} onClick={() => editor.chain().focus().toggleSubscript().run()}><SubIcon className="h-4 w-4" /></button>
          <button type="button" className={tb(editor.isActive("superscript"))} disabled={!canEdit} aria-pressed={editor.isActive("superscript")} title={t("tbSup")} aria-label={t("tbSup")} onClick={() => editor.chain().focus().toggleSuperscript().run()}><SupIcon className="h-4 w-4" /></button>
          {/* Phase 2: link dialog — same protocol allowlist as the server hook */}
          <Popover open={linkOpen} onOpenChange={(o) => { setLinkOpen(o); if (o) setLinkUrl(editor.getAttributes("link").href ?? "") }}>
            <PopoverTrigger asChild>
              <button type="button" className={tb(editor.isActive("link"))} disabled={!canEdit} aria-pressed={editor.isActive("link")} title={t("tbLink")} aria-label={t("tbLink")}><LinkIcon className="h-4 w-4" /></button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <form onSubmit={(e) => { e.preventDefault(); applyLink() }} className="flex items-center gap-1.5">
                <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" autoFocus />
                <Button type="submit" size="sm" className="h-8 px-2 text-xs shrink-0">{t("tbLinkSet")}</Button>
                {editor.isActive("link") && (
                  <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs shrink-0" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false) }}>{t("tbLinkRemove")}</Button>
                )}
              </form>
              <p className="mt-1.5 text-[10px] text-muted-foreground">{t("tbLinkHint")}</p>
            </PopoverContent>
          </Popover>
          <button type="button" className={tb(editor.isActive("highlight"))} disabled={!canEdit} aria-pressed={editor.isActive("highlight")} title={t("tbHighlight")} aria-label={t("tbHighlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter className="h-4 w-4" /></button>
          <button type="button" className={tb(false)} disabled={!canEdit || imgUploading} title={t("tbImage")} aria-label={t("tbImage")} onClick={() => imageInputRef.current?.click()}>
            {imgUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </button>
          <button type="button" className={tb(false)} disabled={!canEdit} title={t("tbClearFmt")} aria-label={t("tbClearFmt")} onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}><RemoveFormatting className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" className={tb(editor.isActive("table"))} disabled={!canEdit} title={t("tbTable")} aria-label={t("tbTable")} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4" /></button>
          {/* Table structure menu — enabled only inside a table; pure TableKit
              commands, no new attributes → sanitizer-neutral. */}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={tb(false)} disabled={!canEdit || !editor.isActive("table")} title={t("tbTableMenu")} aria-label={t("tbTableMenu")}><TableProperties className="h-4 w-4" /></button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-1">
              {([
                ["tbRowAddAfter", () => editor.chain().focus().addRowAfter().run()],
                ["tbRowAddBefore", () => editor.chain().focus().addRowBefore().run()],
                ["tbRowDelete", () => editor.chain().focus().deleteRow().run()],
                ["tbColAddAfter", () => editor.chain().focus().addColumnAfter().run()],
                ["tbColAddBefore", () => editor.chain().focus().addColumnBefore().run()],
                ["tbColDelete", () => editor.chain().focus().deleteColumn().run()],
                ["tbHeaderRow", () => editor.chain().focus().toggleHeaderRow().run()],
                ["tbTableDelete", () => editor.chain().focus().deleteTable().run()],
              ] as const).map(([key, run]) => (
                <PopoverClose asChild key={key}>
                  <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={run}>
                    {t(key)}
                  </button>
                </PopoverClose>
              ))}
            </PopoverContent>
          </Popover>
          <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground">
            {t("wordCount", { words: editor.storage.characterCount.words(), chars: editor.storage.characterCount.characters() })}
          </span>
        </div>
      )}

      {/* ── 3-pane body ── */}
      <div className="flex min-h-0 flex-1">
        {/* Left: outline (click → scroll to heading) */}
        <aside className="hidden w-56 shrink-0 overflow-auto border-r bg-card p-3 md:block">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("outline")}</p>
          {outline.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{t("outlineEmpty")}</p>
          ) : (
            <ul className="space-y-0.5">
              {outline.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => jumpToHeading(h.pos)}
                    title={h.text || undefined}
                    className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-foreground/80 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ paddingLeft: `${(h.level - 1) * 10 + 6}px` }}
                  >
                    {h.text || "—"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Center: canvas */}
        <main className="min-w-0 flex-1 overflow-auto bg-muted/20 p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {t("loading")}</div>
          ) : (
            <div className="mx-auto max-w-3xl rounded-md border bg-card p-10 shadow-sm">
              <EditorContent editor={editor} />
            </div>
          )}
        </main>

        {/* Right: Variables (LIVE) — Versions + AI review wire in later */}
        <aside className="hidden w-72 shrink-0 overflow-auto border-l bg-card p-3 lg:block">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("variables")}</p>
            {vars.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{t("unresolvedBadge", { count: vars.length })}</Badge>
            )}
          </div>
          {vars.length === 0 ? (
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              {t("variablesEmpty", { example: "{{client_name}}" })}
            </p>
          ) : (
            <div className="space-y-2">
              {vars.map((name) => (
                <div key={name}>
                  <label className="mb-0.5 block truncate text-[11px] font-medium text-foreground/80">{name}</label>
                  <Input
                    value={Object.hasOwn(values, name) ? values[name] : ""}
                    onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                    placeholder={t("valueFor", { name })}
                    className="h-8 text-xs"
                    disabled={!canEdit}
                  />
                </div>
              ))}
              <Button size="sm" className="mt-1 w-full" onClick={applyVars} disabled={!canEdit || vars.every((n) => !(Object.hasOwn(values, n) ? values[n] : "").trim())}>
                {t("fillValues")}
              </Button>
              <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
                {t("varsBlockHint")}
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* ── Import confirm dialog (replaces window.confirm) ── */}
      <Dialog open={pendingImport !== null} onOpenChange={(o: boolean) => { if (!o) setPendingImport(null) }} widthClassName="max-w-md">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("importConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {pendingImport && t("importConfirmDesc", { file: pendingImport.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingImport(null)}>{t("cancel")}</Button>
            <Button
              size="sm"
              onClick={() => {
                const f = pendingImport
                setPendingImport(null)
                if (f) void handleImportDocx(f)
              }}
            >
              {t("importConfirmGo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Leave-despite-failed-save dialog ── */}
      <Dialog open={leaveTo !== null} onOpenChange={(o: boolean) => { if (!o) setLeaveTo(null) }} widthClassName="max-w-md">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leaveFailedTitle")}</DialogTitle>
            <DialogDescription>{t("leaveFailedDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLeaveTo(null)}>{t("stay")}</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const path = leaveTo
                setLeaveTo(null)
                if (path) router.push(path)
              }}
            >
              {t("leaveAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
