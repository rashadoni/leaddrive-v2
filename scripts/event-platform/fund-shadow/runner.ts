// Fund shadow pilot: ONE finite worker session on a Connect host, started by
// the ld-fund-shadow timer. It reads the finance topic with the ld-fund-worker
// identity, folds Fund events of the planned organizations into their shadow
// builds through their own restricted PostgreSQL logins, and stops once the
// group has caught up. Nothing here promotes a projection, resets an offset,
// touches active balances or sends anything outside.
//
// Everything trusted comes from root-owned files written by
// `provision.sh fund-shadow-install`, never from Kafka or the environment:
//
//   /etc/leaddrive-kafka/fund-shadow/pins.json   releaseSha, artifactSha256, environment
//   /etc/leaddrive-kafka/fund-shadow/plan.json   FundShadowWorkerPlan (validateKafkaWorkerPlan)
//   /etc/leaddrive-kafka/fund-shadow/host.json   brokers, Connect image, PostgreSQL address and TLS name
//   /etc/leaddrive-kafka/fund-shadow/secrets/    one file per secret reference (see secretFile)
//   /opt/ld-fund-shadow/artifact                 bridge classes + client jars (verifyKafkaWorkerArtifact)
//
// Output is one status line; event data, SQL and credentials never reach it.
import { spawn } from "node:child_process"
import { chownSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Client } from "pg"
import { validateKafkaWorkerPlan } from "../../../src/lib/event-platform/worker-admission"
import { verifyKafkaWorkerArtifact } from "../../../src/lib/event-platform/worker-artifact"
import { createSupervisedKafkaChannel } from "../../../src/lib/event-platform/worker-process"
import { startKafkaWorkerSession } from "../../../src/lib/event-platform/worker-session"
import { createFundShadowPartitionWorker } from "../../../src/lib/event-platform/fund-shadow-worker"
import { pgFundShadowDatabase } from "./pg-database"

const CONFIG = "/etc/leaddrive-kafka/fund-shadow"
const ARTIFACT = "/opt/ld-fund-shadow/artifact"
const RUNTIME = "/run/ld-fund-shadow"
// The bridge runs as nobody; only its properties file is given to that user,
// with exactly owner read/write: KafkaPartitionBridge.load() refuses any other mode.
const BRIDGE_UID = 65534
// Two IDLE frames in a row after the first assignment: the group has read
// everything there was. Stopping then leaves no record or COMMIT in flight.
const IDLE_TO_STOP = 2

const json = (name: string) => JSON.parse(readFileSync(join(CONFIG, name), "utf8"))

// A plan secret reference names a file of the pilot's secret store: the
// reference path after the scheme, "/" replaced by "__". No traversal: the
// plan validator already refused empty, "." and ".." segments.
function secretFile(reference: string): string {
  const path = reference.replace(/^[a-z-]+:\/\//, "").replaceAll("/", "__")
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(path)) throw new Error("FUND_SHADOW_PILOT_SECRET_REFERENCE")
  return readFileSync(join(CONFIG, "secrets", path), "utf8").trim()
}

