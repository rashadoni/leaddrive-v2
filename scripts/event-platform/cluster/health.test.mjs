import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate, parseQuorumReplication, parseQuorumStatus, parseTopics } from './health.mjs'
import { loadTopology } from './render.mjs'
import { applySent, messages, step, weeklyDue } from './watch.mjs'

// Output shapes as Kafka 4.3.1 prints them on the production cluster (2026-10-23).
const STATUS = `ClusterId:              K3TZRGsp2DK1UJYj_Sxrwg
LeaderId:               3
LeaderEpoch:            7
HighWatermark:          43285
MaxFollowerLag:         0
MaxFollowerLagTimeMs:   385
CurrentVoters:          [{"id": 1, "endpoints": ["CONTROLLER://10.88.0.13:9093"]}, {"id": 2, "endpoints": ["CONTROLLER://10.88.0.14:9093"]}, {"id": 3, "endpoints": ["CONTROLLER://10.88.0.15:9093"]}]
CurrentObservers:       [{"id": 102, "directoryId": "LdXnhBjT4ACkA9g0ZlJkLA"}, {"id": 103, "directoryId": "BzdjUV4NHmazNaq45yCULQ"}, {"id": 101, "directoryId": "ybnfsQXU66cjXslmW4jlMQ"}]
`
const replication = (stale = {}) => ['NodeId\tDirectoryId           \tLogEndOffset\tLag\tLastFetchTimestamp\tLastCaughtUpTimestamp\tStatus  \t',
  ...[[3, 'Leader'], [1, 'Follower'], [2, 'Follower'], [102, 'Observer'], [103, 'Observer'], [101, 'Observer']].map(([id, s]) =>
    `${id}     \tAAAAAAAAAAAAAAAAAAAAAA\t43294       \t0  \t${1792789253579 - (stale[id] ?? 100)}     \t1792789253443        \t${s}${' '.repeat(8 - s.length)}\t`)].join('\n')
const topic = (name, rows) => [
  `Topic: ${name}\tTopicId: Qfn15STRQeWkNGEoU2bOsw\tPartitionCount: ${rows.length}\tReplicationFactor: 3\tConfigs: compression.type=producer,min.insync.replicas=2,cleanup.policy=delete`,
  ...rows.map(([leader, isr], i) => `\tTopic: ${name}\tPartition: ${i}\tLeader: ${leader}\tReplicas: 102,103,101\tIsr: ${isr}\tElr: \tLastKnownElr: `),
].join('\n')
const HEALTHY_TOPICS = [topic('ld.prod.finance.events.v1', [[102, '102,103,101'], [103, '103,101,102']]), topic('ld.prod.registry.journal', [[103, '103,101,102']])].join('\n')

const topology = loadTopology()
const inventory = { hosts: Object.fromEntries([...topology.clusters[0].hosts.map((h) => h.name), 'leaddrive-prod'].map((n) => [n, { publicAddress: '192.0.2.1' }])) }
const SLOT = 'leaddrive_event_outbox_prod'
const CONNECTOR = 'leaddrive-event-outbox-prod'
const running = { [CONNECTOR]: { status: { connector: { state: 'RUNNING' }, tasks: [{ id: 0, state: 'RUNNING' }] } } }

function healthyProbes() {
  const probes = {}
  for (const h of topology.clusters.find((c) => c.name === 'primary').hosts) {
    const data = { disk: { usedPercent: 12 }, tunnel: { up: true, peers: 8, stale: 0 }, cert: { daysLeft: 800 },
      containers: [{ name: h.name, state: 'running' }] }
    if (h.roles.includes('connect')) {
      data.connect = { ok: true, connectors: running, expected: [CONNECTOR] }
      data.registry = { ok: true }
    }
    probes[h.name] = { ok: true, data }
  }
  probes['leaddrive-prod'] = { ok: true, data: { disk: { usedPercent: 16 }, tunnel: { up: true, peers: 8, stale: 0 },
    source: { expectedSlot: SLOT, slots: [{ name: SLOT, active: true, walStatus: 'reserved', retainedBytes: 16 << 20, safeBytes: 16 * 1024 ** 3 }] } } }
  return probes
}
const healthyCluster = () => ({ broker: 'kafka-p-broker-eu', data: { status: STATUS, replication: replication(), topics: HEALTHY_TOPICS } })
const ids = (problems) => problems.map((p) => p.id).sort()

