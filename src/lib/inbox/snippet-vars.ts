// E3.1 — variable substitution for inbox message snippets.
// A snippet body may contain {{contact.name}} / {{contact.first_name}} /
// {{contact.email}} / {{agent.name}} tokens; we resolve them at insert-time so the
// agent sees (and can still edit) the filled-in text before sending.
//
// Rules:
//  - known token, value present  → the value
//  - known token, value null/empty → "" (blank, not the literal)
//  - UNKNOWN token               → left as-is, so a typo'd {{foo}} is visible, not dropped
//  - whitespace inside braces is tolerated: "{{ contact.name }}"

export interface SnippetVarContext {
  contact?: { name?: string | null; firstName?: string | null; email?: string | null } | null
  agent?: { name?: string | null } | null
}

/** Minimal snippet shape the inbox composer needs to render + insert one. */
export interface MessageSnippetLike {
  id: string
  shortcut: string
  title: string
  body: string
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

function firstWord(s?: string | null): string | null {
  if (!s) return null
  const w = s.trim().split(/\s+/)[0]
  return w || null
}

/** Returns the resolved string for a known key (possibly null when the field is
 *  empty), or `undefined` when the key is not a recognized variable. */
function resolveVar(key: string, ctx: SnippetVarContext): string | null | undefined {
  switch (key) {
    case "contact.name":
      return ctx.contact?.name ?? null
    case "contact.first_name":
    case "contact.firstname":
      return ctx.contact?.firstName ?? firstWord(ctx.contact?.name)
    case "contact.email":
      return ctx.contact?.email ?? null
    case "agent.name":
      return ctx.agent?.name ?? null
    default:
      return undefined
  }
}

export function applySnippetVariables(body: string, ctx: SnippetVarContext = {}): string {
  if (!body) return body
  return body.replace(VAR_RE, (match, rawKey: string) => {
    const value = resolveVar(String(rawKey).toLowerCase(), ctx)
    if (value === undefined) return match // unknown token → keep literal
    return value ?? "" // known but empty → blank
  })
}

/** The variables the composer can advertise in its snippet-insert UI. */
export const SUPPORTED_SNIPPET_VARS = [
  "{{contact.name}}",
  "{{contact.first_name}}",
  "{{contact.email}}",
  "{{agent.name}}",
] as const
