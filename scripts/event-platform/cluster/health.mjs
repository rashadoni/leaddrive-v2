// Health of the Kafka platform as the operator watch sees it. health-probe.sh
// prints one JSON object per host; this module parses the Kafka tool output in
// it, decides what is wrong and words each problem for the owner in Russian.
// Pure functions only: watch.mjs does the SSH, the state and the sending.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadCatalog, loadTopology, nodeIds, SOURCE_ROLE } from './render.mjs'

const GiB = 1024 ** 3

export const LIMITS = Object.freeze({
  // WAL the CDC slot keeps on the production disk. The hard cap is
  // max_slot_wal_keep_size = 16GB; past it PostgreSQL drops the slot and the
  // connector must start over from a new snapshot.
  slotRetainedWarnBytes: 1 * GiB,
  slotRetainedCriticalBytes: 4 * GiB,
  diskWarnPercent: 80,
  diskCriticalPercent: 90,
  // A voter or broker whose last fetch is this far behind the leader's is gone.
  fetchStaleMs: 30_000,
  tunnelStaleSeconds: 180,
  certWarnDays: 30,
})

const SITE_RU = {
  'contabo-eu': 'Contabo EU',
  'contabo-uk': 'Contabo UK',
  'ovh-gra': 'OVH Гравлин',
}

const ROLE_RU = { broker: 'брокер', controller: 'контроллер', connect: 'переносчик событий', [SOURCE_ROLE]: 'сервер прода' }

export function hostLabel(member) {
  if (member.roles.includes(SOURCE_ROLE)) return 'сервер прода'
  const role = member.roles.map((r) => ROLE_RU[r]).find(Boolean) ?? member.roles[0]
  return `${role} ${SITE_RU[member.site] ?? member.site}`
}

const mb = (bytes) => bytes >= GiB ? `${(bytes / GiB).toFixed(1)} ГБ` : `${Math.round(bytes / 1024 ** 2)} МБ`

// kafka-metadata-quorum.sh describe --status
export function parseQuorumStatus(text) {
  const field = (name) => text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim()
  const ids = (value) => value ? [...value.matchAll(/"id":\s*(\d+)/g)].map((m) => Number(m[1])) : []
  const leader = Number(field('LeaderId'))
  return {
    leaderId: Number.isInteger(leader) && leader >= 0 ? leader : null,
    voters: ids(field('CurrentVoters')),
    observers: ids(field('CurrentObservers')),
  }
}

// kafka-metadata-quorum.sh describe --replication: tab-separated rows.
export function parseQuorumReplication(text) {
  const rows = []
  for (const line of text.split('\n').slice(1)) {
    const cells = line.split('\t').map((c) => c.trim())
    if (!/^\d+$/.test(cells[0] ?? '')) continue
    rows.push({ nodeId: Number(cells[0]), lag: Number(cells[3]), lastFetch: Number(cells[4]), status: cells[6] })
  }
  return rows
}

// kafka-topics.sh --describe: a header line per topic, a line per partition.
export function parseTopics(text) {
  const minIsr = {}
  const partitions = []
  const list = (s) => s ? s.split(',').filter(Boolean).map(Number) : []
  for (const line of text.split('\n')) {
    const header = line.match(/^Topic:\s*(\S+)\s+TopicId:.*?Configs:\s*(.*)$/)
    if (header) {
      // Only topic overrides are listed; the rest use the broker default.
      const own = header[2].match(/(?:^|,)min\.insync\.replicas=(\d+)/)?.[1]
      if (own) minIsr[header[1]] = Number(own)
      continue
    }
    const p = line.match(/^\s+Topic:\s*(\S+)\s+Partition:\s*(\d+)\s+Leader:\s*(\S+)\s+Replicas:\s*(\S*)\s+Isr:\s*(\S*)/)
    if (!p) continue
    const leader = Number(p[3])
    partitions.push({ topic: p[1], partition: Number(p[2]), leader: Number.isInteger(leader) && leader >= 0 ? leader : null,
      replicas: list(p[4]), isr: list(p[5]) })
  }
  return { minIsr, partitions }
}

function problem(id, severity, title, detail) { return { id, severity, title, detail } }

