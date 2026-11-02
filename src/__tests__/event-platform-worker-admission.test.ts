import { describe, expect, it, vi } from "vitest"
import { validateFundShadowScope } from "../lib/event-platform/fund-shadow-consumer"
import { KafkaWorkerPlanError, validateKafkaWorkerPlan, type KafkaWorkerPlanExpected } from "../lib/event-platform/worker-admission"

const expected = { releaseSha: "a".repeat(40), artifactSha256: `sha256:${"b".repeat(64)}`, environment: "testbroker" }
function fixture() {
  return {
    apiVersion: "event-platform.leaddrive.io/v1", kind: "FundShadowWorkerPlan", ...expected,
    broker: { clusterId: "xk6GJfL_T8-cDw8fpx9LOw", groupId: "ld.testbroker.finance.fund-shadow.v2.canary-one",
      topic: "ld.testbroker.finance.events.v1", topicId: "QwdrBdEjTAicf7s7Pr2VJw", partitionCount: 24 },
    limits: { maxRecords: 100, maxDurationMs: 30000 },
    kafkaSecretReference: "vault://leaddrive/testbroker/kafka",
    routes: [{ scope: { organizationId: "tenant-a", buildId: "ec230def-a455-4e09-bc61-28f34696675a", buildKey: "canary-one",
      projectionVersion: 2, codeSha: expected.releaseSha, environment: expected.environment, expectedWorkerRole: "fund_shadow_a" },
      databaseSecretReference: "vault://leaddrive/testbroker/tenant-a" }],
  }
}
function secondRoute() {
  const route = fixture().routes[0]
  return { scope: { ...route.scope, organizationId: "tenant-b", buildId: "7ac57cf3-5a15-4b22-95d0-473b34973420", expectedWorkerRole: "fund_shadow_b" },
    databaseSecretReference: "vault://leaddrive/testbroker/tenant-b" }
}
function setField(input: unknown, path: string, value: unknown) {
  const parts = path.split(".")
  let record = input as Record<string, unknown>
  for (const part of parts.slice(0, -1)) record = record[part] as Record<string, unknown>
  record[parts[parts.length - 1]] = value
}
function invalid(input: unknown, ...pins: [] | [KafkaWorkerPlanExpected]) {
  let caught: unknown
  try { validateKafkaWorkerPlan(input, pins.length === 0 ? expected : pins[0]) } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(KafkaWorkerPlanError)
  expect(caught).toMatchObject({ name: "KafkaWorkerPlanError", code: "KAFKA_WORKER_PLAN_INVALID", message: "KAFKA_WORKER_PLAN_INVALID" })
  expect(caught).not.toHaveProperty("cause")
}

