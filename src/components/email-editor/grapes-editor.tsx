"use client"

/**
 * M1 — GrapesJS visual email editor wrapper.
 *
 * Loaded client-side only (no SSR). Parent components that render this
 * must use dynamic import with `ssr: false`:
 *
 *   const GrapesEditor = dynamic(() =>
 *     import("@/components/email-editor/grapes-editor").then(m => ({ default: m.GrapesEditor })),
 *     { ssr: false, loading: () => <Skeleton className="h-[520px]" /> }
 *   )
 *
 * The forwardRef handle exposes:
 *   - getOutputHtml()    → email-safe HTML string (html + inlined css)
 *   - getProjectData()   → GrapesJS JSON (for round-trip editing)
 *   - loadProjectData()  → restore saved design
 *   - setComponents()    → load raw HTML (used when picking a template preset)
 *   - clear()            → reset to blank canvas
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GrapesEditorHandle {
  /** Returns inlined-CSS HTML ready to be stored and emailed. */
  getOutputHtml: () => string
  /** Returns GrapesJS projectData JSON for re-editing later. */
  getProjectData: () => Record<string, unknown>
  /** Restore a previously saved GrapesJS projectData. */
  loadProjectData: (data: Record<string, unknown>) => void
  /** Load plain HTML as the canvas content (e.g. a template preset). */
  setComponents: (html: string) => void
  /** Reset the canvas. */
  clear: () => void
}

export interface GrapesEditorProps {
  /** Pre-load a saved design (GrapesJS projectData). */
  initialProjectData?: Record<string, unknown> | null
  /** Called whenever the user modifies the canvas. */
  onChange?: (outputHtml: string, projectData: Record<string, unknown>) => void
  /** Called once GrapesJS has finished async initialisation and is ready to receive commands. */
  onReady?: () => void
  height?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GrapesEditor = forwardRef<GrapesEditorHandle, GrapesEditorProps>(
  ({ initialProjectData, onChange, onReady, height = "520px" }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const t = useTranslations("emailEditor")

    useImperativeHandle(ref, () => ({
      getOutputHtml() {
        const e = editorRef.current
        if (!e) return ""
        // Combine HTML + CSS inline — email clients need a single HTML blob
        const html = e.getHtml() as string
        const css = e.getCss() as string
        return css
          ? `${html}\n<style>${css}</style>`
          : html
      },
      getProjectData() {
        return (editorRef.current?.getProjectData() ?? {}) as Record<string, unknown>
      },
      loadProjectData(data) {
        editorRef.current?.loadProjectData(data)
      },
      setComponents(html) {
        editorRef.current?.setComponents(html)
      },
      clear() {
        editorRef.current?.setComponents("")
      },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      let destroyed = false

      ;(async () => {
        try {
          // CSS side-effect import first (no default export; wedging it into
          // Promise.all would silently discard the slot — keep it separate).
          await import("grapesjs/dist/css/grapes.min.css")

          // Dynamic JS imports — keeps GrapesJS out of the SSR bundle
          const [{ default: grapesjs }, { default: blocksBasic }] =
            await Promise.all([
              import("grapesjs"),
              import("grapesjs-blocks-basic"),
            ])

          if (destroyed || !containerRef.current) return

          const editor = grapesjs.init({
            container: containerRef.current,
            height,
            width: "auto",
            // Disable built-in storage — we handle persistence via the form
            storageManager: false,
            // Use inline styles so the exported HTML works in email clients
            avoidInlineStyle: false,
            forceClass: false,

            plugins: [blocksBasic],
            pluginsOpts: {
              // Key by the npm package name — the official GrapesJS docs pattern
              "grapesjs-blocks-basic": {
                flexGrid: true,
                category: t("catBlocks"),
                // Disable blocks that don't make sense in email
                blocks: [
                  "text",
                  "image",
                  "video",
                  "column1",
                  "column2",
                  "column3",
                  "column3-7",
                ],
              },
            },

            // Canvas CSS — normalise the preview so it matches email rendering
            canvas: {
              styles: [
                "data:text/css,body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#F3F4F7;}*{box-sizing:border-box;}",
              ],
            },

            // Style Manager — simplified for email use-cases
            styleManager: {
              sectors: [
                {
                  name: t("styleSector"),
                  open: true,
                  properties: [
                    "color",
                    "background-color",
                    "font-size",
                    "font-weight",
                    "text-align",
                    "line-height",
                    "padding",
                    "margin",
                    "border-radius",
                    "border",
                    "width",
                    "max-width",
                  ],
                },
              ],
            },

            // Add a device manager for desktop/mobile preview
            deviceManager: {
              devices: [
                { id: "desktop", name: "Desktop", width: "" },
                { id: "mobile", name: "Mobile", width: "375px", widthMedia: "480px" },
              ],
            },
          })

          editorRef.current = editor

          // Load initial design if provided
          if (initialProjectData && Object.keys(initialProjectData).length > 0) {
            editor.loadProjectData(initialProjectData as any)
          }

          // Notify parent on every canvas change
          editor.on("update", () => {
            if (!onChange) return
            const html = editor.getHtml() as string
            const css = editor.getCss() as string
            const outputHtml = css ? `${html}\n<style>${css}</style>` : html
            onChange(outputHtml, editor.getProjectData() as Record<string, unknown>)
          })

          setLoading(false)
          onReady?.()
        } catch (err) {
          if (!destroyed) {
            console.error("[GrapesEditor] init failed:", err)
            setError(t("loadError"))
            setLoading(false)
          }
        }
      })()

      return () => {
        destroyed = true
        try {
          editorRef.current?.destroy()
        } catch {}
        editorRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (error) {
      return (
        <div
          className="flex items-center justify-center rounded-lg border border-destructive/40 bg-destructive/5 text-sm text-destructive"
          style={{ height }}
        >
          {error}
        </div>
      )
    }

    return (
      <div className="relative rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/60 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          </div>
        )}
        {/* GrapesJS mounts here */}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    )
  },
)

GrapesEditor.displayName = "GrapesEditor"