async function main(): Promise<number> {
  const pins = json("pins.json")
  const plan = validateKafkaWorkerPlan(json("plan.json"), pins)
  const host = json("host.json") as { brokers: string; connectImage: string; caFile: string;
    database: { address: string; tlsName: string; caFile: string; name: string } }
  const artifact = await verifyKafkaWorkerArtifact({ root: ARTIFACT, expectedReleaseSha: plan.releaseSha,
    expectedManifestSha256: plan.artifactSha256 })

  rmSync(RUNTIME, { recursive: true, force: true })
  mkdirSync(RUNTIME, { mode: 0o711 })
  const properties = join(RUNTIME, "bridge.properties")
  writeFileSync(properties, [
    `expected.cluster.id=${plan.broker.clusterId}`, `expected.topic.id=${plan.broker.topicId}`,
    `expected.partitions=${plan.broker.partitionCount}`, `bootstrap.servers=${host.brokers}`,
    "security.protocol=SASL_SSL", "sasl.mechanism=SCRAM-SHA-512",
    `sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username="ld-fund-worker" password="${secretFile(plan.kafkaSecretReference)}";`,
    "ssl.truststore.type=PEM", "ssl.truststore.location=/bridge-ca.pem",
    `group.id=${plan.broker.groupId}`, `topic=${plan.broker.topic}`, "",
  ].join("\n"), { mode: 0o600 })
  chownSync(properties, BRIDGE_UID, BRIDGE_UID)

  // Logins first: the JVM starts as soon as the channel exists.
  const ca = readFileSync(host.database.caFile, "utf8")
  const routes = plan.routes.map(route => ({ scope: route.scope, client: new Client({
    host: host.database.address, port: 5432, database: host.database.name,
    user: route.scope.expectedWorkerRole, password: secretFile(route.databaseSecretReference),
    ssl: { ca, servername: host.database.tlsName, rejectUnauthorized: true },
    application_name: "ld-fund-shadow", connectionTimeoutMillis: 10_000,
  }) }))
  await Promise.all(routes.map(route => route.client.connect()))

  const supervised = createSupervisedKafkaChannel({ stopGraceMs: 5000, killGraceMs: 2000, timeoutMs: 45_000,
    spawn() {
      // The verified artifact is mounted at its own path, so its classpath
      // holds inside the container; the image only supplies the JVM.
      return spawn("docker", ["run", "-i", "--rm", "--network", "host", "--user", `${BRIDGE_UID}:${BRIDGE_UID}`,
        "--read-only", "--memory", "256m", "--memory-swap", "256m", "--pids-limit", "128", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--name", `ld-fund-shadow-bridge-${process.pid}`,
        "-v", `${ARTIFACT}:${ARTIFACT}:ro`, "-v", `${properties}:/bridge.properties:ro`, "-v", `${host.caFile}:/bridge-ca.pem:ro`,
        "--entrypoint", "java", host.connectImage,
        "-Xms16m", "-Xmx96m", "-XX:ActiveProcessorCount=1", "-XX:MaxDirectMemorySize=32m", "-XX:MaxMetaspaceSize=128m",
        "-XX:+ExitOnOutOfMemoryError", `-Dlog4j2.configurationFile=${artifact.loggingConfiguration}`,
        "-cp", artifact.classpath.join(":"), "KafkaPartitionBridge", "/bridge.properties"],
      { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" } })
    },
  })

  let assigned = false, idle = 0, caughtUp = false, failed = false, committed = 0
  const session = startKafkaWorkerSession({ clusterId: plan.broker.clusterId, groupId: plan.broker.groupId,
    topic: plan.broker.topic, maxRecords: plan.limits.maxRecords, maxDurationMs: plan.limits.maxDurationMs,
    open() {
      const channel = supervised.channel
      return {
        channel: { ...channel, async read() {
          const frame = await channel.read()
          if (frame.startsWith("ASSIGN\t")) assigned = true
          if (frame === "IDLE") {
            idle++
            if (assigned && idle >= IDLE_TO_STOP) { caughtUp = true; stop() }
          } else idle = 0
          return frame
        } },
        createProcessor(assignment, broker) {
          const worker = createFundShadowPartitionWorker({ assignment, broker, environment: plan.environment,
            routes: routes.map(route => ({ scope: route.scope, database: pgFundShadowDatabase(route.client) })) })
          return { revoke: () => worker.revoke(), async processBatch(batch: Parameters<typeof worker.processBatch>[0]) {
            try {
              const result = await worker.processBatch(batch)
              committed += batch.records.length
              return result
            } catch (error) { failed = true; throw error }
          } }
        },
        async release() { await Promise.allSettled(routes.map(route => route.client.end())) },
      }
    },
  })
  function stop() { session.stop() }

  let processed: number | null = null
  try { processed = (await session.done).processed } catch { /* reason below, without details */ }
  await supervised.abort().catch(() => {})
  rmSync(RUNTIME, { recursive: true, force: true })
  // A session stopped on purpose always rejects; it is a clean run when this
  // runner stopped it at an idle frame and no batch failed.
  const outcome = failed ? "failed" : processed !== null ? "max-records" : caughtUp ? "caught-up" : "stopped"
  console.log(`fund_shadow_session outcome=${outcome} committed=${committed} routes=${routes.length} release=${plan.releaseSha.slice(0, 12)}`)
  return outcome === "caught-up" || outcome === "max-records" ? 0 : 1
}

main().then(code => process.exit(code), () => {
  console.log("fund_shadow_session outcome=refused committed=0")
  process.exit(2)
})
