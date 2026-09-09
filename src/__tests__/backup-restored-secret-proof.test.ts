import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  encryptForTenantBound,
  resetMasterKekCache,
} from "@/lib/crypto/tenant-pii-encryption"
import { encryptToken } from "@/lib/secure-token"

const PII_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const NEXTAUTH_SECRET = "restore-proof-nextauth-secret-0123456789abcdef"
const repositoryRoot = process.cwd()
const proofScript = path.join(repositoryRoot, "scripts/backup/prove-restored-pii.mjs")

let workDir = ""

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "leaddrive-secret-proof-test-"))
  process.env.TENANT_PII_MASTER_KEY = PII_KEY
  process.env.NEXTAUTH_SECRET = NEXTAUTH_SECRET
  resetMasterKekCache()
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  delete process.env.NEXTAUTH_SECRET
  resetMasterKekCache()
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

type TokenCandidate = [
  tokenClass: string,
  purposeOne: string | null,
  purposeTwo: string | null,
  purposeThree: string | null,
  ciphertext: string,
]

function runProof(tokenCandidates: TokenCandidate[], restoredNextAuthSecret = NEXTAUTH_SECRET) {
  const orgId = "org_restore_proof"
  const piiCiphertext = encryptForTenantBound(
    orgId,
    "policy_holders",
    "fullName",
    "Recovered Person",
  )
  const appEnv = path.join(workDir, "app.env")
  writeFileSync(
    appEnv,
    `TENANT_PII_MASTER_KEY=${PII_KEY}\nNEXTAUTH_SECRET=${restoredNextAuthSecret}\n`,
    { mode: 0o600 },
  )
  const fakePsql = path.join(workDir, "psql")
  writeFileSync(
    fakePsql,
    `#!/bin/sh
case "$*" in
  *token_inventory*) printf '%s' "$FAKE_TOKEN_INVENTORY" ;;
  *token_candidates*) printf '%s' "$FAKE_TOKEN_CANDIDATES" ;;
  *) printf '%s\\n' "$FAKE_PII_ROW" ;;
esac
`,
    { mode: 0o700 },
  )
  chmodSync(fakePsql, 0o700)

  return spawnSync(process.execPath, [proofScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${workDir}:${process.env.PATH ?? ""}`,
      TENANT_PII_MASTER_KEY_FILE: appEnv,
      FAKE_PII_ROW: `policy_holders\tfullName\t${orgId}\t${piiCiphertext}`,
      FAKE_TOKEN_INVENTORY: Array.from(
        tokenCandidates.reduce((counts, [tokenClass]) => {
          counts.set(tokenClass, (counts.get(tokenClass) ?? 0) + 1)
          return counts
        }, new Map<string, number>()),
        ([tokenClass, count]) => `${JSON.stringify([tokenClass, count])}\n`,
      ).join(""),
      FAKE_TOKEN_CANDIDATES: tokenCandidates
        .map((candidate) => `${JSON.stringify(candidate)}\n`)
        .join(""),
    },
  })
}

describe("offline restored-secret semantic proof", () => {
  it("authenticates real PII and an integration token without emitting values", () => {
    const tokenCiphertext = encryptToken("provider-secret-value", "social-provider")
    const result = runProof([
      ["monitoring-provider", "social-provider:source-1", "social-provider", null, tokenCiphertext],
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("encrypted PII decrypt passed")
    expect(result.stdout).toContain("encrypted integration token decrypt passed")
    expect(result.stdout).toContain("INTEGRATION_TOKEN_DECRYPT_STATUS=passed")
    expect(result.stdout).not.toContain("Recovered Person")
    expect(result.stdout).not.toContain("provider-secret-value")
  })

  it("records an explicit not-applicable result when no supported token exists", () => {
    const result = runProof([])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      "integration token decrypt not applicable (no persisted ciphertext present)",
    )
    expect(result.stdout).toContain(
      "INTEGRATION_TOKEN_DECRYPT_STATUS=not_applicable_no_persisted_ciphertext",
    )
  })

  it("fails closed when recovered NEXTAUTH_SECRET cannot open existing ciphertext", () => {
    const tokenCiphertext = encryptToken("provider-secret-value", "social-provider")
    const result = runProof(
      [["monitoring-provider", "social-provider:source-1", "social-provider", null, tokenCiphertext]],
      "wrong-restored-nextauth-secret-0123456789abcdef",
    )

    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain("provider-secret-value")
    expect(result.stderr).not.toContain("provider-secret-value")
  })

  it("authenticates every persisted dynamic-purpose class", () => {
    const rows: TokenCandidate[] = [
      ["social-account:instagram", "oauth:instagram:page-42", null, null,
        encryptToken("meta-value", "oauth:instagram:page-42")],
      ["social-account:twitter", "oauth:twitter:@brand", "oauth:twitter", null,
        encryptToken("twitter-value", "oauth:twitter")],
      ["social-account:telegram", "oauth:telegram:@brand", "oauth:telegram", null,
        encryptToken("telegram-value", "oauth:telegram:@brand")],
      ["monitoring-search-index", "custom-search-purpose", "social-search-index:org-1", "social-search-index:source-1",
        encryptToken("search-value", "social-search-index:org-1")],
      ["google-alerts-rss", "google-alerts-rss:org-1:scenario-1", null, null,
        encryptToken("rss-value", "google-alerts-rss:org-1:scenario-1")],
      ["channel-search-index", "social-search-index:org-1", null, null,
        encryptToken("channel-value", "social-search-index:org-1")],
    ]

    const result = runProof(rows)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("6 persisted classes")
    for (const secret of ["meta-value", "twitter-value", "telegram-value", "search-value", "rss-value", "channel-value"]) {
      expect(result.stdout).not.toContain(secret)
      expect(result.stderr).not.toContain(secret)
    }
  })

  it("fails closed when an inventoried ciphertext has no derivable purpose", () => {
    const tokenCiphertext = encryptToken("orphan-value", "oauth:unknown")
    const result = runProof([
      ["social-account:__missing_platform__", null, null, null, tokenCiphertext],
    ])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("every persisted integration-token class")
    expect(result.stderr).not.toContain("orphan-value")
  })
})
