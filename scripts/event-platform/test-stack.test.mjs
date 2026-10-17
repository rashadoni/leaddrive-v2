import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const composeFile = fileURLToPath(new URL('../../ops/event-platform/test/compose.yml', import.meta.url))
const script = fileURLToPath(new URL('./test-stack.sh', import.meta.url))

test('disposable topology is bounded, private and independent of production', () => {
  const config = JSON.parse(execFileSync('docker', ['compose', '-p', 'ld-event-test-validation',
    '-f', composeFile, 'config', '--format', 'json'], { encoding: 'utf8' }))
  assert.deepEqual(Object.keys(config.services).sort(), ['connect', 'kafka', 'postgres', 'registry'])
  let memory = 0
  for (const [name, service] of Object.entries(config.services)) {
    assert.match(service.image, /@sha256:[a-f0-9]{64}$/)
    assert.equal(service.platform, 'linux/amd64')
    assert.notEqual(service.privileged, true)
    assert.notEqual(service.network_mode, 'host')
    assert.equal(service.restart ?? 'no', 'no')
    assert.ok(Number.isSafeInteger(Number(service.mem_limit)) && Number(service.mem_limit) > 0, name + ' requires a memory cap')
    memory += Number(service.mem_limit)
    for (const volume of service.volumes ?? []) {
      assert.notEqual(volume.type, 'bind', name + ' must not mount host files or credentials')
    }
    for (const port of service.ports ?? []) {
      assert.ok(['connect', 'registry'].includes(name))
      assert.equal(port.host_ip, '127.0.0.1')
      assert.ok(!port.published || port.published === '0', 'host ports must be allocated per run')
    }
    assert.ok(Object.keys(service.networks ?? {}).length > 0)
  }
  assert.ok(memory <= 3 * 1024 ** 3, 'test stack exceeds the agreed memory budget')
  assert.ok(Object.values(config.networks).every(network => network.internal === true))
  assert.equal(config.services.kafka.environment.KAFKA_AUTO_CREATE_TOPICS_ENABLE, 'false')
  assert.equal(config.services.postgres.environment.POSTGRES_DB, 'event_platform_test')
  assert.equal(config.services.postgres.environment.POSTGRES_USER, 'event_test')
  assert.equal(config.services.connect.environment.CONFIG_STORAGE_TOPIC, 'ld.test.connect.config')
  assert.equal(config.services.connect.environment.OFFSET_STORAGE_TOPIC, 'ld.test.connect.offset')
  assert.equal(config.services.connect.environment.STATUS_STORAGE_TOPIC, 'ld.test.connect.status')
})

test('test stack refuses ordinary host execution before contacting Docker', () => {
  const result = spawnSync('bash', [script], { encoding: 'utf8',
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'false' } })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /explicitly disposable GitHub job/)
})

test('test stack refuses a broad or existing application project name', () => {
  for (const project of ['leaddrive', 'production', '../anything', 'ld-event-test-']) {
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: {
      PATH: process.env.PATH, GITHUB_ACTIONS: 'true', LD_EVENT_STACK_DISPOSABLE: '1', LD_EVENT_STACK_PROJECT: project,
    } })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /isolated test-project name/)
  }
})
