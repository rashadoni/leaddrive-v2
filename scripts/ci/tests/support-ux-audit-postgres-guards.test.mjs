
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { runAuditPostgresEvidence } from "../../support-ux-audit-postgres-evidence.mjs"

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const baseline = {
  CI: "true", GITHUB_ACTIONS: "true", SUPPORT_EVIDENCE_TARGET_MODE: "ephemeral",
  SUPPORT_AUDIT_ACCEPTANCE: "ephemeral-audit-20261004-v1",
  DATABASE_URL: "postgresql://postgres:fixture-only@localhost:5432/support_ux_evidence",
  GITHUB_SHA: sha, SUPPORT_EVIDENCE_COMMIT: sha,
}
const output = path.resolve("artifacts", "support-ux", sha)
const cases = [
  ["outside CI", { CI: "false" }, "AUDIT_PG_CONTEXT"],
  ["outside Actions", { GITHUB_ACTIONS: "false" }, "AUDIT_PG_CONTEXT"],
  ["remote target", { SUPPORT_EVIDENCE_TARGET_MODE: "remote" }, "AUDIT_PG_CONTEXT"],
  ["missing confirmation", { SUPPORT_AUDIT_ACCEPTANCE: "" }, "AUDIT_PG_CONTEXT"],
  ["remote database", { DATABASE_URL: "postgresql://postgres:fixture-only@example.invalid:5432/support_ux_evidence" }, "AUDIT_PG_TARGET"],
  ["wrong database", { DATABASE_URL: "postgresql://postgres:fixture-only@localhost:5432/postgres" }, "AUDIT_PG_TARGET"],
  ["wrong principal", { DATABASE_URL: "postgresql://app:fixture-only@localhost:5432/support_ux_evidence" }, "AUDIT_PG_TARGET"],
  ["unexpected port", { DATABASE_URL: "postgresql://postgres:fixture-only@localhost:5433/support_ux_evidence" }, "AUDIT_PG_TARGET"],
  ["URL override", { DATABASE_URL: baseline.DATABASE_URL + "?schema=public" }, "AUDIT_PG_TARGET"],
  ["invalid SHA", { GITHUB_SHA: "short" }, "AUDIT_PG_SHA"],
  ["different candidate", { SUPPORT_EVIDENCE_COMMIT: "0".repeat(40) }, "AUDIT_PG_SHA"],
  ["different checkout", { GITHUB_SHA: "0".repeat(40), SUPPORT_EVIDENCE_COMMIT: "0".repeat(40) }, "AUDIT_PG_SHA"],
]
for (const [name, overrides, code] of cases) {
  test(`reject ${name} before database access`, async () => {
    const previous = Object.fromEntries(Object.keys(baseline).map(key => [key, process.env[key]]))
    let touched = false
    try {
      Object.assign(process.env, baseline, overrides)
      await assert.rejects(runAuditPostgresEvidence({
        admin: { organization: { findUnique: async () => { touched = true; throw new Error("UNEXPECTED_DATABASE_ACCESS") } } },
        outputDirectory: output,
      }), error => error.message === code)
      assert.equal(touched, false)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
}
test("reject output escape before database access", async () => {
  const previous = Object.fromEntries(Object.keys(baseline).map(key => [key, process.env[key]]))
  let touched = false
  try {
    Object.assign(process.env, baseline)
    await assert.rejects(runAuditPostgresEvidence({
      admin: { organization: { findUnique: async () => { touched = true; throw new Error("UNEXPECTED_DATABASE_ACCESS") } } },
      outputDirectory: "/tmp/unsafe-audit-output",
    }), error => error.message === "AUDIT_PG_OUTPUT")
    assert.equal(touched, false)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