describe("offline Fund worker launch plan (not activation or infrastructure evidence)", () => {
  it("accepts a fully pinned plan and preserves independently admitted tenant routes", () => {
    const input = fixture(); input.routes.push(secondRoute())
    const plan = validateKafkaWorkerPlan(input, expected)
    expect(plan).toEqual(input)
    expect(plan.routes[0].scope).toEqual(validateFundShadowScope(input.routes[0].scope))
    expect(plan.routes[1].scope.buildKey).toBe(plan.routes[0].scope.buildKey) // tenant-scoped keys may agree
    expect(plan).not.toHaveProperty("ready")
    expect(plan).not.toHaveProperty("approved")
  })
  it("takes a detached deeply frozen snapshot, including every route and scope", () => {
    const input = fixture(); input.routes.push(secondRoute())
    const before = structuredClone(input)
    const plan = validateKafkaWorkerPlan(input, expected)
    input.broker.clusterId = "other"; input.limits.maxRecords = 999
    input.routes[0].scope.organizationId = "other"; input.routes[0].databaseSecretReference = "vault://other"
    input.routes.pop(); input.kafkaSecretReference = "vault://other"
    expect(plan).toEqual(before)
    for (const value of [plan, plan.broker, plan.limits, plan.routes, ...plan.routes, ...plan.routes.map(route => route.scope)]) {
      expect(Object.isFrozen(value)).toBe(true)
      expect(Reflect.set(value, "unexpected", "mutation")).toBe(false)
    }
    expect(plan.routes[0]).not.toBe(input.routes[0])
    expect(plan.routes[0].scope).not.toBe(input.routes[0].scope)
  })
  it("accepts already frozen JSON data and null-prototype objects without borrowing them", () => {
    const input = fixture()
    Object.setPrototypeOf(input.broker, null)
    Object.freeze(input.routes[0].scope); Object.freeze(input.routes); Object.freeze(input)
    const plan = validateKafkaWorkerPlan(input, Object.freeze({ ...expected }))
    expect(plan).toEqual(input)
    expect(Object.getPrototypeOf(plan.broker)).toBe(Object.prototype)
    expect(plan.broker).not.toBe(input.broker)
  })
  it.each([null, undefined, false, 1, "{}", [], new Date(), new Map()])("rejects non-plan input %s without coercion", input => invalid(input))

  const unknownFields = [
    "password", "DATABASE_URL", "ready", "approved", "offset", "resetOffsets", "autoRestart", "command", "env", "testProfile",
    "broker.bootstrapServers", "broker.securityProtocol", "broker.autoOffsetReset", "broker.seek", "broker.skipMetadata",
    "limits.autoRestart", "routes.0.databaseUrl", "routes.0.database", "routes.0.scope.mode", "routes.0.scope.effectsFenced",
    "routes.0.scope.approved", "routes.0.scope.replayFrom",
  ]
  it.each(unknownFields)("rejects unsupported authority/configuration field %s", path => {
    const input = fixture(); setField(input, path, "synthetic-private-value")
    invalid(input)
  })
  it.each([
    "apiVersion", "kind", "releaseSha", "artifactSha256", "environment", "broker", "limits", "kafkaSecretReference", "routes",
    "broker.clusterId", "broker.groupId", "broker.topic", "broker.topicId", "broker.partitionCount",
    "limits.maxRecords", "limits.maxDurationMs", "routes.0.scope", "routes.0.databaseSecretReference",
    ...["organizationId", "buildId", "buildKey", "projectionVersion", "codeSha", "environment", "expectedWorkerRole"].map(key => `routes.0.scope.${key}`),
  ])("rejects missing required field %s", path => {
    const input = fixture(), parts = path.split(".")
    let record = input as unknown as Record<string, unknown>
    for (const part of parts.slice(0, -1)) record = record[part] as Record<string, unknown>
    delete record[parts[parts.length - 1]]; invalid(input)
  })
  it.each([
    ["apiVersion", "event-platform.leaddrive.io/v2"], ["kind", "KafkaActivationEvidence"],
    ["releaseSha", "c".repeat(40)], ["artifactSha256", `sha256:${"c".repeat(64)}`], ["environment", "prod"],
    ["broker.clusterId", ""], ["broker.clusterId", "x".repeat(250)], ["broker.clusterId", "https://broker.invalid"],
    ["broker.clusterId", "broker:9092"], ["broker.clusterId", "x\n"], ["broker.clusterId", { toString: (): string => "cluster" }],
    ["broker.topic", "ld.prod.finance.events.v1"], ["broker.topic", "ld.testbroker.crm.events.v1"],
    ["broker.topic", "ld.testbroker.finance.replay.v1"], ["broker.topic", "ld.testbroker.finance.events.v1\n"],
    ["broker.topicId", "ec230def-a455-4e09-bc61-28f34696675a"], ["broker.topicId", "AAAAAAAAAAAAAAAAAAAAAA"],
    ["broker.topicId", "QwdrBdEjTAicf7s7Pr2VJx"], ["broker.topicId", "QwdrBdEjTAicf7s7Pr2VJw=="],
    ["broker.topicId", "QwdrBdEjTAicf7s7Pr2VJw\n"], ["broker.topicId", "topic-placeholder"],
  ])("rejects mismatched/malformed pin %s (%s)", (path, value) => {
    const input = fixture(); setField(input, path as string, value); invalid(input)
  })
  it.each([
    ["releaseSha", "short"], ["releaseSha", "A".repeat(40)], ["releaseSha", "a".repeat(40) + "\n"],
    ["artifactSha256", "b".repeat(64)], ["artifactSha256", `sha256:${"B".repeat(64)}`],
    ["artifactSha256", `sha256:${"b".repeat(64)}\n`],
    ["environment", ""], ["environment", "production-other"], ["environment", "prod\n"], ["environment", "a".repeat(33)],
  ])("validates independently supplied expected %s, not only equality", (field, value) => {
    const input = fixture(), pins = { ...expected }
    setField(input, field, value); setField(pins, field, value)
    invalid(input, pins)
  })
  it.each([null, undefined, {}, { ...expected, approved: true }])("requires every independent expected pin (%s)", pins => {
    invalid(fixture(), pins as unknown as KafkaWorkerPlanExpected)
  })
  it("requires exact external pins even when the input is internally consistent", () => {
    const input = fixture(); input.releaseSha = "c".repeat(40); input.routes[0].scope.codeSha = input.releaseSha
    invalid(input)
  })

  it.each([
    ["broker.partitionCount", [0, -1, 0.5, 129, NaN, Infinity, "24", null]],
    ["limits.maxRecords", [0, -1, 0.5, 100001, NaN, Infinity, "10", null]],
    ["limits.maxDurationMs", [0, -1, 0.5, 600001, NaN, Infinity, "1000", null]],
  ])("rejects unbounded/coerced %s", (path, values) => {
    for (const value of values) { const input = fixture(); setField(input, path, value); invalid(input) }
  })
  it.each([1, 128])("accepts bounded partition count %s", partitionCount => {
    const input = fixture(); input.broker.partitionCount = partitionCount
    expect(validateKafkaWorkerPlan(input, expected).broker.partitionCount).toBe(partitionCount)
  })
  it.each([{ maxRecords: 1, maxDurationMs: 1 }, { maxRecords: 100000, maxDurationMs: 600000 }])("accepts exact finite session bounds %s", limits => {
    const input = fixture(); input.limits = limits
    expect(validateKafkaWorkerPlan(input, expected).limits).toEqual(limits)
  })
  it.each([
    "shadow", "ld.prod.finance.fund-shadow.v2.canary", "ld.testbroker.crm.fund-shadow.v2.canary",
    "ld.testbroker.finance.fund-balance.v2.canary", "ld.testbroker.finance.fund-shadow.v3.canary",
    "ld.testbroker.finance.fund-shadow.v02.canary", "ld.testbroker.finance.fund-shadow.v2",
    "ld.testbroker.finance.fund-shadow.v2.", "ld.testbroker.finance.fund-shadow.v2.CANARY",
    "ld.testbroker.finance.fund-shadow.v2.a.b", "ld.testbroker.finance.fund-shadow.v2.*",
    `ld.testbroker.finance.fund-shadow.v2.${"a".repeat(64)}`, "ld.testbroker.finance.fund-shadow.v2.canary\n",
  ])("requires exact environment, shadow purpose, version and bounded group suffix (%s)", groupId => {
    const input = fixture(); input.broker.groupId = groupId; invalid(input)
  })
  it("binds the group to the common projection version without deriving a group from the release", () => {
    const input = fixture(); input.routes.push(secondRoute())
    for (const route of input.routes) route.scope.projectionVersion = 2147483647
    input.broker.groupId = "ld.testbroker.finance.fund-shadow.v2147483647.stable-restart"
    expect(validateKafkaWorkerPlan(input, expected).broker.groupId).toBe(input.broker.groupId)
    const newPins = { ...expected, releaseSha: "c".repeat(40) }; input.releaseSha = newPins.releaseSha
    for (const route of input.routes) route.scope.codeSha = newPins.releaseSha
    expect(validateKafkaWorkerPlan(input, newPins).broker.groupId).toBe(input.broker.groupId)
  })

  it.each([
    ["organizationId", ""], ["organizationId", "tenant:other"], ["organizationId", "a".repeat(192)],
    ["buildId", "not-a-uuid"], ["buildId", "ec230def-a455-4e09-bc61-28f34696675a\n"],
    ["buildKey", ""], ["buildKey", "with space"], ["projectionVersion", 1], ["projectionVersion", 2.5],
    ["projectionVersion", 2147483648], ["projectionVersion", "2"], ["projectionVersion", Infinity],
    ["codeSha", "C".repeat(40)], ["codeSha", "c".repeat(40)], ["codeSha", expected.releaseSha + "\n"],
    ["environment", "prod"], ["environment", "testbroker\n"], ["expectedWorkerRole", ""],
    ["expectedWorkerRole", "role;admin"], ["expectedWorkerRole", "UPPER"], ["expectedWorkerRole", "a".repeat(64)],
    ["expectedWorkerRole", "role\n"], ["expectedWorkerRole", 12],
  ])("reuses scope validation and rejects unbound/unsafe %s", (field, value) => {
    const input = fixture(); setField(input.routes[0].scope, field as string, value); invalid(input)
  })
  it.each(["organizationId", "expectedWorkerRole", "buildId"])("rejects duplicate admitted %s", field => {
    const input = fixture(); input.routes.push(secondRoute())
    setField(input.routes[1].scope, field, input.routes[0].scope[field as keyof typeof input.routes[0]["scope"]])
    invalid(input)
  })
  it("rejects case-insensitive build ID duplication and mixed projection versions", () => {
    const input = fixture(); input.routes.push(secondRoute())
    input.routes[1].scope.buildId = input.routes[0].scope.buildId.toUpperCase(); invalid(input)
    input.routes[1] = secondRoute(); input.routes[1].scope.projectionVersion = 3; invalid(input)
  })
  it.each([[], null, {}, [null], new Array(1), new Array(1001)])("requires a dense bounded route array (%s)", routes => {
    const input = fixture(); setField(input, "routes", routes); invalid(input)
  })
  it("accepts the route cap with distinct independently admitted identities", () => {
    const input = fixture()
    input.routes = Array.from({ length: 1000 }, (_, index) => ({ scope: { ...input.routes[0].scope,
      organizationId: `tenant-${index}`, buildId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, expectedWorkerRole: `fund_shadow_${index}` },
      databaseSecretReference: `vault://leaddrive/testbroker/tenant-${index}` }))
    expect(validateKafkaWorkerPlan(input, expected).routes).toHaveLength(1000)
  })

  it.each([
    "vault://leaddrive/testbroker/kafka", "aws-secretsmanager://arn:aws:secretsmanager:eu-west-1:123456789012:secret:worker-ABC",
    "gcp-secretmanager://projects/example/secrets/worker/versions/1", "azure-keyvault://example.vault.azure.net/secrets/worker/version-1",
  ])("accepts only an opaque reference under existing manager authorities (%s)", kafkaSecretReference => {
    const input = fixture(); input.kafkaSecretReference = kafkaSecretReference
    expect(validateKafkaWorkerPlan(input, expected).kafkaSecretReference).toBe(kafkaSecretReference)
  })
  it.each([
    "", "synthetic-password", "/etc/private/worker.env", "file:///etc/private/key", "env://DATABASE_URL",
    "https://vault.invalid/secret", "postgresql://user:synthetic-password@db.invalid/db", "sasl://user:synthetic-password",
    "vault://", "vault:///secret", "vault://user:synthetic-password@host/secret", "VAULT://secret",
    "vault://path/../secret", "vault://path/./secret", "vault://path//secret", "vault://path/",
    "vault://path?token=synthetic-password", "vault://path#field", "vault://path%2Fsecret", "vault://path\n",
    "vault://https://host/secret", "vault://secret\u0000", "vault://with space", "vault://" + "a".repeat(1024),
  ])("rejects raw credentials, local bypasses or ambiguous secret references (%s)", reference => {
    for (const path of ["kafkaSecretReference", "routes.0.databaseSecretReference"]) {
      const input = fixture(); setField(input, path, reference); invalid(input)
    }
  })
  it("rejects a reused Kafka or per-route database secret reference", () => {
    const input = fixture(); input.routes[0].databaseSecretReference = input.kafkaSecretReference; invalid(input)
    input.routes[0] = fixture().routes[0]; input.routes.push(secondRoute())
    input.routes[1].databaseSecretReference = input.routes[0].databaseSecretReference; invalid(input)
  })

  it("rejects accessors at each nesting level without invoking them", () => {
    for (const path of ["releaseSha", "broker.clusterId", "limits.maxRecords", "routes.0", "routes.0.scope.buildId", "routes.0.databaseSecretReference"]) {
      const input = fixture(), getter = vi.fn(() => { throw new Error("synthetic-private-getter") }), parts = path.split(".")
      let record = input as unknown as Record<string, unknown>
      for (const part of parts.slice(0, -1)) record = record[part] as Record<string, unknown>
      Object.defineProperty(record, parts[parts.length - 1], { get: getter, enumerable: true })
      invalid(input); expect(getter).not.toHaveBeenCalled()
    }
    const pins = { ...expected }, getter = vi.fn(() => expected.releaseSha)
    Object.defineProperty(pins, "releaseSha", { get: getter, enumerable: true })
    invalid(fixture(), pins); expect(getter).not.toHaveBeenCalled()
  })
  it("rejects non-JSON own keys, custom prototypes and sparse/extended arrays", () => {
    for (const modify of [
      (input: ReturnType<typeof fixture>) => Object.defineProperty(input, "releaseSha", { enumerable: false }),
      (input: ReturnType<typeof fixture>) => Object.defineProperty(input.broker, Symbol("credential"), { value: "synthetic-secret" }),
      (input: ReturnType<typeof fixture>) => Object.defineProperty(input, "__proto__", { value: { approved: true }, enumerable: true }),
      (input: ReturnType<typeof fixture>) => Object.setPrototypeOf(input.routes[0].scope, { approved: true }),
      (input: ReturnType<typeof fixture>) => Object.setPrototypeOf(input.routes, {}),
      (input: ReturnType<typeof fixture>) => Object.defineProperty(input.routes, "extra", { value: "unsupported" }),
      (input: ReturnType<typeof fixture>) => { delete input.routes[0]; Object.defineProperty(input.routes, "extra", { value: "replacement" }) },
    ]) { const input = fixture(); modify(input); invalid(input) }
  })
  it("sanitizes unexpected shape/proxy failures without leaking their cause", () => {
    const input = new Proxy(fixture(), { getPrototypeOf() { throw new Error("synthetic-private-credential") } })
    invalid(input)
    const revoked = Proxy.revocable(fixture(), {}); revoked.revoke(); invalid(revoked.proxy)
  })
})
