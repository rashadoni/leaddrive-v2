#!/usr/bin/env node
/** Offline inventory only. No database, network, credential values or mutation. */
import { pathToFileURL } from "node:url"

const MAX_ROWS = 10_000
const MAX_BYTES = 5 * 1024 * 1024
const USER_KEYS = ["id", "organizationId", "phone", "isActive", "anonymized", "hasCredential"]
const AGENT_KEYS = ["id", "organizationId", "userId", "phone", "role", "status", "attendanceParticipant", "hasCredential"]
const ROLES = new Set(["AGENT", "EMPLOYEE", "SUPERVISOR", "MANAGER", "ADMIN"])
const STATUSES = new Set(["ACTIVE", "INACTIVE", "SUSPENDED"])

function invalid() { throw new Error("IDENTITY_SNAPSHOT_INVALID") }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))) invalid()
}
function identifier(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 191 || /[\x00-\x20\x7f]/.test(value)) invalid()
}
function boolean(value) { if (typeof value !== "boolean") invalid() }
function phone(value) { if (value !== null && (typeof value !== "string" || value.length > 50)) invalid() }

function validate(snapshot) {
  object(snapshot, ["schemaVersion", "users", "agents"])
  if (snapshot.schemaVersion !== 1) invalid()
  for (const [kind, keys] of [["users", USER_KEYS], ["agents", AGENT_KEYS]]) {
    const rows = snapshot[kind]
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) invalid()
    const ids = new Set()
    for (const row of rows) {
      object(row, keys)
      identifier(row.id); identifier(row.organizationId); phone(row.phone); boolean(row.hasCredential)
      // Existing tables use globally unique IDs; a repeated ID makes the export ambiguous.
      if (ids.has(row.id)) invalid()
      ids.add(row.id)
      if (kind === "users") {
        boolean(row.isActive); boolean(row.anonymized)
      } else {
        if (row.userId !== null) identifier(row.userId)
        if (!ROLES.has(row.role) || !STATUSES.has(row.status)) invalid()
        boolean(row.attendanceParticipant)
      }
    }
  }
}

/** Never infer a country from a national suffix or a bare digit string. */
function internationalPhone(value) {
  if (value === null || value.trim() === "") return null
  let normalized = value.trim().replace(/[\s()\-]/g, "")
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : undefined
}

export function auditIdentitySnapshot(snapshot) {
  validate(snapshot)
  const issues = []
  const users = new Map(snapshot.users.map((row, index) => [row.id, { row, index }]))
  const links = new Map()
  const claims = new Map()
  const userPhones = snapshot.users.map(row => internationalPhone(row.phone))
  const agentPhones = snapshot.agents.map(row => internationalPhone(row.phone))
  const add = (code, userRows = [], agentRows = []) => issues.push({ code, userRows, agentRows })
  // Proposed claims are evidence candidates, not decisions about who owns a number.
  function candidate(organizationId, normalized, person, kind, index) {
    if (!normalized) return
    const key = JSON.stringify([organizationId, normalized])
    if (!claims.has(key)) claims.set(key, new Map())
    const owners = claims.get(key)
    if (!owners.has(person)) owners.set(person, { userRows: new Set(), agentRows: new Set() })
    owners.get(person)[kind].add(index)
  }
  snapshot.users.forEach((row, index) => {
    const normalized = userPhones[index]
    if (normalized === undefined) add("PHONE_FORMAT_REVIEW", [index])
    if (row.anonymized && row.isActive) add("ANONYMIZED_ACCOUNT_ACTIVE", [index])
    if (row.isActive && !row.anonymized) candidate(row.organizationId, normalized, `u:${index}`, "userRows", index)
  })
  snapshot.agents.forEach((row, index) => {
    const normalized = agentPhones[index]
    if (normalized === undefined) add("PHONE_FORMAT_REVIEW", [], [index])
    const linked = row.userId === null ? null : users.get(row.userId)
    const sameTenant = linked?.row.organizationId === row.organizationId
    if (row.userId === null) add("ACCOUNT_LINK_REQUIRED", [], [index])
    else if (!linked) add("LINKED_ACCOUNT_MISSING", [], [index])
    else if (!sameTenant) add("CROSS_TENANT_LINK", [linked.index], [index])
    else {
      if (!links.has(linked.index)) links.set(linked.index, [])
      links.get(linked.index).push(index)
      const userPhone = userPhones[linked.index]
      if (normalized && userPhone && normalized !== userPhone) add("LINKED_PHONE_DISAGREEMENT", [linked.index], [index])
      if (row.hasCredential && linked.row.hasCredential) add("DUAL_CREDENTIAL_SOURCES", [linked.index], [index])
      if (row.status === "ACTIVE" && (!linked.row.isActive || linked.row.anonymized)) add("ACTIVE_ACTOR_ACCOUNT_DISABLED", [linked.index], [index])
    }
    if (row.role === "AGENT" && row.attendanceParticipant) add("FIELD_ROLE_ATTENDANCE_REVIEW", sameTenant ? [linked.index] : [], [index])
    if (row.status === "ACTIVE") {
      // Preserve current legacy priority when finding candidate collisions.
      const effective = normalized ?? (normalized === null && sameTenant ? userPhones[linked.index] : null)
      candidate(row.organizationId, effective, sameTenant ? `u:${linked.index}` : `a:${index}`, "agentRows", index)
      if (!effective) add("ACTIVE_ACTOR_LOGIN_PHONE_UNRESOLVED", sameTenant ? [linked.index] : [], [index])
    }
  })
  for (const [userIndex, agentIndices] of links) {
    if (agentIndices.length > 1) add("MULTIPLE_ACTORS_FOR_ACCOUNT", [userIndex], agentIndices)
  }
  for (const owners of claims.values()) {
    if (owners.size < 2) continue
    const userRows = new Set(), agentRows = new Set()
    for (const owner of owners.values()) {
      for (const index of owner.userRows) userRows.add(index)
      for (const index of owner.agentRows) agentRows.add(index)
    }
    add("PHONE_CLAIM_CONFLICT", [...userRows].sort((a, b) => a - b), [...agentRows].sort((a, b) => a - b))
  }
  const counts = {}
  for (const issue of issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1
  return {
    schemaVersion: 1,
    status: issues.length ? "REVIEW_REQUIRED" : "NO_DETECTED_CONFLICTS",
    productionVerified: false,
    migrationAuthorized: false,
    coverage: "SUPPLIED_SNAPSHOT_ONLY",
    summary: { users: snapshot.users.length, agents: snapshot.agents.length, issues: issues.length, counts },
    issues,
  }
}

async function main() {
  // No filename arguments: avoid accidentally printing a sensitive pathname.
  if (process.argv.length !== 2) invalid()
  const chunks = []
  let bytes = 0
  const timer = setTimeout(() => process.stdin.destroy(new Error("IDENTITY_SNAPSHOT_TIMEOUT")), 30_000)
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > MAX_BYTES) invalid()
      chunks.push(chunk)
    }
    const snapshot = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    const result = auditIdentitySnapshot(snapshot)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.status === "REVIEW_REQUIRED" ? 2 : 0
  } finally { clearTimeout(timer) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Parser messages, payloads, identifiers and phone numbers must never escape.
    process.stderr.write("IDENTITY_SNAPSHOT_INVALID_OR_UNREADABLE\n")
    process.exitCode = 1
  })
}
