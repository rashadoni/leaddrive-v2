import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadTopology, meshMembers } from './render.mjs'

const script = fileURLToPath(new URL('./provision.sh', import.meta.url))

test('render builds certs bound to overlay addresses, node files and the mesh from an inventory', () => {
  const state = mkdtempSync(path.join(tmpdir(), 'ld-kafka-state-'))
  try {
    const key = path.join(state, 'ops_key')
    writeFileSync(key, 'not used by render\n')
    const hosts = {}
    meshMembers(loadTopology()).forEach((m, i) => {
      if (m.roles.includes('source')) return
      hosts[m.name] = { address: `10.88.0.${10 + i}`, publicAddress: `192.0.2.${10 + i}`, wgPublicKey: randomBytes(32).toString('base64') }
    })
    writeFileSync(path.join(state, 'inventory.json'), JSON.stringify({ clusters: {}, hosts }))
    const env = { ...process.env, LD_KAFKA_STATE: state, LD_KAFKA_SSH_KEY: key }
    const run = spawnSync('bash', [script, 'render', 'primary'], { env, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)

    const inventory = JSON.parse(readFileSync(path.join(state, 'inventory.json'), 'utf8'))
    assert.match(inventory.clusters.primary.clusterId, /^[A-Za-z0-9_-]{22}$/)
    assert.equal(statSync(path.join(state, 'pki-primary/ca.key')).mode & 0o777, 0o600)
    const cert = spawnSync('openssl', ['x509', '-noout', '-ext', 'subjectAltName', '-in',
      path.join(state, 'pki-primary/issued/kafka-p-broker-de/node.pem')], { encoding: 'utf8' })
    assert.match(cert.stdout, new RegExp(`IP Address:${hosts['kafka-p-broker-de'].address.replaceAll('.', '\\.')}`))
    const props = readFileSync(path.join(state, 'rendered/primary/kafka-p-broker-de/server.properties'), 'utf8')
    assert.match(props, new RegExp(`^listeners=CLIENT://${hosts['kafka-p-broker-de'].address.replaceAll('.', '\\.')}:9092,`, 'm'))
    assert.match(props, /^broker\.rack=ovh-de$/m)
    for (const name of ['kafka-p-broker-eu', 'kafka-p-connect-uk', 'kafka-monitor', 'kafka-d-mirror']) {
      assert.ok(existsSync(path.join(state, `rendered/network/${name}/nftables.conf`)), name)
    }
    assert.ok(!existsSync(path.join(state, 'rendered/network/leaddrive-prod')), 'production host is absent until it is enrolled')

    // A second render keeps the CA, the cluster id and the issued certificates.
    const before = readFileSync(path.join(state, 'pki-primary/issued/kafka-p-broker-de/node.pem'), 'utf8')
    assert.equal(spawnSync('bash', [script, 'render', 'primary'], { env, encoding: 'utf8' }).status, 0)
    assert.equal(readFileSync(path.join(state, 'pki-primary/issued/kafka-p-broker-de/node.pem'), 'utf8'), before)
    assert.equal(JSON.parse(readFileSync(path.join(state, 'inventory.json'), 'utf8')).clusters.primary.clusterId, inventory.clusters.primary.clusterId)

    const refused = spawnSync('bash', [script, 'bootstrap', 'leaddrive-prod', '192.0.2.1'], { env, encoding: 'utf8' })
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /not bootstrapped here/)
  } finally {
    rmSync(state, { recursive: true, force: true })
  }
})
