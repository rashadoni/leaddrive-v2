"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, ArrowUpRight, Check, Loader2, X } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { VOICE_STATUS_LAYER_ID } from "@/components/ai/voice-inline-status"
import {
  VoiceReceiptFieldList,
  type ReceiptValueFormatter,
} from "@/components/ai/voice-receipt-fields"
import {
  cancelVoiceReceipt,
  commitVoiceReceipt,
  voiceResultHref,
  type VoiceCommitOutcome,
} from "@/lib/ai/voice/receipt-commit"
import {
  createVoiceReceiptStore,
  fetchActiveVoiceReceipt,
  type VoiceReceipt,
  type VoiceReceiptStore,
  type VoiceReceiptStoreState,
} from "@/lib/ai/voice/receipt-store"

/**
 * The action receipt (roadmap U1.2-U1.9, U1.11-U1.13).
 *
 * This surface is the whole authorization story for a voice-driven CRM write.
 * The model can propose; only a press here executes, and the press is carried
 * to the server as a one-time proof bound to the revision and payload hash the
 * user was actually shown. A spoken "yes" is not routed here and never will be
 * — background audio can say "yes".
 *
 * Placement, one component, two shapes:
 *
 * - Desktop anchors under the assistant orb, positioned from the orb's measured
 *   rect because the orb lives in the header slot or the bottom-right corner
 *   depending on the shell (see voice-orb.tsx).
 * - Below the desktop breakpoint it becomes a bottom sheet pinned to the
 *   viewport edge. Deliberately not a full-screen modal and with no focus trap:
 *   the roadmap requires the record behind it to stay readable, because the
 *   draft is checked against that record.
 *
 * The surface owns no scrolling region. A receipt with many fields grows the
 * sheet; it does not grow a scrollbar inside it.
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

  const load = useCallback(
    async (target: VoiceReceiptStore, signal: AbortSignal) => {
      target.beginLoad()
      try {
        const data = await fetchActiveVoiceReceipt(target.voiceSessionId, signal)
        if (signal.aborted) return
        if (data === null || data === undefined) {
          target.clearReceipt()
          return
        }
        target.adopt(data)
      } catch (error: unknown) {
        if (signal.aborted) return
        const status = (error as { status?: number } | null)?.status
        target.fail(typeof status === "number" ? `http_${status}` : "network")
      }
    },
    [],
  )

  useEffect(() => {
    if (!store) return
    const controller = new AbortController()
    void load(store, controller.signal)
    return () => controller.abort()
  }, [store, load])

  useEffect(() => {
    if (!store || typeof window === "undefined") return
    // The server TTL is the authority; this only stops showing a draft the
    // server would already refuse. It never extends one.
    const timer = window.setInterval(() => store.pruneExpired(Date.now()), EXPIRY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [store])

  const reload = useCallback(() => {
    if (!store) return
    const controller = new AbortController()
    void load(store, controller.signal)
  }, [store, load])

  return { store, state, reload }
}

/**
 * The label of the button that performs the action.
 *
 * The roadmap requires the control to name the operation — "Create lead", not
 * "Confirm" — because the receipt is the last place where a wrong action can
 * be noticed, and "Confirm" tells the reader nothing about what they are
 * confirming.
 */
function confirmLabelKey(actionType: string): string {
  return `receipt.confirm.${actionType}`
}

function outcomeTone(outcome: VoiceCommitOutcome | null): string {
  if (!outcome) return ""
  if (outcome.kind === "succeeded") return "text-emerald-700 dark:text-emerald-300"
  if (outcome.kind === "rate_limited" || outcome.kind === "retriable") {
    return "text-amber-700 dark:text-amber-300"
  }
  return "text-destructive"
}

