"use client"

import { Hint, HintValue } from "@/components/hint"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { copyTextWithFallback } from "@/lib/copy-text"
import {
  LOCATION_SHARE_LINK_ALIVE_LIMIT,
  LOCATION_SHARE_LINK_DURATIONS,
  isLocationShareLinkEndOfDay,
  type LocationShareLinkDuration,
} from "@/lib/mtm/location-share-link"
import {
  aliveLiveMapShareLinks,
  isLiveMapShareLinkOutOfTime,
  liveMapShareLinkProblem,
  liveMapShareLinkWhatsAppUrl,
  parseCreatedLiveMapShareLink,
  parseLiveMapShareLinks,
  pastLiveMapShareLinks,
  withLiveMapShareLink,
  withRevokedLiveMapShareLink,
  withoutLiveMapShareLink,
  type LiveMapShareLink,
  type LiveMapShareLinksAnswer,
  type LiveMapShareLinkProblem,
} from "@/lib/mtm/live-map-share-links"

// The pill of the card's own «История за день / Только он / Следить» row.
const PILL = "inline-flex min-h-8 items-center rounded-full border border-border px-2.5 text-[11px] font-medium text-foreground hover:bg-muted aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-11"
// The worded action of a row, as in the list of zones.
const ACTION = "inline-flex min-h-8 shrink-0 items-center text-[11px] font-semibold underline underline-offset-2 aria-disabled:cursor-default aria-disabled:opacity-60 [@media(pointer:coarse)]:min-h-11"
// The ways a new link leaves the card: «Отправить в WhatsApp» is the first of them, the other two stand under it.
const SEND = "inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-xs font-semibold [@media(pointer:coarse)]:min-h-11"
const SEND_OTHER = `${SEND} flex-1 border border-border bg-background text-foreground hover:bg-muted`
// The two answers to «Отозвать ссылку?».
const ANSWER = "inline-flex min-h-8 items-center rounded-lg px-2.5 text-[11px] font-semibold aria-disabled:cursor-default aria-disabled:opacity-60 [@media(pointer:coarse)]:min-h-11"
/** How long «Скопировано» stands on the button before it reads «Скопировать» again. */
const COPIED_MS = 2_000
/** A press on one of the three buttons this soon after a link was made is the same press twice. */
const DOUBLE_PRESS_MS = 1_000
const FRESH_LIMIT = 30

/**
 * A link made in this tab, with the one thing only its creation said: the
 * link itself. The server keeps a hash and can never say it again.
 */
interface FreshLink {
  agentId: string
  link: LiveMapShareLink
  url: string
  /**
   * It has left this card: «Отправить в WhatsApp», «Поделиться» or
   * «Скопировать» was pressed on it here, and it worked. With two links made
   * one after another — the same hour, the same author, neither opened yet —
   * this is the only thing that tells the one that was sent from the spare.
   */
  copied: boolean
}

// A folded block is not rendered at all, and selecting another employee
// takes this one's card away: without this the manager who glanced aside
// before copying would be left with a working link he can never see again.
// It lives as long as the tab does — a reload forgets it, as the block says.
const freshLinks = new Map<string, FreshLink>()
// Every creation and revocation that came back, for the whole tab. A read of
// the list that was already on its way when one of them landed describes the
// moment before it: applied, it would take a link just made off the screen —
// and its address with it. Such an answer is dropped and the list asked again.
const writes = { landed: 0 }

function writeLanded(): void {
  writes.landed += 1
}

export function resetLiveMapShareLinkCacheForTests(): void {
  freshLinks.clear()
  writes.landed = 0
}

function rememberFreshLink(entry: FreshLink): void {
  freshLinks.delete(entry.link.id)
  freshLinks.set(entry.link.id, entry)
  // The oldest goes first: a tab left open for a week does not keep every link ever made in it.
  for (const id of freshLinks.keys()) {
    if (freshLinks.size <= FRESH_LIMIT) break
    freshLinks.delete(id)
  }
}

