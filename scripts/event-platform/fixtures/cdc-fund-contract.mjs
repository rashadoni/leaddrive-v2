/** Pure disposable full-chain target guards. No activation or I/O here. */
import assert from 'node:assert/strict'
import { renderTestConnector } from '../cdc-fixture.mjs'

export const FULL_CDC_CONNECTOR = 'leaddrive-event-outbox-test-fund'
export const FULL_CDC_SLOT = 'leaddrive_event_outbox_test_fund'
export const FULL_CDC_TOPIC = 'ld.testbroker.finance.events.v1'
export const POSTGRES_IMAGE = 'postgres:16.13-alpine@sha256:4941ef97aaa2633ce9808f7766f8b8d746dd039ce8c51ca6da185c3dc63ab579'

export function assertFullCdcEnvironment(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'disposable GitHub job required')
  assert.equal(env.LD_EVENT_STACK_DISPOSABLE, '1', 'disposable GitHub job required')
  assert.equal(env.LD_EVENT_STACK_FULL_CDC_FUND, '1', 'full CDC Fund opt-in required')
  assert.equal(env.FUND_SHADOW_DB_GATE, 'required', 'required database gate required')
  const project = env.LD_EVENT_STACK_PROJECT ?? ''
  assert.match(project, /^ld-event-test-[a-z0-9][a-z0-9-]{0,40}$/)
  assert.doesNotMatch(project, /[\r\n]/)
}

export function assertScratchDatabase(database) {
  assert.match(database, /^ld_fund_shadow_[1-9][0-9]*_[0-9a-f]{12}$/)
  assert.doesNotMatch(database, /[\r\n]/)
  return database
}

export function renderFullCdcConnector(template, database) {
  assertScratchDatabase(database)
  // Reuse the reviewed production serializer and its complete allowlist first.
  const connector = renderTestConnector(template, { mode: 'raw' })
  connector.name = FULL_CDC_CONNECTOR
  Object.assign(connector.config, {
    'topic.prefix': 'ld.testbroker.cdc-source-fund',
    'database.dbname': database,
    'slot.name': FULL_CDC_SLOT,
    'transforms.outbox.route.topic.replacement': 'ld.testbroker.$1.events.v1',
  })
  return connector
}

export function renderFullCdcBoundary(source, database) {
  assertScratchDatabase(database)
  const guard = "current_database() <> 'event_platform_test'"
  assert.equal(source.split(guard).length, 2, 'exact existing disposable database guard required')
  const anchors = `IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('organizations', 'funds')
         AND c.relkind = 'r' AND c.relowner = app_oid) <> 2 THEN
    RAISE EXCEPTION 'Fixture organizations and funds anchors must be app-owned';
  END IF;`
  assert.equal(source.split(anchors).length, 2, 'exact transport-only anchor ownership assertion required')
  // The actual Fund migration deliberately transfers funds away from its
  // legacy app owner. Require that stronger owner/RLS boundary, not the old
  // transport-only schema. Every effective CDC privilege assertion is retained.
  const fundAnchors = `IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'organizations'
         AND c.relkind = 'r' AND c.relowner = app_oid) <> 1
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'funds'
         AND c.relkind = 'r' AND c.relowner = migrator_oid AND c.relrowsecurity AND c.relforcerowsecurity) <> 1 THEN
    RAISE EXCEPTION 'Full Fund fixture requires app organizations and migration-owned FORCE RLS funds';
  END IF;`
  return source.replace(guard, `current_database() <> '${database}'`).replace(anchors, fundAnchors)
}

export function assertPrivatePostgresTarget({ project, config, container, network }) {
  assert.match(project, /^ld-event-test-[a-z0-9][a-z0-9-]{0,40}$/)
  assert.doesNotMatch(project, /[\r\n]/)
  assert.equal(config.services.postgres.image, POSTGRES_IMAGE)
  assert.equal(config.services.postgres.environment.POSTGRES_DB, 'event_platform_test')
  assert.equal(config.services.postgres.environment.POSTGRES_USER, 'event_test')
  for (const service of Object.values(config.services)) {
    assert.equal((service.ports ?? []).length, 0, 'published ports forbidden')
    assert.ok((service.volumes ?? []).every(volume => volume.type !== 'bind'), 'host bind mounts forbidden')
  }
  assert.ok(Object.values(config.networks).length > 0)
  assert.ok(Object.values(config.networks).every(value => value.internal === true))
  assert.equal(container.Config.Image, POSTGRES_IMAGE)
  assert.equal(container.Config.Labels['com.docker.compose.project'], project)
  assert.equal(container.Config.Labels['com.docker.compose.service'], 'postgres')
  assert.equal(container.State.Running, true)
  assert.equal(container.HostConfig.NetworkMode, `${project}_default`)
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {})
  assert.ok((container.Mounts ?? []).every(mount => mount.Type === 'volume'))
  assert.equal(network.Internal, true)
  assert.equal(network.Name, `${project}_default`)
  assert.equal(network.Labels['com.docker.compose.project'], project)
  assert.equal(network.Labels['com.docker.compose.network'], 'default')
  const entries = Object.entries(container.NetworkSettings.Networks)
  assert.equal(entries.length, 1)
  const [name, attachment] = entries[0]
  assert.equal(name, network.Name)
  assert.equal(attachment.NetworkID, network.Id)
  assert.equal(network.Containers[container.Id]?.IPv4Address?.split('/')[0], attachment.IPAddress)
  const octets = attachment.IPAddress.split('.').map(Number)
  assert.equal(octets.length, 4)
  assert.ok(octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255))
  assert.ok(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168), 'private Docker IPv4 required')
  return attachment.IPAddress
}
