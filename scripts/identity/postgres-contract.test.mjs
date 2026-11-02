import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { admitContractTarget } from "./postgres-contract.mjs"

const target = "postgresql://postgres:disposable@127.0.0.1:5432/identity_snapshot_contract_test"
test("mutation fixture admits only the explicit CI loopback disposable database", () => {
  assert.equal(admitContractTarget(target, "true").pathname, "/identity_snapshot_contract_test")
  for (const [url, ci] of [
    [target, "false"], [target.replace("127.0.0.1", "production.example"), "true"],
    [target.replace("identity_snapshot_contract_test", "leaddrive"), "true"],
    [target.replace(":5432", ""), "true"], [`${target}?host=production.example`, "true"],
    [`${target}#unsafe`, "true"], ["not-a-url", "true"],
  ]) assert.throws(() => admitContractTarget(url, ci), /CONTRACT_TARGET_REFUSED/)
})

test("disposable fixture has no destructive reset or production tenant", async () => {
  const statements = JSON.parse(await readFile(new URL("./postgres-fixture.json", import.meta.url), "utf8"))
  assert.ok(statements.every(sql => typeof sql === "string" && !/\b(DROP|TRUNCATE|DELETE)\b/i.test(sql)))
  assert.ok(statements.some(sql => sql.includes("NOSUPERUSER NOBYPASSRLS")))
  assert.equal(statements.filter(sql => sql.includes("FORCE ROW LEVEL SECURITY")).length, 3)
})
