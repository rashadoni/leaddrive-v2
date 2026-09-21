/**
 * `{{variable}}` substitution for the messages a workflow sends.
 *
 * Until 2026-09-21 only `send_sms` substituted anything: `send_email` passed
 * the stored body straight to the mailer, so a welcome that began
 * "Hi {{firstName}}," reached real people with the braces still in it. And a
 * lead has no `firstName` field at all — only `contactName` — so even the SMS
 * path rendered that particular variable as an empty string.
 *
 * One function for every channel, so a template means the same thing however
 * it is delivered:
 *   - `{{field}}` is any scalar field of the record that fired the rule;
 *   - `{{firstName}}` falls back to the first word of the contact's name;
 *   - an unknown or empty variable becomes an empty string, never braces in a
 *     customer's inbox;
 *   - in HTML every value is escaped: record fields are written by outsiders
 *     (a lead's name arrives from a public form or a chat) and must not turn
 *     into markup in somebody's mailbox;
 *   - in a header line breaks are flattened, because the mailer refuses a
 *     subject containing them and the whole email would silently not go out.
 *
 * Only the substituted values are treated here. The stored template itself is
 * the rule author's own markup and is sent as written.
 */

/** Where the rendered text is going, which decides how a value is made safe. */
export type WorkflowTemplateTarget = "html" | "text" | "header"

const VARIABLE = /\{\{\s*(\w+)\s*\}\}/g

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function firstWord(value: unknown): string {
  return typeof value === "string" ? (value.trim().split(/\s+/)[0] ?? "") : ""
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (value instanceof Date) return String(value)
  return null
}

/** The value a template variable stands for, before it is made safe. */
export function workflowVariableValue(entity: Record<string, unknown>, key: string): string {
  const direct = scalar(entity[key])
  if (direct !== null && direct !== "") return direct
  if (key === "firstName") return firstWord(entity.contactName ?? entity.fullName ?? entity.name)
  return direct ?? ""
}

export function renderWorkflowTemplate(
  template: string,
  entity: Record<string, unknown>,
  target: WorkflowTemplateTarget,
): string {
  return template.replace(VARIABLE, (_match, key: string) => {
    const value = workflowVariableValue(entity, key)
    if (target === "html") return escapeHtml(value)
    if (target === "header") return value.replace(/[\r\n]+/g, " ")
    return value
  })
}
