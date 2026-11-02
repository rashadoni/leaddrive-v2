import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// The planned host map must satisfy the production baseline in
// KAFKA_EVENT_SOURCING_ARCHITECTURE.md §13 before anything is ordered, so a
// cheaper layout cannot quietly collapse roles or failure domains.
const root = fileURLToPath(new URL('../../', import.meta.url))
const topology = JSON.parse(readFileSync(`${root}ops/event-platform/topology.v1.json`, 'utf8'))
const catalog = JSON.parse(readFileSync(`${root}ops/event-platform/topics.v1.json`, 'utf8'))

const sites = new Map(topology.sites.map((site) => [site.id, site]))
const cluster = (name) => topology.clusters.find((c) => c.name === name)
const withRole = (hosts, role) => hosts.filter((host) => host.roles.includes(role))
const sitesOf = (hosts) => new Set(hosts.map((host) => host.site))

function assertQuorumCluster(name) {
  const { hosts } = cluster(name)
  const brokers = withRole(hosts, 'broker')
  const controllers = withRole(hosts, 'controller')
  assert.ok(brokers.length >= 3, `${name}: at least three brokers`)
  assert.ok(controllers.length >= 3 && controllers.length % 2 === 1, `${name}: odd controller quorum of at least three`)
  for (const host of hosts) {
    assert.ok(!(host.roles.includes('broker') && host.roles.includes('controller')), `${host.name}: KRaft roles must be separate`)
  }
  return { hosts, brokers, controllers }
}

test('every host names a declared site and a unique name', () => {
  const all = [...topology.clusters.flatMap((c) => c.hosts), ...topology.monitoring]
  assert.equal(new Set(all.map((host) => host.name)).size, all.length)
  for (const host of all) assert.ok(sites.has(host.site), `${host.name}: unknown site ${host.site}`)
  assert.ok(sites.has(topology.sourceHost.site))
})

test('primary cluster survives the loss of any one site', () => {
  const { hosts, brokers, controllers } = assertQuorumCluster('primary')
  const rf = catalog.defaults.replicationFactor
  const minIsr = Number(catalog.defaults.config['min.insync.replicas'])
  assert.ok(sitesOf(brokers).size >= rf, 'replicas of one partition need a distinct site each')
  assert.ok(sitesOf(controllers).size >= 3, 'controllers span three sites')
  for (const site of sitesOf(hosts)) {
    const lostBrokers = brokers.filter((host) => host.site === site).length
    const lostControllers = controllers.filter((host) => host.site === site).length
    assert.ok(brokers.length - lostBrokers >= minIsr, `losing ${site} must keep min.insync.replicas`)
    assert.ok(controllers.length - lostControllers > controllers.length / 2, `losing ${site} must keep controller quorum`)
  }
  const connect = withRole(hosts, 'connect')
  assert.ok(connect.length >= 2 && sitesOf(connect).size >= 2, 'Connect workers are spread over two sites')
  assert.ok(hosts.every((host) => host.name !== topology.sourceHost.name), 'nothing runs on the web/PostgreSQL host')
})

test('DR cluster is a full quorum outside every primary site', () => {
  const primarySites = sitesOf(cluster('primary').hosts)
  const { hosts } = assertQuorumCluster('dr')
  for (const site of sitesOf(hosts)) assert.ok(!primarySites.has(site), `DR site ${site} is also a primary site`)
  assert.ok(withRole(hosts, 'mirror').length >= 1, 'DR cluster has a mirroring worker')
})

test('alerts survive the loss of the production site and nothing listens publicly', () => {
  for (const host of topology.monitoring) assert.notEqual(host.site, topology.sourceHost.site)
  assert.equal(topology.network.overlay, 'wireguard')
  for (const key of ['publicKafkaListeners', 'publicRegistryListeners', 'publicConnectListeners']) {
    assert.equal(topology.network[key], false, key)
  }
})

test('event archive is immutable, long enough and off the Kafka providers', () => {
  const kafkaProviders = new Set([...sites.values()].map((site) => site.provider))
  assert.ok(!kafkaProviders.has(topology.archive.provider))
  assert.equal(topology.archive.objectLockMode, 'COMPLIANCE')
  assert.ok(topology.archive.objectLockDays >= 400)
})

test('a planned map carries no addresses or credentials', () => {
  assert.equal(topology.status, 'planned-not-ordered')
  const text = JSON.stringify(topology)
  assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no IPv4 addresses until hosts are ordered and verified')
  assert.doesNotMatch(text, /password|secret|BEGIN [A-Z ]*KEY/i)
})