// probes: { [hostName]: { ok: true, data } | { ok: false, error } }
// cluster: { broker, data: { status, replication, topics } } from one broker, or null.
export function evaluate({ topology, inventory, probes, cluster: clusterView }) {
  const problems = []
  const primary = topology.clusters.find((c) => c.name === 'primary')
  const members = [
    ...primary.hosts.map((h) => ({ ...h })),
    { name: topology.sourceHost.name, site: topology.sourceHost.site, roles: [SOURCE_ROLE] },
  ].filter((m) => inventory.hosts?.[m.name])
  const byName = new Map(members.map((m) => [m.name, m]))
  const ids = nodeIds(primary)
  const label = (name) => hostLabel(byName.get(name) ?? { roles: [], site: name })

  const unreachable = members.filter((m) => !probes[m.name]?.ok)
  const downAddresses = new Set(unreachable.map((m) => inventory.hosts[m.name]?.address).filter(Boolean))
  for (const m of unreachable) {
    problems.push(problem(`host-unreachable:${m.name}`, m.roles.includes(SOURCE_ROLE) ? 'critical' : 'warning',
      `Не отвечает ${label(m.name)}`,
      `Сторож не может зайти на ${label(m.name)} (${m.name}). Сервер выключен, завис или пропала сеть до него.`))
  }

  for (const m of members) {
    const data = probes[m.name]?.ok ? probes[m.name].data : null
    if (!data) continue
    const disk = data.disk?.usedPercent
    if (Number.isFinite(disk) && disk >= LIMITS.diskWarnPercent) {
      problems.push(problem(`disk:${m.name}`, disk >= LIMITS.diskCriticalPercent ? 'critical' : 'warning',
        `Кончается диск: ${label(m.name)}`, `Диск занят на ${disk}%. Когда он заполнится, ${m.roles.includes(SOURCE_ROLE) ? 'база и сайт остановятся' : 'Kafka на этом сервере остановится'}.`))
    }
    // A peer that is down itself is already reported; a lost link between two
    // live hosts is not, so only that counts here.
    const silent = (data.tunnel?.stalePeers ?? []).filter((address) => !downAddresses.has(address))
    if (silent.length) {
      problems.push(problem(`tunnel:${m.name}`, 'warning', `Связь между серверами: ${label(m.name)}`,
        `У ${label(m.name)} нет связи с ${silent.length} из ${data.tunnel.peers} серверов кластера дольше ${LIMITS.tunnelStaleSeconds / 60} минут, хотя они сами отвечают.`))
    }
    if (Number.isFinite(data.cert?.daysLeft) && data.cert.daysLeft < LIMITS.certWarnDays) {
      problems.push(problem(`cert:${m.name}`, data.cert.daysLeft < 7 ? 'critical' : 'warning', `Истекает сертификат: ${label(m.name)}`,
        `Сертификат узла истекает через ${data.cert.daysLeft} дн. После этого он перестанет связываться с остальными.`))
    }
    for (const c of data.containers ?? []) {
      if (c.state !== 'running') {
        problems.push(problem(`container:${m.name}:${c.name}`, 'warning', `Остановлен процесс: ${label(m.name)}`,
          `Процесс ${c.name} на ${label(m.name)} не работает (состояние: ${c.state}).`))
      }
    }
    if (m.roles.includes('connect')) {
      if (!data.connect?.ok) {
        problems.push(problem(`connect-down:${m.name}`, 'warning', `Не отвечает ${label(m.name)}`,
          `Kafka Connect на ${label(m.name)} не отвечает. Пока работает второй переносчик, события идут через него.`))
      }
      if (data.registry && !data.registry.ok) {
        problems.push(problem(`registry-down:${m.name}`, 'warning', `Не отвечает реестр схем: ${label(m.name)}`,
          `Реестр схем на ${label(m.name)} не отвечает.`))
      }
    }
    if (m.roles.includes(SOURCE_ROLE)) problems.push(...sourceProblems(data.source))
  }

  problems.push(...connectorProblems(members.filter((m) => m.roles.includes('connect')).map((m) => probes[m.name]).filter((p) => p?.ok)))
  problems.push(...clusterProblems({ clusterView, ids, label }))
  return problems
}

