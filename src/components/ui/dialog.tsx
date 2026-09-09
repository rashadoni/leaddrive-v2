"use client"

import * as React from "react"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

const openDialogStack: symbol[] = []
let bodyScrollLockCount = 0
let bodyOverflowBeforeLock = ""

interface DialogA11yContextValue {
  titleId: string
  descriptionId: string
  registerTitle: () => () => void
  registerDescription: () => () => void
}

const DialogA11yContext = React.createContext<DialogA11yContextValue | null>(null)

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest("[hidden], [aria-hidden='true']")) return false
    return element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden"
  })
}

function lockBodyScroll() {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = "hidden"
  }
  bodyScrollLockCount += 1
}

function unlockBodyScroll() {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = bodyOverflowBeforeLock
  }
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  /** Tailwind max-width for the dialog box. Defaults to the standard width;
   *  pass e.g. "max-w-5xl" for wide forms. */
  widthClassName?: string
  /** Tailwind max-height for the dialog box. Defaults to "max-h-[85vh]";
   *  pass e.g. "max-h-[92vh]" for tall forms that should avoid an inner scroll. */
  maxHeightClassName?: string
  /** Hide the corner close (×) button. Defaults to shown. */
  hideClose?: boolean
  /** Use an edge-to-edge surface on narrow screens. */
  mobileFullscreen?: boolean
  /** The breakpoint from which a mobile fullscreen surface becomes a centered dialog. */
  mobileFullscreenBreakpoint?: "sm" | "md"
}

export function Dialog({ open, onOpenChange, children, widthClassName = "max-w-[40rem]", maxHeightClassName = "max-h-[85vh]", hideClose = false, mobileFullscreen = false, mobileFullscreenBreakpoint = "sm" }: DialogProps) {
  const t = useTranslations("common")
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const previouslyFocusedElementRef = React.useRef<HTMLElement | null>(null)
  const dialogInstanceRef = React.useRef(Symbol("dialog"))
  const onOpenChangeRef = React.useRef(onOpenChange)
  const titleRegistrationCountRef = React.useRef(0)
  const descriptionRegistrationCountRef = React.useRef(0)
  const [hasTitle, setHasTitle] = React.useState(false)
  const [hasDescription, setHasDescription] = React.useState(false)
  const generatedId = React.useId()
  const titleId = `${generatedId}-title`
  const descriptionId = `${generatedId}-description`

  onOpenChangeRef.current = onOpenChange

  const registerTitle = React.useCallback(() => {
    titleRegistrationCountRef.current += 1
    setHasTitle(true)
    return () => {
      titleRegistrationCountRef.current = Math.max(0, titleRegistrationCountRef.current - 1)
      setHasTitle(titleRegistrationCountRef.current > 0)
    }
  }, [])

  const registerDescription = React.useCallback(() => {
    descriptionRegistrationCountRef.current += 1
    setHasDescription(true)
    return () => {
      descriptionRegistrationCountRef.current = Math.max(0, descriptionRegistrationCountRef.current - 1)
      setHasDescription(descriptionRegistrationCountRef.current > 0)
    }
  }, [])

  const a11yContext = React.useMemo<DialogA11yContextValue>(() => ({
    titleId,
    descriptionId,
    registerTitle,
    registerDescription,
  }), [descriptionId, registerDescription, registerTitle, titleId])

  React.useEffect(() => {
    if (!open) return

    const dialogInstance = dialogInstanceRef.current
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    openDialogStack.push(dialogInstance)
    lockBodyScroll()

    const animationFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog || openDialogStack.at(-1) !== dialogInstance) return
      if (dialog.contains(document.activeElement)) return
      const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus], [autofocus]")
        ?? getFocusableElements(dialog)[0]
        ?? dialog
      initialFocus.focus({ preventScroll: true })
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current
      if (!dialog || openDialogStack.at(-1) !== dialogInstance) return

      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onOpenChangeRef.current(false)
        return
      }

      if (event.key !== "Tab") return
      const focusableElements = getFocusableElements(dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }

      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      if (!dialog.contains(activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? lastFocusable : firstFocusable).focus({ preventScroll: true })
      } else if (event.shiftKey && (activeElement === firstFocusable || activeElement === dialog)) {
        event.preventDefault()
        lastFocusable.focus({ preventScroll: true })
      } else if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault()
        firstFocusable.focus({ preventScroll: true })
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      document.removeEventListener("keydown", handleKeyDown, true)
      const wasTopmostDialog = openDialogStack.at(-1) === dialogInstance
      const stackIndex = openDialogStack.lastIndexOf(dialogInstance)
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1)
      unlockBodyScroll()

      const previouslyFocusedElement = previouslyFocusedElementRef.current
      if (wasTopmostDialog && previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null
  const fullscreenRootClassName = !mobileFullscreen
    ? "items-center p-4"
    : mobileFullscreenBreakpoint === "md"
      ? "items-stretch p-0 md:items-center md:p-4"
      : "items-stretch p-0 sm:items-center sm:p-4"
  const fullscreenSurfaceClassName = !mobileFullscreen
    ? "rounded-lg"
    : mobileFullscreenBreakpoint === "md"
      ? "rounded-none md:rounded-lg"
      : "rounded-none sm:rounded-lg"

  return (
    <DialogA11yContext.Provider value={a11yContext}>
      <div
        className={`fixed inset-0 z-[60] flex justify-center overflow-y-auto overscroll-contain ${fullscreenRootClassName}`}
        data-dialog-root=""
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onOpenChange(false)
        }}
      >
        <div className="pointer-events-none fixed inset-0 bg-black/50" aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={hasTitle ? titleId : undefined}
          aria-describedby={hasDescription ? descriptionId : undefined}
          tabIndex={-1}
          className={`relative z-10 bg-background shadow-lg w-full ${fullscreenSurfaceClassName} ${widthClassName} ${maxHeightClassName} overflow-hidden flex flex-col outline-none [&>form]:flex [&>form]:flex-col [&>form]:flex-1 [&>form]:min-h-0 [&>form]:overflow-hidden`}
        >
          {!hideClose && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t("close")}
              className="absolute right-2 top-2 z-20 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {children}
        </div>
      </div>
    </DialogA11yContext.Provider>
  )
}

export function DialogContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 overflow-y-auto flex-1 ${className}`}>{children}</div>
}

export function DialogHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 pr-16 pt-6 pb-2 ${className}`}>{children}</div>
}

export function DialogTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const context = React.useContext(DialogA11yContext)
  React.useEffect(() => context?.registerTitle(), [context])
  return <h2 id={context?.titleId} className={`text-lg font-semibold ${className}`}>{children}</h2>
}

export function DialogDescription({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const context = React.useContext(DialogA11yContext)
  React.useEffect(() => context?.registerDescription(), [context])
  return <p id={context?.descriptionId} className={`text-sm text-muted-foreground mt-1 ${className}`}>{children}</p>
}

export function DialogFooter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 pb-6 pt-3 flex justify-end gap-2 border-t flex-shrink-0 ${className}`}>{children}</div>
}
