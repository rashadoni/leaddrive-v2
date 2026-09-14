/**
 * Maps an MTM API refusal to a key in the `mtmApiErrors` message namespace.
 *
 * The API speaks English on purpose (logs, integrations, tests match on
 * `code`). Screens used to print that `error` string as is, so a web user
 * without an employee card read "This view needs a field scope: link your
 * user to an active MTM employee card" on an Azerbaijani page — or, in the
 * route/visit/task forms, nothing at all: the agent dropdown simply stayed
 * empty. The code is the contract; the sentence is the screen's job.
 */
export type MtmApiErrorKey =
  | "fieldScopeRequired"
  | "agentOutOfScope"
  | "policyAdminRequired"
  | "policyScopeForbidden"
  | "policyReadOnly"
  | "forbidden"
  | "unauthorized"
  | "generic"

const CODE_KEYS: Record<string, MtmApiErrorKey> = {
  MTM_FIELD_SCOPE_REQUIRED: "fieldScopeRequired",
  MTM_AGENT_OUT_OF_SCOPE: "agentOutOfScope",
  MTM_POLICY_ADMIN_REQUIRED: "policyAdminRequired",
  MTM_POLICY_SCOPE_FORBIDDEN: "policyScopeForbidden",
  MTM_POLICY_READ_ONLY: "policyReadOnly",
}

export function mtmApiErrorKey(body: unknown, status?: number | null): MtmApiErrorKey {
  const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
    ? (body as { code: string }).code
    : ""
  if (code && CODE_KEYS[code]) return CODE_KEYS[code]
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  return "generic"
}