function sourceProblems(source) {
  if (!source) return [problem('slot-unknown', 'warning', 'Не видно слот CDC', 'Сторож не смог прочитать состояние слота репликации в базе прода.')]
  const slot = source.slots?.find((s) => s.name === source.expectedSlot)
  if (!slot) {
    return [problem('slot-missing', 'critical', 'Пропал слот CDC в базе прода',
      `Слота ${source.expectedSlot} нет. События из базы в Kafka больше не уходят, переносчик придётся запускать заново.`)]
  }
  const out = []
  if (slot.walStatus === 'lost') {
    out.push(problem('slot-lost', 'critical', 'База выбросила слот CDC',
      'База удалила журнал, который держал слот, чтобы не переполнить диск. События за это время в Kafka не попали; нужен новый снимок outbox.'))
    return out
  }
  if (slot.walStatus === 'unreserved') {
    out.push(problem('slot-unreserved', 'critical', 'Слот CDC на грани потери',
      `Слот держит ${mb(slot.retainedBytes)} журнала и вышел за предел. База скоро его выбросит.`))
  } else if (slot.retainedBytes >= LIMITS.slotRetainedWarnBytes) {
    out.push(problem('slot-retained', slot.retainedBytes >= LIMITS.slotRetainedCriticalBytes ? 'critical' : 'warning',
      'Слот CDC копит журнал базы',
      `Слот держит на диске прода ${mb(slot.retainedBytes)} журнала${Number.isFinite(slot.safeBytes) ? `; до потери слота осталось ${mb(slot.safeBytes)}` : ''}. Значит, переносчик не подтверждает прочитанное.`))
  }
  if (!slot.active) {
    out.push(problem('slot-inactive', 'critical', 'События из базы не уходят в Kafka',
      'К слоту CDC никто не подключён: переносчик событий не читает базу. Новые события копятся в базе и уйдут, когда он вернётся.'))
  }
  return out
}

// Connect workers share one cluster state, so any worker that answered tells
// the status of every connector. None answering is already reported per host.
function connectorProblems(connectProbes) {
  const answered = connectProbes.find((p) => p.data.connect?.ok && p.data.connect.connectors)
  if (!answered) return []
  const seen = answered.data.connect.connectors
  const out = []
  for (const name of answered.data.connect.expected ?? []) {
    const status = seen[name]?.status
    if (!status) {
      out.push(problem(`connector-missing:${name}`, 'critical', 'Нет переносчика событий', `Коннектор ${name} не зарегистрирован в Kafka Connect.`))
      continue
    }
    const bad = [{ id: 'connector', state: status.connector?.state }, ...(status.tasks ?? []).map((t) => ({ id: `task ${t.id}`, state: t.state }))]
      .filter((x) => x.state !== 'RUNNING')
    if (bad.length || !(status.tasks ?? []).length) {
      out.push(problem(`connector-state:${name}`, 'critical', 'Переносчик событий остановился',
        `Коннектор ${name}: ${bad.map((b) => `${b.id} ${b.state ?? 'нет'}`).join(', ') || 'нет задач'}. События из базы в Kafka не уходят.`))
    }
  }
  return out
}

// The cluster part alone, for drill.sh: it feeds real Kafka output taken
// while sites are down and checks what the watch would say.
export function clusterHealth(topology, clusterView) {
  const primary = topology.clusters.find((c) => c.name === 'primary')
  const byName = new Map(primary.hosts.map((h) => [h.name, h]))
  return clusterProblems({ clusterView, ids: nodeIds(primary), label: (name) => hostLabel(byName.get(name)) })
}