/** Outcomes the same button can be pressed for again. */
function isRetriable(outcome: VoiceCommitOutcome | null): boolean {
  return outcome?.kind === "retriable" || outcome?.kind === "rate_limited"
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
  const tFields = useTranslations("aiVoiceActions")
  const formatter = useFormatter()
  const isMobile = useIsMobileViewport()
  const { store, state, reload } = useActiveVoiceReceipt(voiceSessionId)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => () => inFlight.current?.abort(), [])

  const receipt = state?.receipt ?? null
  const outcome = state?.outcome ?? null
  const committing = state?.committing === true
  const visible = Boolean(receipt) && state?.dismissed === false
  const layout: ReceiptLayout = isMobile ? "sheet" : anchorRef ? "anchored" : "inline"
  const placement = useAnchorPlacement(anchorRef, visible && layout === "anchored")

  const confirm = useCallback(async () => {
    if (!store) return
    const current = store.getState().receipt
    if (!current || !store.claimCommit()) return
    const controller = new AbortController()
    inFlight.current = controller
    try {
      const result = await commitVoiceReceipt({
        // Exactly what is on screen. Re-deriving either value here would
        // defeat the server's check that the reviewed draft is the one
        // being executed.
        intentId: current.id,
        revision: current.revision,
        payloadHash: current.payloadHash,
        signal: controller.signal,
      })
      store.settleCommit(result)
    } catch {
      if (!controller.signal.aborted) {
        store.settleCommit({ kind: "retriable", code: "NETWORK" })
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }, [store])

  const discard = useCallback(async () => {
    if (!store) return
    const current = store.getState().receipt
    // Close first: cancelling is about the user's intent, and a slow or failed
    // network call must not keep a rejected draft on screen.
    store.dismiss()
    if (!current) return
    await cancelVoiceReceipt({ intentId: current.id, revision: current.revision }).catch(() => {})
  }, [store])

  const format: ReceiptValueFormatter = useMemo(() => ({
    empty: t("receipt.emptyValue"),
    yes: t("receipt.yes"),
    no: t("receipt.no"),
    formatDate: (iso: string) => {
      const parsed = new Date(iso)
      if (Number.isNaN(parsed.getTime())) return iso
      const midnight = parsed.getUTCHours() === 0
        && parsed.getUTCMinutes() === 0
        && parsed.getUTCSeconds() === 0
      return formatter.dateTime(
        parsed,
        midnight
          ? { year: "numeric", month: "short", day: "numeric" }
          : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
      )
    },
  }), [t, formatter])

  if (!store || !receipt || !visible) return null

  const preview = receipt.preview
  const isUpdate = preview?.operation === "update"
  const succeeded = outcome?.kind === "succeeded"

  const card = (
    <section
      role="region"
      aria-label={t("receipt.ariaLabel")}
      aria-live="polite"
      data-testid="voice-receipt-panel"
      data-layout={layout}
      data-action-type={receipt.actionType}
      data-receipt-id={receipt.id}
      data-outcome={outcome?.kind ?? "pending"}
      className={[
        "pointer-events-auto border bg-background text-foreground shadow-lg",
        layout === "sheet"
          ? "fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-x-0 border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
          : layout === "anchored"
            ? "fixed z-50 w-96 max-w-[calc(100vw-1rem)] rounded-xl"
            : "w-full max-w-md rounded-xl",
      ].join(" ")}
      style={layout === "anchored" && placement
        ? { top: placement.top, right: placement.right }
        : undefined}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">
            {t(`receipt.action.${receipt.actionType}`)}
          </h2>
          {preview?.target && (
            <p data-testid="voice-receipt-target" data-sentry-mask className="mt-0.5 truncate text-xs text-muted-foreground">
              {preview.target.label}
            </p>
          )}
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
        {preview && (
          <VoiceReceiptFieldList
            fields={preview.fields}
            isUpdate={isUpdate}
            format={format}
            label={(field) => {
              // An untranslated key must read as the field, not as a dotted
              // path: a receipt is the last line of defence and has to stay
              // legible even when a label is missing.
              const translated = tFields(`fields.${field.key}` as never)
              return translated.includes(".") ? field.key : translated
            }}
          />
        )}

        {receipt.warnings.length > 0 && !succeeded && (
          <ul data-testid="voice-receipt-warnings" className="mt-3 space-y-1">
            {receipt.warnings.map((warning, index) => (
              <li
                key={`${warning.code}-${index}`}
                data-warning-code={warning.code}
                className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-200"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">
                  {t(`receipt.warning.${warning.code}`)}
                  {warning.candidates.length > 0 && (
                    <span data-sentry-mask className="mt-0.5 block">
                      {warning.candidates.map((candidate, position) => (
                        <span key={candidate.id}>
                          {position > 0 && ", "}
                          <a
                            href={voiceResultHref(candidate.entityType, candidate.id)}
                            data-testid="voice-receipt-duplicate-candidate"
                            className="underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {candidate.label}
                          </a>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {outcome && (
          <p
            data-testid="voice-receipt-outcome"
            role={succeeded ? undefined : "alert"}
            className={`mt-3 flex items-start gap-1.5 ${outcomeTone(outcome)}`}
          >
            {succeeded && <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>
              {outcome.kind === "succeeded"
                ? t(outcome.replayed ? "receipt.result.alreadyDone" : "receipt.result.done")
                : outcome.kind === "rate_limited"
                  ? t("receipt.result.rateLimited", { seconds: outcome.retryAfterSeconds })
                  : t(`receipt.result.${outcome.kind}`)}
            </span>
          </p>
        )}

        {!succeeded && (
          <p data-testid="voice-receipt-press-notice" className="mt-3 text-muted-foreground">
            {t("receipt.pressNotice")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        {succeeded && outcome.kind === "succeeded"
          ? (
            <a
              href={voiceResultHref(outcome.entityType, outcome.entityId)}
              data-testid="voice-receipt-open-result"
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t("receipt.openResult")}
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
            </a>
          )
          : (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={committing}
              data-testid="voice-receipt-confirm"
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {committing && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {isRetriable(outcome) ? t("receipt.retry") : t(confirmLabelKey(receipt.actionType))}
            </button>
          )}

        {!succeeded && (
          <button
            type="button"
            onClick={() => void discard()}
            disabled={committing}
            data-testid="voice-receipt-cancel"
            className="inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {t("receipt.cancel")}
          </button>
        )}

        {outcome?.kind === "stale" && (
          <button
            type="button"
            onClick={() => {
              store.clearOutcome()
              reload()
            }}
            data-testid="voice-receipt-refresh"
            className="inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("receipt.refresh")}
          </button>
        )}
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

export type { VoiceReceipt }
