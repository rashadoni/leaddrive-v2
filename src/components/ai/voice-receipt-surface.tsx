"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import { VOICE_STATUS_LAYER_ID } from "@/components/ai/voice-inline-status"
import {
  createVoiceReceiptStore,
  fetchActiveVoiceReceipt,
  VOICE_RECEIPT_COMMIT_ENABLED,
  type VoiceReceiptStoreState,
} from "@/lib/ai/voice/receipt-store"

/**
 * The action receipt surface (roadmap U1.2 desktop panel, U1.3 mobile sheet).
 *
 * SHADOW MODE. There is no confirm control here and no code path that writes:
 * the surface reads the caller's one active receipt and shows it for review.
 * The explicit outcome buttons are U1.8, and they are the only thing that will
 * ever be allowed to call the commit endpoint.
 *
 * Two placements, one component, because they are the same decision shown
 * where the user is already looking:
 *
 * - Desktop anchors under the assistant orb. The orb lives in the header slot
 *   or, as a fallback, in the bottom-right corner (see voice-orb.tsx), so the
 *   panel is positioned from the orb's measured rect rather than from a fixed
 *   corner — otherwise it would drift away from its own control the moment the
 *   shell changes the orb's placement.
 * - Below the desktop breakpoint it becomes a bottom sheet pinned to the edge
 *   of the viewport. Deliberately NOT a full-screen modal and with no focus
 *   trap: the roadmap requires the CRM record behind it to stay readable,
 *   because the whole point of the receipt is to check a draft against the
 *   record it will touch.
 *
 * The surface owns no scrolling region of its own. Content in this slice is a
 * few lines; U1.4 adds the fields and must keep growing the sheet rather than
 * introducing an inner scrollbar.
 */

const MOBILE_QUERY = "(max-width: 767px)"
const EXPIRY_TICK_MS = 15_000

type ReceiptLayout = "anchored" | "sheet" | "inline"

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia(MOBILE_QUERY)
    const apply = () => setIsMobile(query.matches)
    apply()
    // Safari below 14 only has the deprecated listener pair.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", apply)
      return () => query.removeEventListener("change", apply)
    }
    query.addListener(apply)
    return () => query.removeListener(apply)
  }, [])

  return isMobile
}

type AnchorPlacement = Readonly<{ layer: HTMLElement; top: number; right: number }>

/**
 * Track the orb's position. Mirrors voice-inline-status.tsx on purpose: the
 * header carries a backdrop filter and therefore its own stacking context, so
 * anything hung off the orb with `absolute` is painted under the page. The
 * shell keeps an empty layer for exactly this, and `fixed` coordinates are
 * recomputed from the anchor rect on resize and on scroll in the capture phase
 * (the orb may sit inside a scrolling container).
 */
function useAnchorPlacement(
  anchorRef: RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
): AnchorPlacement | null {
  const [placement, setPlacement] = useState<AnchorPlacement | null>(null)

  useEffect(() => {
    if (!enabled || !anchorRef) return
    const anchor = anchorRef.current
    if (!anchor || typeof window === "undefined") return

    const place = () => {
      const rect = anchor.getBoundingClientRect()
      setPlacement({
        layer: document.getElementById(VOICE_STATUS_LAYER_ID) ?? document.body,
        top: Math.round(rect.bottom + 12),
        right: Math.max(8, Math.round(window.innerWidth - rect.right)),
      })
    }
    const frame = window.requestAnimationFrame(place)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [anchorRef, enabled])

  // Coordinates from a disabled pass are never handed out; the next enabled
  // pass measures again before the panel is painted.
  return enabled ? placement : null
}

/** Load the one active receipt for this session and keep it fresh enough to trust. */
function useActiveVoiceReceipt(voiceSessionId: string | null) {
  const store = useMemo(
    () => (voiceSessionId ? createVoiceReceiptStore(voiceSessionId) : null),
    [voiceSessionId],
  )

  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : () => {}),
    [store],
  )
  const snapshot = useCallback(() => store?.getState() ?? null, [store])
  const state: VoiceReceiptStoreState | null = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    if (!store) return
    const controller = new AbortController()
    store.beginLoad()
    void fetchActiveVoiceReceipt(store.voiceSessionId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        if (data === null || data === undefined) {
          store.clearReceipt()
          return
        }
        store.adopt(data)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const status = (error as { status?: number } | null)?.status
        store.fail(typeof status === "number" ? `http_${status}` : "network")
      })
    return () => controller.abort()
  }, [store])

  useEffect(() => {
    if (!store || typeof window === "undefined") return
    // The server TTL is the authority; this only stops showing a draft the
    // server would already refuse. It never extends one.
    const timer = window.setInterval(() => store.pruneExpired(Date.now()), EXPIRY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [store])

  return { store, state }
}

export function VoiceReceiptSurface({
  voiceSessionId,
  anchorRef,
}: {
  voiceSessionId: string | null
  /** The orb container. Omit it to render the receipt in the page flow. */
  anchorRef?: RefObject<HTMLElement | null>
}) {
  const t = useTranslations("voice")
  const isMobile = useIsMobileViewport()
  const { store, state } = useActiveVoiceReceipt(voiceSessionId)

  const receipt = state?.receipt ?? null
  const visible = Boolean(receipt) && state?.dismissed === false
  const layout: ReceiptLayout = isMobile ? "sheet" : anchorRef ? "anchored" : "inline"
  const placement = useAnchorPlacement(anchorRef, visible && layout === "anchored")

  if (!store || !receipt || !visible) return null

  const actionLabel = t(`receipt.action.${receipt.actionType}`)
  const stateLabel = t(`receipt.state.${receipt.state}`)
  const fieldCount = receipt.preview?.fields.length ?? 0

  const card = (
    <section
      role="region"
      aria-label={t("receipt.ariaLabel")}
      aria-live="polite"
      data-testid="voice-receipt-panel"
      data-layout={layout}
      data-action-type={receipt.actionType}
      data-receipt-id={receipt.id}
      data-commit-enabled={String(VOICE_RECEIPT_COMMIT_ENABLED)}
      className={[
        "pointer-events-auto border bg-background text-foreground shadow-lg",
        layout === "sheet"
          ? "fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-x-0 border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
          : layout === "anchored"
            ? "fixed z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl"
            : "w-full max-w-md rounded-xl",
      ].join(" ")}
      style={layout === "anchored" && placement
        ? { top: placement.top, right: placement.right }
        : undefined}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">{actionLabel}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{stateLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => store.dismiss()}
          data-testid="voice-receipt-dismiss"
          aria-label={t("receipt.dismiss")}
          title={t("receipt.dismiss")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 pb-4 pt-3 text-xs leading-relaxed">
        <p data-testid="voice-receipt-summary" className="text-muted-foreground">
          {t("receipt.fieldsPrepared", { count: fieldCount })}
        </p>
        {receipt.warnings.length > 0 && (
          <p data-testid="voice-receipt-warning-count" className="mt-1 text-amber-700 dark:text-amber-300">
            {t("receipt.warningsPrepared", { count: receipt.warnings.length })}
          </p>
        )}
        <p data-testid="voice-receipt-shadow-notice" className="mt-2 rounded-md bg-muted px-2 py-1.5 text-muted-foreground">
          {t("receipt.shadowNotice")}
        </p>
      </div>
    </section>
  )

  if (layout === "inline") return card
  if (layout === "sheet") {
    if (typeof document === "undefined") return null
    return createPortal(card, document.getElementById(VOICE_STATUS_LAYER_ID) ?? document.body)
  }
  if (!placement) return null
  return createPortal(card, placement.layer)
}