function clusterProblems({ clusterView, ids, label }) {
  if (!clusterView) {
    return [problem('cluster-unreachable', 'critical', 'Kafka не отвечает', 'Ни один брокер не ответил на проверку кластера.')]
  }
  const out = []
  const status = parseQuorumStatus(clusterView.data.status ?? '')
  const replication = parseQuorumReplication(clusterView.data.replication ?? '')
  const controllers = [...ids].filter(([, id]) => id < 100)
  const brokers = [...ids].filter(([, id]) => id >= 100)
  if (status.leaderId === null) {
    out.push(problem('quorum-leader', 'critical', 'У Kafka нет ведущего контроллера', 'Контроллеры не выбрали ведущего: кластер не может менять метаданные.'))
  }
  const leaderRow = replication.find((r) => r.status === 'Leader')
  const fresh = (row) => row && leaderRow && leaderRow.lastFetch - row.lastFetch <= LIMITS.fetchStaleMs
  for (const [name, id] of controllers) {
    const row = replication.find((r) => r.nodeId === id)
    if (!status.voters.includes(id) || !(row?.status === 'Leader' || fresh(row))) {
      out.push(problem(`controller:${name}`, 'warning', `Выпал ${label(name)}`,
        `Контроллер ${name} не участвует в кворуме. Кластер работает на двух из трёх; ещё одна потеря остановит его.`))
    }
  }
  for (const [name, id] of brokers) {
    const row = replication.find((r) => r.nodeId === id)
    if (!fresh(row)) {
      out.push(problem(`broker:${name}`, 'warning', `Выпал ${label(name)}`,
        `Брокер ${name} не на связи с контроллерами. Запись идёт на два оставшихся; ещё одна потеря остановит запись.`))
    }
  }
  const { minIsr, partitions } = parseTopics(clusterView.data.topics ?? '')
  // render.mjs sets the broker default from the catalog default.
  const brokerMinIsr = Number(loadCatalog().defaults.config['min.insync.replicas'])
  const need = (p) => minIsr[p.topic] ?? brokerMinIsr
  if (!partitions.length) {
    out.push(problem('topics-unreadable', 'warning', 'Не видно темы Kafka', 'Проверка не получила список партиций от брокера.'))
    return out
  }
  const offline = partitions.filter((p) => p.leader === null)
  const belowMin = partitions.filter((p) => p.leader !== null && p.isr.length < need(p))
  const under = partitions.filter((p) => p.leader !== null && p.isr.length >= need(p) && p.isr.length < p.replicas.length)
  const topicsOf = (list) => [...new Set(list.map((p) => p.topic))]
  const sample = (list) => { const t = topicsOf(list); return t.slice(0, 3).join(', ') + (t.length > 3 ? ` и ещё ${t.length - 3}` : '') }
  if (offline.length) {
    out.push(problem('partitions-offline', 'critical', 'Часть данных Kafka недоступна',
      `${offline.length} партиций без ведущей реплики (${sample(offline)}): их нельзя ни читать, ни писать.`))
  }
  if (belowMin.length) {
    out.push(problem('partitions-below-min-isr', 'critical', 'Kafka отказывает в записи',
      `${belowMin.length} партиций живы меньше чем на двух серверах (${sample(belowMin)}): запись в них отклоняется.`))
  }
  if (under.length) {
    out.push(problem('partitions-under-replicated', 'warning', 'Не все копии данных Kafka на месте',
      `${under.length} из ${partitions.length} партиций держатся не на всех трёх серверах (${sample(under)}). Данные целы, но запас прочности меньше.`))
  }
  return out
}

// One-line figures for the weekly "still alive" message.
export function summary({ probes, topology, cluster: clusterView }) {
  const source = probes[topology.sourceHost.name]?.ok ? probes[topology.sourceHost.name].data.source : null
  const slot = source?.slots?.find((s) => s.name === source.expectedSlot)
  const partitions = clusterView ? parseTopics(clusterView.data.topics ?? '').partitions.length : 0
  const parts = []
  if (partitions) parts.push(`${partitions} партиций на трёх площадках`)
  if (slot) parts.push(`слот CDC держит ${mb(slot.retainedBytes)} журнала`)
  return parts.join(', ')
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'cluster') {
  // health.mjs cluster STATUS REPLICATION TOPICS -> "id severity" per cluster problem
  const [status, replication, topics] = process.argv.slice(3, 6).map((f) => readFileSync(f, 'utf8'))
  for (const p of clusterHealth(loadTopology(), { data: { status, replication, topics } })) console.log(`${p.id} ${p.severity}`)
}
