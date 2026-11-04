/**
 * What the dialog stand (dialog-stand.ts) and the chain stand (chain-stand.ts)
 * share: the scenario format of dialog-scenarios.json, the dialog's events,
 * the checks of a played scenario and the report's tool line. One copy, so
 * both stands pass or fail a scenario by the same rules.
 */
import type { PhoneOrderLineInput } from "../../src/lib/voice-agent/pharmacy/phone-orders"
import type { HistorySpec, Json, StationBridge } from "./stand-crm"

export type Turn = string | { say: string; when?: { match: string; say: string }[] }
export type ToolCheck = { name: string; args?: string; label?: string }
export type ReplyCheck = { match: string; label: string }
type SavedQuantity = { spoken: string; quantity: number; label: string }
export type Scenario = {
  id: string; title: string
  /** What `history:` finds for this call's pharmacy; without it the stand's CRM has no pharmacyHistory (as before the feature). */
  history?: HistorySpec
  /** Why this scenario is expected to fail on today's line (a tool it still lacks): reported, not counted. */
  expectedFail?: string
  turns: Turn[]
  checks: { tools?: ToolCheck[]; noTools?: ToolCheck[]; reply?: ReplyCheck[]; noReply?: ReplyCheck[]; finalSave?: boolean; savedLines?: number
    /** The last save has a line whose spoken words match and whose quantity is this. */
    savedQuantity?: SavedQuantity | SavedQuantity[]
    /** Every call of the tool comes after a caller turn matching `caller` (e.g. a save only after «bəli»). */
    toolAfter?: { name: string; caller: string; label: string }[] }
}

/** `heard`: what the model got instead of the words (chain stand: Chirp's text of the spoken phrase). */
export type DialogEvent =
  | { kind: "caller"; text: string; heard?: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; args: Json; result: Json }
  | { kind: "note"; text: string }

export const nextSay = (turn: Turn, lastReply: string) => {
  if (typeof turn === "string") return turn
  return turn.when?.find((rule) => new RegExp(rule.match, "iu").test(lastReply))?.say ?? turn.say
}

export type CheckResult = { label: string; ok: boolean; detail?: string }

export async function check(scenario: Scenario, events: DialogEvent[], saves: { lines: PhoneOrderLineInput[]; final: boolean }[], bridge: StationBridge) {
  const replies = events.slice(1).filter((event): event is Extract<DialogEvent, { kind: "assistant" }> => event.kind === "assistant").map((event) => event.text)
  const tools = events.filter((event): event is Extract<DialogEvent, { kind: "tool" }> => event.kind === "tool")
  const results: CheckResult[] = []
  const toolHit = (rule: ToolCheck) => tools.some((tool) => tool.name === rule.name && (!rule.args || new RegExp(rule.args, "iu").test(JSON.stringify(tool.args))))
  for (const rule of scenario.checks.tools ?? []) results.push({ label: rule.label ?? `вызван ${rule.name}${rule.args ? ` (${rule.args})` : ""}`, ok: toolHit(rule) })
  for (const rule of scenario.checks.noTools ?? []) results.push({ label: rule.label ?? `не вызван ${rule.name}${rule.args ? ` (${rule.args})` : ""}`, ok: !toolHit(rule) })
  for (const rule of scenario.checks.reply ?? []) results.push({ label: rule.label, ok: replies.some((text) => new RegExp(rule.match, "iu").test(text)) })
  for (const rule of scenario.checks.noReply ?? []) {
    const bad = replies.find((text) => new RegExp(rule.match, "iu").test(text))
    results.push({ label: rule.label, ok: !bad, ...(bad ? { detail: bad } : {}) })
  }
  if (scenario.checks.finalSave) results.push({ label: "итоговое сохранение (final)", ok: saves.some((save) => save.final) })
  if (scenario.checks.savedLines !== undefined) {
    const last = saves.at(-1)
    const resolved = last?.lines.filter((line) => line.externalId).length ?? 0
    results.push({ label: `в последнем сохранении ${scenario.checks.savedLines} найденных строк`, ok: resolved === scenario.checks.savedLines, detail: `${resolved}` })
  }
  const wants = scenario.checks.savedQuantity
  for (const want of wants ? [wants].flat() : []) {
    const line = saves.at(-1)?.lines.find((item) => new RegExp(want.spoken, "iu").test(item.spoken))
    results.push({ label: want.label, ok: line?.quantity === want.quantity, detail: line ? `${line.quantity} ${line.unit}` : "строки нет" })
  }
  for (const rule of scenario.checks.toolAfter ?? []) {
    const yes = events.findIndex((event) => event.kind === "caller" && new RegExp(rule.caller, "iu").test(event.text))
    const early = events.findIndex((event, index) => event.kind === "tool" && event.name === rule.name && (yes < 0 || index < yes))
    // A call with an empty list saves nothing (the station refuses it): it is not "saved after yes".
    const used = events.some((event) => event.kind === "tool" && event.name === rule.name &&
      (!Array.isArray(event.args.lines) || event.args.lines.length > 0))
    results.push({ label: rule.label, ok: used && early < 0, ...(early >= 0 ? { detail: yes < 0 ? "согласия не было" : "вызван до согласия" } : !used ? { detail: "не вызван" } : {}) })
  }
  // The station's own language tests (zeytun_script, zeytun_is_english).
  const langs = await Promise.all(replies.map((text) => bridge.op<{ script: string; english: boolean }>({ op: "lang", text })))
  const english = replies.filter((_, index) => langs[index].english)
  const cyrillic = replies.filter((_, index) => langs[index].script === "cyrillic")
  results.push({ label: "ответы по-азербайджански (есть az-буквы)", ok: replies.length > 0 && langs.some((lang) => lang.script === "az") })
  results.push({ label: "нет английского", ok: !english.length, ...(english.length ? { detail: english[0] } : {}) })
  results.push({ label: "нет кириллицы", ok: !cyrillic.length, ...(cyrillic.length ? { detail: cyrillic[0] } : {}) })
  return results
}

