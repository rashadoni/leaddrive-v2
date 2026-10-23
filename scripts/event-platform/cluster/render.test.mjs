import assert from 'node:assert/strict'
import test from 'node:test'
import { expandCatalog, loadCatalog, loadTopology, nodeIds, renderCluster } from './render.mjs'

const topology = loadTopology()
const catalog = loadCatalog()
const clusterId = 'MkU3OEVBNTcwNTJENDM2Qk'

function inventoryFor(clusterName) {
  const hosts = {}
  for (const host of topology.clusters.find((c) => c.name === clusterName).hosts) hosts[host.name] = { address: host.name }
  return { clusterId, hosts }
}

function parse(text) {
  return Object.fromEntries(text.trim().split('\n').map((line) => {
    const at = line.indexOf('=')
    return [line.slice(0, at), line.slice(at + 1)]
  }))
}

test('catalog expands to the 86 governed topics with effective safety configs', () => {
  const topics = expandCatalog(catalog, 'prod')
  assert.equal(topics.length, 86)
  assert.equal(new Set(topics.map((t) => t.name)).size, 86)
  assert.equal(topics.reduce((sum, t) => sum + t.partitions, 0), 1416)
  for (const topic of topics) {
    assert.match(topic.name, /^ld\.prod\./)
    assert.equal(topic.replicationFactor, 3)
    assert.equal(topic.config['min.insync.replicas'], '2')
    assert.equal(topic.config['unclean.leader.election.enable'], 'false')
  }
  const finance = topics.find((t) => t.name === 'ld.prod.finance.events.v1')
  assert.equal(finance.config['retention.ms'], '7776000000')
  assert.throws(() => expandCatalog(catalog, 'Prod'))
})

test('every broker and controller gets mTLS, a deny-by-default authorizer and its site as rack', () => {
  const files = renderCluster({ topology, catalog, clusterName: 'primary', inventory: inventoryFor('primary') })
  const cluster = topology.clusters.find((c) => c.name === 'primary')
  const ids = nodeIds(cluster)
  const voters = parse(files['kafka-p-ctrl-eu/server.properties'])['controller.quorum.voters']
  assert.equal(voters, 'kafka-p-ctrl-eu:9093'.replace(/^/, '1@') + ',2@kafka-p-ctrl-uk:9093,3@kafka-p-ctrl-gra:9093')

  for (const host of cluster.hosts.filter((h) => h.roles.includes('broker') || h.roles.includes('controller'))) {
    const props = parse(files[`${host.name}/server.properties`])
    assert.equal(props['node.id'], String(ids.get(host.name)))
    assert.equal(props['controller.quorum.voters'], voters)
    assert.equal(props['allow.everyone.if.no.acl.found'], 'false')
    assert.equal(props['authorizer.class.name'], 'org.apache.kafka.metadata.authorizer.StandardAuthorizer')
    assert.equal(props['ssl.enabled.protocols'], 'TLSv1.3')
    assert.equal(props['ssl.endpoint.identification.algorithm'], 'https')
    assert.ok(!Object.values(props).some((v) => /PLAINTEXT|SASL_PLAINTEXT/.test(v)), `${host.name}: no plaintext listener`)
    assert.ok(props['super.users'].split(';').includes(`User:${host.name}`))
    assert.match(files[`${host.name}/kafka.env`], new RegExp(`^CLUSTER_ID=${clusterId}$`, 'm'))
    assert.match(files[`${host.name}/compose.yml`], /network_mode: host/)
    if (host.roles.includes('broker')) {
      assert.equal(props['process.roles'], 'broker')
      assert.equal(props['broker.rack'], host.site)
      assert.equal(props['listener.security.protocol.map'], 'CLIENT:SASL_SSL,REPLICATION:SSL,CONTROLLER:SSL')
      assert.equal(props['listener.name.replication.ssl.client.auth'], 'required')
      assert.equal(props['auto.create.topics.enable'], 'false')
      assert.equal(props['unclean.leader.election.enable'], 'false')
      assert.equal(props['min.insync.replicas'], '2')
      assert.equal(props['transaction.state.log.min.isr'], '2')
      assert.equal(props['offsets.topic.replication.factor'], '3')
    } else {
      assert.equal(props['process.roles'], 'controller')
      assert.equal(props['listener.security.protocol.map'], 'CONTROLLER:SSL')
      assert.equal(props['ssl.client.auth'], 'required')
      assert.equal(props.listeners, `CONTROLLER://${host.name}:9093`)
    }
  }
  // Connect/Registry hosts are not Kafka nodes.
  assert.ok(!files['kafka-p-connect-eu/server.properties'])
})

test('DR cluster renders as its own quorum and the inventory is validated', () => {
  const files = renderCluster({ topology, catalog, clusterName: 'dr', inventory: { ...inventoryFor('dr'), clusterId: 'AbCdEfGhIjKlMnOpQrStUv' } })
  assert.equal(parse(files['kafka-d-ctrl-1/server.properties'])['controller.quorum.voters'],
    '1@kafka-d-ctrl-1:9093,2@kafka-d-ctrl-2:9093,3@kafka-d-ctrl-3:9093')
  assert.throws(() => renderCluster({ topology, catalog, clusterName: 'primary', inventory: { clusterId: 'short', hosts: {} } }), /clusterId/)
  const missing = inventoryFor('primary')
  delete missing.hosts['kafka-p-broker-gra']
  assert.throws(() => renderCluster({ topology, catalog, clusterName: 'primary', inventory: missing }), /kafka-p-broker-gra/)
  const injected = inventoryFor('primary')
  injected.hosts['kafka-p-broker-gra'].address = 'x\nallow.everyone.if.no.acl.found=true'
  assert.throws(() => renderCluster({ topology, catalog, clusterName: 'primary', inventory: injected }), /usable address/)
})

test('heap follows the plan and scales down only for the disposable drill', () => {
  const full = renderCluster({ topology, catalog, clusterName: 'primary', inventory: inventoryFor('primary') })
  assert.match(full['kafka-p-broker-eu/kafka.env'], /-Xmx4096m/)
  assert.match(full['kafka-p-ctrl-gra/kafka.env'], /-Xmx1024m/)
  assert.match(full['kafka-p-broker-uk/kafka.env'], /-Xmx3072m/, 'an 8 GB broker keeps 5 GB for page cache')
  assert.match(full['kafka-p-broker-gra/kafka.env'], /-Xmx1536m/, 'a 4 GB stopgap broker keeps 2.5 GB for page cache')
  assert.match(full['kafka-p-ctrl-eu/kafka.env'], /-Xmx1024m/, 'controllers get 1 GB whatever the plan')
  const drill = renderCluster({ topology, catalog, clusterName: 'primary', inventory: inventoryFor('primary'), heapScale: 0.125 })
  assert.match(drill['kafka-p-broker-eu/kafka.env'], /-Xmx512m/)
  assert.match(drill['kafka-p-ctrl-gra/kafka.env'], /-Xmx256m/)
})
