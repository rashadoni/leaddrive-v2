import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { loadTopology, meshMembers, renderHostNetwork } from './render.mjs'

const topology = loadTopology()
const members = meshMembers(topology)
const inventory = { hosts: {} }
members.forEach((m, i) => {
  inventory.hosts[m.name] = { address: `10.88.0.${i + 10}`, publicAddress: `192.0.2.${i + 10}`, wgPublicKey: randomBytes(32).toString('base64') }
})
const overlay = (name) => inventory.hosts[name].address
const render = (name) => renderHostNetwork({ topology, inventory, hostName: name })
const acceptsOn = (nft, port) => {
  const line = nft.split('\n').find((l) => l.includes(`tcp dport ${port} accept`))
  return line ? line.match(/\{ ([^}]*) \}/)[1].split(', ') : []
}

test('every member peers with every other member and never carries its private key', () => {
  for (const m of members) {
    const { 'wg0.conf': wg } = render(m.name)
    assert.equal((wg.match(/^\[Peer\]$/gm) ?? []).length, members.length - 1, m.name)
    assert.doesNotMatch(wg, /PrivateKey\s*=/)
    assert.match(wg, /^PostUp = wg set %i private-key \/etc\/wireguard\/ld-kafka\.key$/m)
    assert.match(wg, new RegExp(`^Address = ${overlay(m.name).replaceAll('.', '\\.')}/24$`, 'm'))
  }
})

test('Kafka hosts drop by default and open each port only to the roles that need it', () => {
  const broker = render('kafka-p-broker-eu')['nftables.conf']
  assert.match(broker, /policy drop;/)
  assert.deepEqual(acceptsOn(broker, 9094).sort(), ['kafka-p-broker-uk', 'kafka-p-broker-de'].map(overlay).sort())
  const clients = acceptsOn(broker, 9092)
  for (const name of ['kafka-p-connect-eu', 'kafka-p-connect-uk', 'kafka-d-mirror', 'kafka-monitor', 'leaddrive-prod']) assert.ok(clients.includes(overlay(name)), name)
  for (const name of ['kafka-p-ctrl-uk', 'kafka-d-broker-1', 'kafka-p-broker-uk']) assert.ok(!clients.includes(overlay(name)), name)
  assert.equal(acceptsOn(broker, 9093).length, 0, 'brokers do not listen as controllers')
  assert.equal(acceptsOn(broker, 5432).length, 0)

  const controller = render('kafka-p-ctrl-de')['nftables.conf']
  assert.deepEqual(acceptsOn(controller, 9093).sort(),
    ['kafka-p-ctrl-eu', 'kafka-p-ctrl-uk', 'kafka-p-broker-eu', 'kafka-p-broker-uk', 'kafka-p-broker-de'].map(overlay).sort(),
    'controller port is open only to the same cluster')
  assert.equal(acceptsOn(controller, 9092).length, 0)

  const dr = render('kafka-d-ctrl-1')['nftables.conf']
  assert.ok(!acceptsOn(dr, 9093).includes(overlay('kafka-p-broker-eu')), 'primary brokers cannot reach DR controllers')

  for (const name of ['kafka-p-broker-eu', 'kafka-p-ctrl-de', 'kafka-p-connect-uk']) {
    assert.deepEqual(acceptsOn(render(name)['nftables.conf'], 9100), [overlay('kafka-monitor')])
  }
  assert.match(broker, /udp dport 51820 ip saddr \{ [^}]*192\.0\.2\./)
})

test('the production host keeps its public services and only confines the overlay', () => {
  const nft = render('leaddrive-prod')['nftables.conf']
  assert.match(nft, /policy accept;/)
  assert.doesNotMatch(nft, /tcp dport (80|443|22) /)
  assert.deepEqual(acceptsOn(nft, 5432).sort(), ['kafka-p-connect-eu', 'kafka-p-connect-uk'].map(overlay).sort())
  assert.match(nft, /udp dport 51820 drop/)
  assert.match(nft, /iifname "wg0" drop\n  \}/)
  const ufw = render('leaddrive-prod')['ufw.sh']
  assert.equal((ufw.match(/port 51820 comment/g) ?? []).length, members.length - 1)
  assert.deepEqual([...ufw.matchAll(/from (\S+) to \S+ port 5432/g)].map((m) => m[1]).sort(),
    ['kafka-p-connect-eu', 'kafka-p-connect-uk'].map(overlay).sort())
  assert.doesNotMatch(ufw, /ufw (reset|disable|default)/)
  assert.ok(!render('kafka-p-broker-eu')['ufw.sh'], 'Kafka hosts use nftables only')
})

test('inventory errors are refused instead of rendered', () => {
  const bad = structuredClone(inventory)
  bad.hosts['kafka-p-broker-de'].wgPublicKey = 'not-a-key'
  assert.throws(() => renderHostNetwork({ topology, inventory: bad, hostName: 'kafka-p-broker-eu' }), /wgPublicKey/)
  const dup = structuredClone(inventory)
  dup.hosts['kafka-p-broker-de'].address = dup.hosts['kafka-p-broker-eu'].address
  assert.throws(() => renderHostNetwork({ topology, inventory: dup, hostName: 'kafka-p-broker-eu' }), /unique/)
  const publicOverlay = structuredClone(inventory)
  publicOverlay.hosts['kafka-p-broker-de'].address = '203.0.113.5'
  assert.throws(() => renderHostNetwork({ topology, inventory: publicOverlay, hostName: 'kafka-p-broker-eu' }), /10\.x/)
})