test('parsers read the production output of Kafka 4.3.1', () => {
  assert.deepEqual(parseQuorumStatus(STATUS), { leaderId: 3, voters: [1, 2, 3], observers: [102, 103, 101] })
  const rows = parseQuorumReplication(replication())
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0], { nodeId: 3, lag: 0, lastFetch: 1792789253479, status: 'Leader' })
  const t = parseTopics(HEALTHY_TOPICS)
  assert.equal(t.partitions.length, 3)
  assert.equal(t.minIsr['ld.prod.finance.events.v1'], 2)
  assert.deepEqual(t.partitions[0], { topic: 'ld.prod.finance.events.v1', partition: 0, leader: 102, replicas: [102, 103, 101], isr: [102, 103, 101] })
  assert.equal(parseTopics(topic('x', [['none', '']])).partitions[0].leader, null)
})

test('a healthy platform raises nothing', () => {
  assert.deepEqual(evaluate({ topology, inventory, probes: healthyProbes(), cluster: healthyCluster() }), [])
})

test('the CDC slot: retention, inactivity and loss are each named', () => {
  const at = (slot) => { const p = healthyProbes(); p['leaddrive-prod'].data.source.slots = slot ? [{ name: SLOT, active: true, walStatus: 'reserved', retainedBytes: 0, safeBytes: null, ...slot }] : []
    return evaluate({ topology, inventory, probes: p, cluster: healthyCluster() }) }
  assert.deepEqual(at({ retainedBytes: 512 << 20 }), [])
  assert.deepEqual(at({ retainedBytes: 2 * 1024 ** 3 }).map((p) => [p.id, p.severity]), [['slot-retained', 'warning']])
  assert.deepEqual(at({ retainedBytes: 5 * 1024 ** 3 }).map((p) => [p.id, p.severity]), [['slot-retained', 'critical']])
  assert.match(at({ retainedBytes: 5 * 1024 ** 3, safeBytes: 11 * 1024 ** 3 })[0].detail, /5\.0 ГБ.*осталось 11\.0 ГБ/)
  assert.deepEqual(ids(at({ active: false })), ['slot-inactive'])
  assert.deepEqual(ids(at({ walStatus: 'unreserved', retainedBytes: 17 * 1024 ** 3 })), ['slot-unreserved'])
  assert.deepEqual(ids(at({ walStatus: 'lost', active: false })), ['slot-lost'])
  assert.deepEqual(ids(at(null)), ['slot-missing'])
})

test('losing a site names its broker and controller; losing two names refused writes', () => {
  // Site UK down: broker 102 and controller 2 stop fetching, partitions shrink to two replicas.
  const oneSite = { broker: 'kafka-p-broker-eu', data: { status: STATUS, replication: replication({ 102: 90_000, 2: 90_000 }),
    topics: topic('ld.prod.finance.events.v1', [[103, '103,101'], [103, '103,101']]) } }
  const p = healthyProbes(); p['kafka-p-broker-uk'] = { ok: false, error: 'timeout' }; p['kafka-p-ctrl-uk'] = { ok: false, error: 'timeout' }
  p['kafka-p-connect-uk'] = { ok: false, error: 'timeout' }
  assert.deepEqual(ids(evaluate({ topology, inventory, probes: p, cluster: oneSite })), [
    'broker:kafka-p-broker-uk', 'controller:kafka-p-ctrl-uk', 'host-unreachable:kafka-p-broker-uk', 'host-unreachable:kafka-p-connect-uk',
    'host-unreachable:kafka-p-ctrl-uk', 'partitions-under-replicated'])
  const twoSites = { ...oneSite, data: { ...oneSite.data, topics: topic('ld.prod.finance.events.v1', [[101, '101'], ['none', '']]) } }
  const problems = evaluate({ topology, inventory, probes: p, cluster: twoSites })
  assert.ok(problems.some((x) => x.id === 'partitions-below-min-isr' && x.severity === 'critical'))
  assert.ok(problems.some((x) => x.id === 'partitions-offline' && x.severity === 'critical'))
  assert.deepEqual(ids(evaluate({ topology, inventory, probes: healthyProbes(), cluster: null })), ['cluster-unreachable'])
})