// Whether this browser has a «Поделиться» of its own (a phone's sheet with every
// messenger and SMS on it) is a fact of the device: nothing to subscribe to.
const subscribeToNothing = () => () => {}
const browserCanShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function"
const serverCannotShare = () => false

/**
 * Selects the whole link and keeps its beginning in view. Left to itself the
 * narrow field scrolls to the end of what was selected — the tail of the
 * token — and the manager no longer sees what it is that he is to copy.
 */
function selectLink(field: HTMLInputElement | null | undefined): void {
  if (!field) return
  field.select()
  field.scrollLeft = 0
}

/** The links made here for this employee, the newest first. */
function freshLinksOf(agentId: string): FreshLink[] {
  return [...freshLinks.values()].filter((entry) => entry.agentId === agentId).reverse()
}

/** The server's list is the truth: what it no longer names as working is forgotten, address and all. */
function forgetFreshLinksNotIn(agentId: string, links: readonly LiveMapShareLink[]): void {
  const working = new Set(aliveLiveMapShareLinks(links).map((link) => link.id))
  for (const entry of freshLinksOf(agentId)) {
    if (!working.has(entry.link.id)) freshLinks.delete(entry.link.id)
  }
}

interface BlockState {
  agentId: string
  /** The server's list; null until it has been read once. */
  answer: LiveMapShareLinksAnswer | null
  /** Why the last read of the list failed, if it did. */
  readProblem: LiveMapShareLinkProblem | null
  /** The organization has the links switched off — said by the list, or by a refused creation. */
  off: boolean
}

type Busy = { kind: "create" } | { kind: "revoke"; linkId: string }

/** Where the keyboard goes once a press has changed what is on screen. */
type FocusTarget =
  | { kind: "field" | "revoke" | "keep"; linkId: string }
  /** A link has left the working ones: the row that took its place, or whatever is left to press. */
  | { kind: "next"; position: number }

/**
 * The «Ссылка на местоположение» block of the selected employee's card: a
 * manager makes a link by which somebody outside the organization sees,
 * without signing in, where this one employee is now — and takes it back.
 *
 * The page draws the block only when the live map's own answer says the
 * organization has the links switched on and this viewer is let in to them
 * (`contract.shareLinks`); `canWrite` is that answer's word on whether he may
 * make and revoke. The list read here can only take away from it: a switch
 * turned off meanwhile, a role that changed.
 *
 * Three worded buttons make a link — an hour, four hours, until the end of
 * the day; the server decides the moment it ends. The link itself comes back
 * once, in the answer to its creation, and is shown in a field with the ways
 * to send it under it: «Отправить в WhatsApp» (WhatsApp opens with the
 * message already written; whom it goes to is chosen there), «Поделиться»
 * where the device has a sheet of its own, and «Скопировать». It is never
 * copied or sent by itself (a browser drops a copy that no press asked for),
 * and never shown again after a reload. Below are the links that work — until when, who made each, how
 * many times it was opened — each with «Отозвать»; a supervisor sees the
 * same list and no button.
 *
 * «Отозвать» asks once more, in the row itself: a revoked link cannot be
 * brought back — whoever has it sees «больше не работает», and a new one has
 * to be made and sent. In the row and not in a dialog: the card may be beside
 * a map in full screen.
 *
 * Everything the server refuses is said here, in the block, in words — for
 * the same reason: there a toast is not painted.
 */
