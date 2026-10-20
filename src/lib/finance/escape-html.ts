/**
 * A value from a tenant's records as text inside a finance notice — the
 * Telegram message (`parse_mode: "HTML"`) and the email body.
 *
 * Both are HTML, and a counterparty or a purpose is whatever somebody typed.
 * Until 2026-10-07 it went in as typed. Telegram refuses a whole message
 * ("can't parse entities") over a `<` that does not open one of its own tags,
 * and the notifier swallows that refusal on purpose — so the notice about
 * `Smith & Sons <Baku>` never arrived. A value that *was* a tag did worse: an
 * `<a href>` typed into a purpose became a link posted by the organization's
 * own bot. `sendEmail` sanitizes its HTML, but sanitizing keeps links and drops
 * the tags it does not know: the email carried the same link and lost `<Baku>`.
 *
 * For text between tags only: quotes are left alone, so not for an attribute.
 */
export function escapeHtml(value: string): string {
  // String(): the callers are typed, the rows behind some of them are `any`,
  // and a notice must not throw after the payment it reports has committed.
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
