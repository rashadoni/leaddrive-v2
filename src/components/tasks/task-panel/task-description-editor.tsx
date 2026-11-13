"use client"

/**
 * The description of a task with formatting, as in Bordio (Ulviyya, Zeytun,
 * 2026-11-13: «в тасках включите функцию жирный шрифт как в бордио»; mockup →
 * owner: «Да, делай»): bold, italic, underline, a numbered and a bulleted
 * list. The buttons stand on the «Description» line while the text is being
 * edited; Ctrl+B / Ctrl+I / Ctrl+U work as everywhere.
 *
 * What is stored and why there are two columns — src/lib/tasks/rich-description.ts.
 * The editor's schema has exactly the tags the server keeps, so what is seen
 * while typing is what comes back after the save.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react"
import { cn } from "@/lib/utils"
import { descriptionTextOf, plainToDescriptionHtml } from "@/lib/tasks/rich-description"

export interface DescriptionLabels { bold: string; italic: string; underline: string; numbered: string; bulleted: string }

/** How the text looks, in the editor and in the plain fallback shown while the editor loads. */
export const DESCRIPTION_TEXT_CLASSES = "min-h-[4.5rem] px-1 py-0.5 text-sm leading-6"

const EDITOR_CLASSES = cn(
  DESCRIPTION_TEXT_CLASSES,
  "rounded-md border border-transparent outline-none transition-colors",
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold",
)
// A plain description keeps its spaces when it becomes the editor's content: an indented line stays indented.
const PARSE = { preserveWhitespace: "full" } as const
// The editor keeps an empty paragraph after a closing list, to have somewhere to put the cursor. It is
// the editor's, not the author's: it is neither a change nor something to store.
const withoutTail = (html: string) => html.replace(/(?:<p><\/p>)+$/u, "") || "<p></p>"

export default function TaskDescriptionEditor({ html, text, canEdit, title, placeholder, labels, extra, onSave, onText }: {
  /** The stored formatting, or null while the description is plain text. */
  html: string | null
  text: string
  canEdit: boolean
  title: string
  placeholder: string
  labels: DescriptionLabels
  /** What else stands on the title's line (the «split the list» button). */
  extra?: ReactNode
  /** The edited description left the field: its HTML, to be cleaned and stored. */
  onSave: (html: string) => void
  /** The text as it is being typed — the panel reads its lists from it. */
  onText?: (text: string) => void
}) {
  const source = html ?? plainToDescriptionHtml(text)
  // The source last put into the editor, and that content as the editor itself writes it: «changed»
  // is asked of the second, so a description that was only looked at is never saved.
  const shown = useRef(source)
  const baseline = useRef<string | null>(null)
  const [active, setActive] = useState(false)
  // The callbacks of the render that made the editor would otherwise be the only ones it ever calls.
  const handlers = useRef({ onSave, onText })
  useEffect(() => { handlers.current = { onSave, onText } })

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      // Exactly what the server keeps (DESCRIPTION_TAGS): no headings, links, code or quotes to be lost on save.
      StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false }),
    ],
    content: source,
    parseOptions: PARSE,
    editorProps: {
      attributes: { class: cn(EDITOR_CLASSES, canEdit && "hover:border-border focus:border-border"), role: "textbox", "aria-multiline": "true", "aria-label": title, "data-testid": "task-description" },
    },
    onCreate: ({ editor: current }) => { baseline.current = withoutTail(current.getHTML()) },
    onUpdate: ({ editor: current }) => {
      // The editor's own first adjustments (the paragraph after a list) arrive here too.
      if (baseline.current === null) return
      handlers.current.onText?.(descriptionTextOf(withoutTail(current.getHTML())))
    },
    onBlur: ({ editor: current }) => {
      const next = withoutTail(current.getHTML())
      if (baseline.current === null || next === baseline.current) return
      baseline.current = next
      handlers.current.onSave(next)
    },
  })

  useEffect(() => { editor?.setEditable(canEdit) }, [editor, canEdit])
  // The description changed from outside (another person, a refused save put back). Never under the
  // hands of someone typing: what they did after the read began is theirs.
  useEffect(() => {
    if (!editor || source === shown.current) return
    if (editor.isFocused || (baseline.current !== null && withoutTail(editor.getHTML()) !== baseline.current)) return
    shown.current = source
    editor.commands.setContent(source, { emitUpdate: false, parseOptions: PARSE })
    baseline.current = withoutTail(editor.getHTML())
  }, [editor, source])

  const on = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      numbered: current?.isActive("orderedList") ?? false,
      bulleted: current?.isActive("bulletList") ?? false,
      // Read below from the editor itself; listed here so that emptying or filling the field redraws.
      empty: current?.isEmpty ?? false,
    }),
  })

  const tool = (key: keyof DescriptionLabels, icon: ReactNode, run: () => void) => (
    <button
      type="button"
      data-testid={`task-description-${key}`}
      aria-label={labels[key]}
      aria-pressed={on?.[key] ?? false}
      title={labels[key]}
      // The press must not take the cursor out of the text: the selection is what the button acts on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-muted aria-pressed:text-foreground"
    >
      {icon}
    </button>
  )

  return (
    <section
      className="border-t pt-4"
      onFocus={() => setActive(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false) }}
    >
      <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {extra}
          {canEdit && active && editor && (
            <div role="toolbar" aria-label={title} data-testid="task-description-toolbar" className="flex items-center gap-0.5">
              {tool("bold", <Bold className="h-4 w-4" aria-hidden="true" />, () => editor.chain().focus().toggleBold().run())}
              {tool("italic", <Italic className="h-4 w-4" aria-hidden="true" />, () => editor.chain().focus().toggleItalic().run())}
              {tool("underline", <Underline className="h-4 w-4" aria-hidden="true" />, () => editor.chain().focus().toggleUnderline().run())}
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              {tool("numbered", <ListOrdered className="h-4 w-4" aria-hidden="true" />, () => editor.chain().focus().toggleOrderedList().run())}
              {tool("bulleted", <List className="h-4 w-4" aria-hidden="true" />, () => editor.chain().focus().toggleBulletList().run())}
            </div>
          )}
        </div>
      </div>
      <div className="relative">
        {editor ? <EditorContent editor={editor} /> : <div className={cn(DESCRIPTION_TEXT_CLASSES, "whitespace-pre-wrap")}>{text}</div>}
        {/* Drawn over the empty field, where the first letter will stand (the field's own 1px edge and padding). */}
        {editor?.isEmpty && placeholder && (
          <span aria-hidden="true" data-testid="task-description-placeholder" className="pointer-events-none absolute left-[5px] top-[3px] text-sm leading-6 text-muted-foreground">{placeholder}</span>
        )}
      </div>
    </section>
  )
}
