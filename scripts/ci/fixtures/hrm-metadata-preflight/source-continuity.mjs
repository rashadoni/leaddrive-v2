// Retain each original whole-source checksum and independently bind the reviewed
// continuation. Unchanged sources still compare their current bytes directly.
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const continuations = {
  "./hrm-migration-metadata-preflight.sql": {
    "historical": "assignment-trigger-before.sql",
    "currentSha256": "64ad9845ba00cdd283634d68c43b19beaf38e07ec6fc1e9a9926e97a70d98660"
  },
  "./hrm-migration-metadata-preflight.test.mjs": {
    "historical": "metadata-test-before.mjs.txt",
    "currentSha256": "e6f8e62e3f70392e79d7f5af1b70568f061261a5b4a2baaf041b14d236dfffe0"
  },
  "../.github/workflows/hrm-migration-metadata-preflight.yml": {
    "historical": "metadata-workflow-before.yml.txt",
    "currentSha256": "655131b726192799f08d92f1d22c5bec2a38d19b662c0344cad1bbf65c6b8c69"
  },
  "./hrm-default-acl-inspection.test.mjs": {
    "historical": "default-acl-test-before.mjs.txt",
    "currentSha256": "9eb9f036f688f98f60a0547cc822843ed66a508d0824a38d55889b4f927b376f"
  },
  "../.github/workflows/hrm-default-acl-inspection.yml": {
    "historical": "default-acl-workflow-before.yml.txt",
    "currentSha256": "c95f583b3bbbc87ff1c741e10afc9110b93fc672f88d601cc19ea764ff89ff98"
  },
  "./hrm-loopback-acl-inspection.test.mjs": {
    "historical": "loopback-acl-test-before.mjs.txt",
    "currentSha256": "09db53ace7467e34d8c8831a289f38cb654a2ed1e38f5b18e90a5acb979b970a"
  },
  "../.github/workflows/hrm-loopback-acl-inspection.yml": {
    "historical": "loopback-acl-workflow-before.yml.txt",
    "currentSha256": "8b2241decbcd6280021930fe7aa13f508533740de2122efc903bb2a2367dfefc"
  }
}
export function assertMetadataSourceContinuity(path, historicalSha256) {
  const current = fs.readFileSync(new URL("../../../" + path, import.meta.url), "utf8")
  const continuation = continuations[path]
  if (!continuation) { assert.equal(digest(current), historicalSha256); return }
  const historical = fs.readFileSync(new URL("./" + continuation.historical, import.meta.url), "utf8")
  assert.equal(digest(historical), historicalSha256)
  assert.equal(digest(current), continuation.currentSha256)
  if (path.endsWith("preflight.sql")) {
    const before = "AND NOT t.tgisinternal AND t.tgtype=23)"
    assert.equal(historical.split(before).length, 2)
    assert.equal(current, historical.replace(before,
      "AND NOT t.tgisinternal AND t.tgtype=23\n      AND t.tgqual IS NULL AND t.tgnargs=0 AND cardinality(t.tgattr::smallint[])=0 AND t.tgconstraint=0)"))
  }
  if (path.endsWith(".yml")) {
    const production = value => { const start = value.indexOf("\n  production-"); assert.ok(start > 0); return value.slice(start) }
    assert.equal(production(current), production(historical))
  }
}