export function LiveMapAgentShare({ agentId, agentName, canWrite, refreshKey, nowMs, timeZone, formatTime, formatPastTime }: {
  agentId: string
  /** Whose position the link shows: the message that is sent with the link names him. */
  agentName: string
  /** The live map's contract about this viewer: may he make and revoke a link. */
  canWrite: boolean
  /** Changes when the list is to be read again; not on every refresh of the map. */
  refreshKey: string
  /**
   * The page's clock, as the rest of the card counts by it: the server's
   * moment plus the time since. A link whose time has run out by it is not
   * left among the working ones until the list happens to be read again.
   */
  nowMs: number
  /** The organization's zone: a link that ends with the organization's day says «до конца дня», not «до 00:00». */
  timeZone?: string
  /** A moment of today, as a clock: a link never outlives the organization's day. */
  formatTime: (iso: string) => string
  /** A moment that may be days old — for links that no longer work: give one that adds the date when it is not today. */
  formatPastTime: (iso: string) => string
}) {
  // Named `t` so that the catalog gate (lib-i18n-keys.test.ts) follows every key below.
  const t = useTranslations("mtmMap")
  const [state, setState] = useState<BlockState | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [notice, setNotice] = useState<{ agentId: string; problem: LiveMapShareLinkProblem } | null>(null)
  const [copy, setCopy] = useState<{ linkId: string; result: "copied" | "failed" } | null>(null)
  /** The link whose «Отозвать» was pressed once and is waiting for the answer to «Отозвать ссылку?». */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** The working links the page's clock has already called out of time, and the list was read again for. */
  const [rereadFor, setRereadFor] = useState("")
  const createLabelId = useId()
  const block = useRef<HTMLDivElement>(null)
  const fields = useRef(new Map<string, HTMLInputElement>())
  const focusNext = useRef<FocusTarget | null>(null)
  /** A link was made a moment ago: for that moment the three buttons take no press. */
  const [justMade, setJustMade] = useState(false)
  const canShare = useSyncExternalStore(subscribeToNothing, browserCanShare, serverCannotShare)
  /** Counts the times a link left the card: the mark «вы уже отправили» is read from the tab's memory, and this draws it. */
  const [, setSentTurn] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const writesWhenAsked = writes.landed
    const keep = (readProblem: LiveMapShareLinkProblem) => setState((previous) => {
      // What was read before stays on screen, with a word that it is not fresh.
      const known = previous?.agentId === agentId ? previous : null
      return { agentId, answer: known?.answer ?? null, off: known?.off ?? false, readProblem }
    })
    void fetch(`/api/v1/mtm/locations/share-links?agentId=${encodeURIComponent(agentId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { success?: unknown; code?: unknown; data?: unknown } | null
        if (controller.signal.aborted) return
        if (writes.landed !== writesWhenAsked) {
          setAttempt((count) => count + 1)
          return
        }
        const said = response.ok && body?.success === true
        const answer = said ? parseLiveMapShareLinks(body?.data) : null
        if (!answer) return keep(said ? "failed" : liveMapShareLinkProblem("list", response.status, body?.code))
        forgetFreshLinksNotIn(agentId, answer.links)
        setState({ agentId, answer, readProblem: null, off: !answer.enabled })
      })
      .catch(() => {
        if (!controller.signal.aborted) keep("network")
      })
    return () => controller.abort()
  }, [agentId, refreshKey, attempt])

  // «Скопировано» is an answer to the press, not a state of the link.
  useEffect(() => {
    if (copy?.result !== "copied") return
    const timer = setTimeout(() => setCopy(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copy])

  // A double click: its second press arrives when the first link is already
  // there, and would make another one nobody asked for.
  useEffect(() => {
    if (!justMade) return
    const timer = setTimeout(() => setJustMade(false), DOUBLE_PRESS_MS)
    return () => clearTimeout(timer)
  }, [justMade])

  // A press that takes its own control off the screen — the three buttons
  // giving way to the limit, «Отозвать» to its question, a revoked row
  // leaving the list — would drop the keyboard to the top of the page. It is
  // put where the press led instead: the new link's field, the answer to the
  // question, the row that took the place of the one that went.
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    const root = block.current
    if (!root) return
    // Only a keyboard that is still here, or was dropped by the control going
    // away: somebody who has clicked elsewhere meanwhile is not pulled back.
    const active = document.activeElement
    if (active && active !== document.body && !root.contains(active)) return
    const of = (attribute: string) => [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    let element: HTMLElement | null | undefined
    if (target.kind === "field") element = fields.current.get(target.linkId)
    else if (target.kind === "next") {
      const rows = of("data-share-revoke")
      element = rows[Math.min(target.position, rows.length - 1)] ?? of("data-share-create")[0] ?? root
    } else {
      const attribute = target.kind === "keep" ? "data-share-keep" : "data-share-revoke"
      element = of(attribute).find((candidate) => candidate.getAttribute(attribute) === target.linkId)
    }
    element?.focus()
  })

  const known = state?.agentId === agentId ? state : null
  const answer = known?.answer ?? null
  // The list can only narrow what the map's contract allowed.
  const mayWrite = canWrite && (answer ? answer.canWrite : true)
  // Until the list has been read, the links made in this tab are what is known.
  const links = answer ? answer.links : mayWrite ? freshLinksOf(agentId).map((entry) => entry.link) : []
  const alive = aliveLiveMapShareLinks(links, nowMs)
  const past = pastLiveMapShareLinks(links, nowMs)
  // A link has just run out of time by the page's clock: the list is read
  // again — once for each such link — and the server says the same or
  // corrects the page. Noticed here, while rendering: that clock arrives as a
  // prop, and this is how a component adjusts its own state to one.
  const outOfTime = links.filter((link) => isLiveMapShareLinkOutOfTime(link, nowMs)).map((link) => link.id).join(",")
  if (outOfTime !== rereadFor) {
    setRereadFor(outOfTime)
    if (outOfTime) setAttempt((count) => count + 1)
  }
  const off = known?.off === true
  const readProblem = known?.readProblem ?? null
  const writeProblem = notice?.agentId === agentId ? notice.problem : null
  const limit = LOCATION_SHARE_LINK_ALIVE_LIMIT
  // A button the server is known to refuse is not drawn; why is said instead.
  const mayCreate = mayWrite && !off && readProblem !== "agentGone"
  const atLimit = alive.length >= limit
  // The server's own word, by the rule of the outsider's page. Said only on
  // an explicit «no»: an answer that does not say is not read as either.
  const showsNothingNow = !off && answer?.showsNow === false
  // Once the list itself shows the limit, its own line says so: not twice.
  const shownProblem = writeProblem === "limit" && mayCreate && atLimit ? null : writeProblem

  /**
   * Puts what a write gave back into the list in hand. The answer belongs to
   * the employee it was asked about: if the card has moved on to another one
   * meanwhile, his list is left alone.
   */
  const change = (apply: (links: LiveMapShareLink[]) => LiveMapShareLink[], switchedOff = false) => setState((previous) => {
    if (!previous) return switchedOff ? { agentId, answer: null, readProblem: null, off: true } : previous
    if (previous.agentId !== agentId) return previous
    return {
      ...previous,
      off: switchedOff || previous.off,
      answer: previous.answer ? { ...previous.answer, links: apply(previous.answer.links) } : null,
    }
  })

  const create = async (duration: LocationShareLinkDuration) => {
    if (busy || justMade) return
    setBusy({ kind: "create" })
    setNotice(null)
    let problem: LiveMapShareLinkProblem | null = null
    try {
      const response = await fetch("/api/v1/mtm/locations/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Which of the three buttons — never a moment: the server decides when the link ends.
        body: JSON.stringify({ agentId, duration }),
      })
      const body = await response.json().catch(() => null) as { success?: unknown; code?: unknown; data?: unknown } | null
      if (response.ok && body?.success === true) {
        writeLanded()
        setJustMade(true)
        const created = parseCreatedLiveMapShareLink(body.data, window.location.origin)
        if (created) {
          rememberFreshLink({ agentId, ...created, copied: false })
          focusNext.current = { kind: "field", linkId: created.link.id }
          change((kept) => withLiveMapShareLink(kept, created.link))
        } else {
          // Made, and the answer could not be read: the list will show it, without its address.
          problem = "failed"
          setAttempt((count) => count + 1)
        }
      } else {
        problem = liveMapShareLinkProblem("create", response.status, body?.code)
        if (problem === "off") change((kept) => kept, true)
        // The list in hand is evidently behind the server's.
        if (problem === "limit") setAttempt((count) => count + 1)
      }
    } catch {
      problem = "network"
    }
    setBusy(null)
    // «Выключены» is said by its own line for as long as it is true.
    setNotice(problem && problem !== "off" ? { agentId, problem } : null)
  }

  /** The first press: nothing is revoked yet — the row asks. */
  const askToRevoke = (link: LiveMapShareLink) => {
    if (busy) return
    focusNext.current = { kind: "keep", linkId: link.id }
    setConfirming(link.id)
  }

  /** «Не отзывать»: the row is as it was, and the keyboard is back on its «Отозвать». */
  const doNotRevoke = (link: LiveMapShareLink) => {
    if (busy) return
    focusNext.current = { kind: "revoke", linkId: link.id }
    setConfirming(null)
  }

  /** The second press. `position` is the row's place among the working links. */
  const revoke = async (link: LiveMapShareLink, position: number) => {
    if (busy) return
    setBusy({ kind: "revoke", linkId: link.id })
    setNotice(null)
    // Where the keyboard goes if the row stays: back on its «Отозвать».
    let focus: FocusTarget = { kind: "revoke", linkId: link.id }
    let problem: LiveMapShareLinkProblem | null = null
    try {
      const response = await fetch(`/api/v1/mtm/locations/share-links/${encodeURIComponent(link.id)}`, { method: "DELETE" })
      const body = await response.json().catch(() => null) as { success?: unknown; code?: unknown; data?: { revokedAt?: unknown } } | null
      if (response.ok && body?.success === true) {
        writeLanded()
        freshLinks.delete(link.id)
        focus = { kind: "next", position }
        const revokedAt = body.data?.revokedAt
        if (typeof revokedAt === "string" && Number.isFinite(Date.parse(revokedAt))) {
          change((kept) => withRevokedLiveMapShareLink(kept, link.id, revokedAt))
        } else {
          change((kept) => withoutLiveMapShareLink(kept, link.id))
          setAttempt((count) => count + 1)
        }
      } else {
        problem = liveMapShareLinkProblem("revoke", response.status, body?.code)
        if (problem === "linkGone") {
          // Somebody else stopped it first. It is not this viewer's to revoke any more.
          writeLanded()
          freshLinks.delete(link.id)
          focus = { kind: "next", position }
          change((kept) => withoutLiveMapShareLink(kept, link.id))
          setAttempt((count) => count + 1)
        }
      }
    } catch {
      problem = "network"
    }
    focusNext.current = focus
    setConfirming(null)
    setBusy(null)
    setNotice(problem ? { agentId, problem } : null)
  }

  /**
   * The link has left this card by one of its three ways. Kept with the
   * address — it comes back with it when the block is unfolded again — and
   * so not in state: the row is asked to draw again.
   */
  const markSent = (linkId: string) => {
    const fresh = freshLinks.get(linkId)
    if (fresh) freshLinks.set(linkId, { ...fresh, copied: true })
    setSentTurn((turn) => turn + 1)
  }

  const copyLink = async (linkId: string, url: string) => {
    const copied = await copyTextWithFallback(url)
    if (copied) markSent(linkId)
    setCopy({ linkId, result: copied ? "copied" : "failed" })
    // Left to do it by hand, the manager finds the link already selected.
    if (!copied) selectLink(fields.current.get(linkId))
  }

  /** What goes to the client with the link: one line that says whose position it is. */
  const messageOf = (url: string) => t("share.message", { name: agentName, url })

  /** The device's own «Поделиться»: its sheet has WhatsApp, Telegram, SMS — whatever the phone has. */
  const shareLink = async (linkId: string, url: string) => {
    try {
      await navigator.share({ text: messageOf(url) })
      markSent(linkId)
      setCopy(null)
    } catch (error) {
      // The sheet was closed without choosing: nothing went wrong, nothing was sent.
      if (error instanceof DOMException && error.name === "AbortError") return
      setCopy({ linkId, result: "failed" })
      selectLink(fields.current.get(linkId))
    }
  }

  /** «Отправить в WhatsApp» opens WhatsApp in a tab of its own; the card stays as it is. */
  const sentToWhatsApp = (linkId: string) => {
    markSent(linkId)
    // «Не удалось скопировать» said of an earlier press is no longer the last word about this link.
    setCopy((previous) => (previous?.result === "failed" ? null : previous))
  }

  const openings = (link: LiveMapShareLink) => (link.viewCount > 0
    ? [t("share.opened", { count: link.viewCount }), link.lastViewedAt ? t("share.lastOpened", { time: formatTime(link.lastViewedAt) }) : null].filter(Boolean).join(" · ")
    : t("share.notOpened"))
  // Every link ends with the organization's day at the latest; said as a clock that moment reads «до 00:00».
  const untilOf = (link: LiveMapShareLink) => (timeZone && isLocationShareLinkEndOfDay(new Date(link.expiresAt), timeZone)
    ? t("share.validUntilEndOfDay")
    : t("share.validUntil", { time: formatTime(link.expiresAt) }))

  /** Who made it and whether it was opened — one quiet line under «Действует до…». */
  const factsOf = (link: LiveMapShareLink) => [link.createdByName, openings(link)].filter(Boolean).join(" · ")

  return (
    // Focusable by the code alone: where the keyboard is put when a press has left nothing else of its own to stand on.
    <div ref={block} tabIndex={-1} data-testid="live-map-agent-share" className="space-y-2 outline-none">
      <p className="text-muted-foreground" data-testid="live-map-share-shows">{t("share.shows")}</p>
      {showsNothingNow ? (
        <p role="status" className="text-amber-700 dark:text-amber-300" data-testid="live-map-share-shows-nothing-now">{t("share.showsNothingNow")}</p>
      ) : null}

      {mayCreate && atLimit ? (
        <p className="text-amber-700 dark:text-amber-300" data-testid="live-map-share-limit">{t("share.errors.limit", { limit })}</p>
      ) : mayCreate ? (
        <div role="group" aria-labelledby={createLabelId} className="space-y-1.5" data-testid="live-map-share-create">
          {/* On a line of its own: beside the buttons it pushed the third of them under itself on a phone. */}
          <div id={createLabelId} className="font-medium text-foreground">{t("share.create")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {LOCATION_SHARE_LINK_DURATIONS.map((duration) => (
              <Hint key={duration} text={t("hint.shareCreate")}>
                <button
                  type="button"
                  // Not `disabled`: a button that is being pressed would drop the keyboard's focus to the page.
                  aria-disabled={busy != null}
                  onClick={() => { void create(duration) }}
                  data-share-create=""
                  data-testid={`live-map-share-create-${duration}`}
                  className={PILL}
                >
                  {t(`share.durations.${duration}`)}
                </button>
              </Hint>
            ))}
          </div>
        </div>
      ) : null}
      {busy?.kind === "create" ? (
        <p role="status" className="text-muted-foreground" data-testid="live-map-share-creating">{t("share.creating")}</p>
      ) : null}
      {off ? (
        <p role="status" className="text-amber-700 dark:text-amber-300" data-testid="live-map-share-off">{t("share.errors.off")}</p>
      ) : null}
      {shownProblem ? (
        <p role="alert" className="text-red-700 dark:text-red-400" data-testid="live-map-share-notice">{t(`share.errors.${shownProblem}`, { limit })}</p>
      ) : null}

      {/* Nothing is headed «Действующие ссылки» over nothing: with no link working, the three buttons above are the whole block. */}
      {alive.length === 0 ? (
        answer || readProblem
          ? null
          : <p className="text-muted-foreground" data-testid="live-map-share-loading">{t("share.loading")}</p>
      ) : <div data-testid="live-map-share-alive">
        <div className="font-semibold text-foreground">{t("share.aliveTitle")}</div>
        <ul className="mt-1 space-y-1">
            {alive.map((link, position) => {
              const until = untilOf(link)
              // The link itself: only for whoever may make one, and only where it was made.
              const fresh = mayWrite ? freshLinks.get(link.id) ?? null : null
              const copied = copy?.linkId === link.id ? copy.result : null
              // The same word on every row: a screen reader is also told which link it belongs to.
              const revokeLabel = [`${t("share.revoke")}: ${until}`, fresh?.copied ? t("share.copiedHere") : null].filter(Boolean).join(" · ")
              const revoking = busy?.kind === "revoke" && busy.linkId === link.id
              const questionId = `${createLabelId}-revoke-${position}`
              return (
                // The three facts on the left with «Отозвать» beside them; the new link's field under both.
                // In the page itself the field and «Скопировать» come first: «Отозвать» is not the first
                // thing the keyboard lands on in a row that was just made.
                <li key={link.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md bg-muted/50 px-2 py-1.5" data-testid={`live-map-share-link-${link.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground" data-testid="live-map-share-link-until">{until}</div>
                    <div className="break-words text-muted-foreground" data-testid="live-map-share-link-facts"><HintValue text={t("hint.shareStats")}>{factsOf(link)}</HintValue></div>
                  </div>
                  {fresh ? (
                    <div role="status" className="col-span-2 row-start-2 mt-1.5 rounded-md border border-l-4 border-border border-l-emerald-500 bg-card text-foreground dark:border-l-emerald-500 p-2" data-testid={`live-map-share-fresh-${link.id}`}>
                      <div className="font-semibold text-foreground">{t("share.ready")}</div>
                      <input
                        ref={(node) => {
                          if (node) fields.current.set(link.id, node)
                          else fields.current.delete(link.id)
                        }}
                        type="text"
                        readOnly
                        value={fresh.url}
                        aria-label={t("share.linkField")}
                        onFocus={(event) => selectLink(event.currentTarget)}
                        data-testid={`live-map-share-url-${link.id}`}
                        // 16 px on a touch screen: a smaller field makes iOS zoom the whole page on focus.
                        className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-[11px] text-muted-foreground outline-none focus:border-primary/60 focus:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-base"
                      />
                      <Hint text={t("hint.shareWhatsApp")}>
                        <a data-crm-color-role="provider"
                          href={liveMapShareLinkWhatsAppUrl(messageOf(fresh.url))}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => sentToWhatsApp(link.id)}
                          data-testid={`live-map-share-whatsapp-${link.id}`}
                          className={`${SEND} mt-1.5 w-full bg-emerald-600 text-white hover:bg-emerald-700`}
                        >
                          {t("share.sendWhatsApp")}
                        </a>
                      </Hint>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {canShare ? (
                          <Hint text={t("hint.shareOther")}>
                            <button
                              type="button"
                              onClick={() => { void shareLink(link.id, fresh.url) }}
                              data-testid={`live-map-share-share-${link.id}`}
                              className={SEND_OTHER}
                            >
                              {t("share.shareOther")}
                            </button>
                          </Hint>
                        ) : null}
                        <Hint text={t("hint.shareCopy")}>
                          <button
                            type="button"
                            onClick={() => { void copyLink(link.id, fresh.url) }}
                            data-testid={`live-map-share-copy-${link.id}`}
                            className={SEND_OTHER}
                          >
                            {copied === "copied" ? t("share.copied") : t("share.copy")}
                          </button>
                        </Hint>
                      </div>
                      {copied === "failed" ? (
                        <p role="alert" className="mt-1 text-red-700 dark:text-red-400" data-testid="live-map-share-copy-failed">{t("share.copyFailed")}</p>
                      ) : null}
                      {/* Stays after «Скопировано» has gone: of two links made in a row, this is the one that was sent. */}
                      {fresh.copied ? (
                        <p className="mt-1 font-medium text-emerald-800 dark:text-emerald-300" data-testid={`live-map-share-copied-here-${link.id}`}>{t("share.copiedHere")}</p>
                      ) : null}
                      <p className="mt-1 text-muted-foreground" data-testid="live-map-share-shown-once">{t("share.shownOnce")}</p>
                    </div>
                  ) : null}
                  {!mayWrite ? null : confirming === link.id ? (
                    <div
                      role="group"
                      aria-labelledby={questionId}
                      onKeyDown={(event) => { if (event.key === "Escape") doNotRevoke(link) }}
                      className="col-span-2 row-start-3 mt-1.5 rounded-md border border-red-200 bg-background p-2 dark:border-red-900"
                      data-testid={`live-map-share-revoke-step-${link.id}`}
                    >
                      <p id={questionId} className="font-medium text-foreground">{t("share.revokeConfirm")}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          // Not `disabled`: a button that is being pressed would drop the keyboard's focus to the page.
                          aria-disabled={busy != null}
                          onClick={() => { void revoke(link, position) }}
                          aria-label={revokeLabel}
                          data-testid={`live-map-share-revoke-confirm-${link.id}`}
                          className={`${ANSWER} bg-red-600 text-white hover:bg-red-700 aria-disabled:hover:bg-red-600`}
                        >
                          {revoking ? t("share.revoking") : t("share.revoke")}
                        </button>
                        <button
                          type="button"
                          aria-disabled={busy != null}
                          onClick={() => doNotRevoke(link)}
                          data-share-keep={link.id}
                          data-testid={`live-map-share-revoke-keep-${link.id}`}
                          className={`${ANSWER} border border-border text-foreground hover:bg-muted aria-disabled:hover:bg-transparent`}
                        >
                          {t("share.revokeCancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Hint text={t("hint.shareRevoke")}>
                      <button
                        type="button"
                        // Not `disabled`: a button that is being pressed would drop the keyboard's focus to the page.
                        aria-disabled={busy != null}
                        onClick={() => askToRevoke(link)}
                        aria-label={revokeLabel}
                        data-share-revoke={link.id}
                        data-testid={`live-map-share-revoke-${link.id}`}
                        className={`${ACTION} col-start-2 row-start-1 self-start text-red-700 dark:text-red-400`}
                      >
                        {t("share.revoke")}
                      </button>
                    </Hint>
                  )}
                </li>
              )
            })}
        </ul>
      </div>}

      {past.length > 0 ? (
        <div data-testid="live-map-share-past">
          <div className="font-semibold text-foreground">{t("share.pastTitle")}</div>
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {past.map((link) => (
              <li key={link.id} data-testid={`live-map-share-past-${link.id}`}>
                {link.revokedAt
                  ? t("share.revokedAt", { time: formatPastTime(link.revokedAt) })
                  : t("share.expiredAt", { time: formatPastTime(link.expiresAt) })}
                {/* «Ещё не открывали» would promise an opening that can no longer happen. */}
                {" · "}{link.viewCount > 0 ? t("share.opened", { count: link.viewCount }) : t("share.neverOpened")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* After both lists: it is about what he may do, not about any of the links above. */}
      {mayWrite ? null : (
        <p className="text-muted-foreground" data-testid="live-map-share-read-only">{t("share.readOnly")}</p>
      )}

      {readProblem ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-amber-700 dark:text-amber-300" data-testid="live-map-share-read-failed">
          <span>
            {readProblem === "agentGone" || readProblem === "busy" || readProblem === "session" || readProblem === "network"
              ? t(`share.errors.${readProblem}`, { limit })
              : answer ? t("share.refreshFailed") : t("share.loadFailed")}
          </span>
          <Hint text={t("hint.retry")}>
            <button type="button" onClick={() => setAttempt((count) => count + 1)} className={ACTION} data-testid="live-map-share-retry">
              {t("share.retry")}
            </button>
          </Hint>
        </p>
      ) : null}
    </div>
  )
}