test('a stopped connector task is critical; one silent Connect worker is a warning', () => {
  const p = healthyProbes()
  p['kafka-p-connect-eu'].data.connect.connectors = { [CONNECTOR]: { status: { connector: { state: 'RUNNING' }, tasks: [{ id: 0, state: 'FAILED' }] } } }
  p['kafka-p-connect-uk'].data.connect = { ok: false, connectors: null, expected: [CONNECTOR] }
  const problems = evaluate({ topology, inventory, probes: p, cluster: healthyCluster() })
  assert.deepEqual(problems.map((x) => [x.id, x.severity]), [['connect-down:kafka-p-connect-uk', 'warning'], ['connector-state:leaddrive-event-outbox-prod', 'critical']])
  assert.match(problems[1].detail, /task 0 FAILED/)
})

test('a problem is told once after two passes, reminded after a day, and its end is told', () => {
  const problem = { id: 'slot-inactive', severity: 'critical', title: 'События из базы не уходят в Kafka', detail: '…' }
  let state = {}
  let s = step(state, [problem], 0)
  assert.deepEqual(messages(s), [], 'one pass is not enough')
  s = step({ incidents: s.incidents }, [problem], 300_000)
  const [raise] = messages(s)
  assert.equal(raise.kind, 'raise')
  assert.match(raise.title, /^❗ Kafka: События из базы/)
  applySent(s.incidents, raise, 300_000)
  s = step({ incidents: s.incidents }, [problem], 600_000)
  assert.deepEqual(messages(s), [], 'told once')
  s = step({ incidents: s.incidents }, [problem], 300_000 + 24 * 3600_000)
  assert.equal(messages(s)[0].kind, 'remind')
  s = step({ incidents: s.incidents }, [], 300_000 + 24 * 3600_000 + 1)
  assert.deepEqual(messages(s), [], 'one clean pass is not enough to call it fixed')
  s = step({ incidents: s.incidents }, [], 300_000 + 24 * 3600_000 + 2)
  const [clear] = messages(s)
  assert.equal(clear.kind, 'clear')
  applySent(s.incidents, clear, 0)
  assert.deepEqual(s.incidents, {})
  // A blip that never reached two passes leaves nothing behind.
  s = step({}, [problem], 0)
  assert.deepEqual(step({ incidents: s.incidents }, [], 1).incidents, {})
})

test('an unsent message is retried on the next pass', () => {
  const problem = { id: 'disk:x', severity: 'warning', title: 't', detail: 'd' }
  let s = step({}, [problem], 0)
  s = step({ incidents: s.incidents }, [problem], 1)
  assert.equal(messages(s).length, 1)
  s = step({ incidents: s.incidents }, [problem], 2) // Telegram refused: applySent never ran
  assert.equal(messages(s)[0].kind, 'raise')
})

test('a warning that turns critical is told again', () => {
  const warn = { id: 'slot-retained', severity: 'warning', title: 'Слот', detail: '2 ГБ' }
  let s = step({}, [warn], 0)
  s = step({ incidents: s.incidents }, [warn], 1)
  applySent(s.incidents, messages(s)[0], 1)
  s = step({ incidents: s.incidents }, [{ ...warn, severity: 'critical', detail: '5 ГБ' }], 2)
  const [m] = messages(s)
  assert.match(m.title, /^❗/)
  assert.match(m.text, /5 ГБ/)
})

test('the weekly note goes out on Monday morning in Baku, once', () => {
  const monday10 = Date.UTC(2026, 9, 26, 6, 0) // 10:00 Baku
  assert.equal(weeklyDue(undefined, monday10), true)
  assert.equal(weeklyDue(monday10 - 3600_000, monday10), false)
  assert.equal(weeklyDue(undefined, Date.UTC(2026, 9, 26, 4, 0)), false, '08:00 Baku is too early')
  assert.equal(weeklyDue(undefined, Date.UTC(2026, 9, 27, 6, 0)), false, 'Tuesday')
})