export const quote = (text: string) => text.replace(/\s+/g, " ").replace(/\|/g, "\\|")

export function toolLine(event: Extract<DialogEvent, { kind: "tool" }>) {
  const result = event.result as { status?: string; candidates?: { name: string; promotion?: unknown }[]; candidateCount?: number; orderNumber?: string; notFound?: string[] }
  const args = event.name === "save_order_list"
    ? `${(event.args.lines as unknown[] | undefined)?.length ?? 0} строк${event.args.final ? ", final" : ""}`
    : JSON.stringify(event.args)
  let outcome = result.status ?? ""
  const history = event.result as { mode?: string; orderedAt?: string; candidates?: { name: string; ordered?: { quantity: number; unit: string }; unavailable?: boolean }[] }
  if (event.name === "search_pharmacy_catalog" && /^\s*history\s*:/iu.test(String(event.args.text ?? ""))) {
    outcome += history.orderedAt ? ` ${history.orderedAt}: ${(history.candidates ?? []).map((item) =>
      `${item.name} ${item.ordered?.quantity ?? "?"} ${item.ordered?.unit ?? ""}${item.unavailable ? " [нет в каталоге]" : ""}`).join("; ")}` : " (модель не получила историю)"
  } else if (event.name === "search_pharmacy_catalog" && result.candidates) {
    outcome = `${result.candidateCount} канд.: ${result.candidates.slice(0, 3).map((item) => `${item.name}${item.promotion ? " [акция]" : ""}`).join("; ") || "—"}`
  }
  // The seller's extras of the CRM (2026-11-04).
  const extras = event.result as { sameNamePromotion?: { name: string }; substitutes?: { name: string }[]; offer?: { name: string } }
  if (extras.sameNamePromotion) outcome += `; акция другой формы: ${extras.sameNamePromotion.name}`
  if (extras.substitutes?.length) outcome += `; аналоги: ${extras.substitutes.map((item) => item.name).join("; ")}`
  if (extras.offer) outcome += `; предложение: ${extras.offer.name}`
  if (result.notFound?.length) outcome += `, не найдено: ${result.notFound.join("; ")}`
  return `  - \`${event.name}\` ${quote(args)} → ${quote(outcome)}`
}
