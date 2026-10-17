import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  FIXTURE, FIXTURE_PHASES, FIXTURE_TENANTS, CONNECTOR_MODES,
  TEST_CONNECTOR_CONFIG_CHANGES, bootstrapSql, fixtureEvents, phaseSql,
  renderTestConnector, fixtureKafkaTopic, sqlQuote,
} from './cdc-fixture.mjs'

const templateText = readFileSync(new URL('../../ops/event-platform/debezium/event-outbox-connector.template.json', import.meta.url), 'utf8')
const template = JSON.parse(templateText)
const envelopeSchema = JSON.parse(readFileSync(new URL('../../docs/event-platform/event-envelope-v1.schema.json', import.meta.url), 'utf8'))

test('two tenant-isolated keys have four deterministic versions and distinct outbox/event IDs', () => {
  const events = FIXTURE_PHASES.flatMap(fixtureEvents)
  assert.equal(events.length, 8)
  assert.equal(new Set(events.map(event => event.eventId)).size, 8)
  assert.equal(new Set(events.map(event => event.outboxId)).size, 8)
  assert.equal(new Set(events.map(event => event.headId)).size, 2)
  assert.equal(new Set(events.map(event => event.partitionKey)).size, 2)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
  for (const tenant of FIXTURE_TENANTS) {
    const stream = events.filter(event => event.organizationId === tenant)
    assert.deepEqual(stream.map(event => event.aggregateVersion), [1, 2, 3, 4])
    assert.deepEqual([...stream].sort((a, b) => a.eventId.localeCompare(b.eventId)).map(event => event.aggregateVersion), [4, 3, 2, 1])
    assert.deepEqual([...stream].sort((a, b) => a.outboxId.localeCompare(b.outboxId)).map(event => event.aggregateVersion), [4, 3, 2, 1])
    for (const event of stream) {
      assert.match(event.eventId, uuid)
      assert.match(event.outboxId, uuid)
      assert.match(event.headId, uuid)
      assert.notEqual(event.eventId, event.outboxId)
      assert.equal(event.partitionKey, `${tenant}:${event.aggregateType}:${event.aggregateId}`)
    }
  }
  assert.deepEqual(events, FIXTURE_PHASES.flatMap(fixtureEvents))
  const changed = fixtureEvents('snapshot')
  changed[0].envelope.data.nested.empty.push('mutation')
  assert.deepEqual(fixtureEvents('snapshot')[0].envelope.data.nested.empty, [])
})

test('envelopes carry coherent source fields and hard JSON parity cases', () => {
  for (const event of FIXTURE_PHASES.flatMap(fixtureEvents)) {
    const e = event.envelope
    assert.equal(e.id, event.eventId)
    assert.equal(e.type, event.eventType)
    assert.match(e.type, /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$/)
    assert.equal(event.topic, `leaddrive.domain.${e.type.split('.')[0]}.v1`)
    assert.equal(e.specversion, '1.0')
    assert.equal(e.time, event.occurredAt)
    assert.equal(new Date(e.time).toISOString(), event.occurredAt)
    assert.equal(e.organizationid, event.organizationId)
    assert.equal(e.aggregateid, event.aggregateId)
    assert.equal(e.aggregatetype, event.aggregateType)
    assert.equal(e.aggregateversion, event.aggregateVersion)
    assert.equal(e.datacontenttype, 'application/json')
    assert.equal(Object.hasOwn(e, 'causationid'), false)
    assert.equal(Object.hasOwn(e, 'traceparent'), false)
    assert.equal(Object.hasOwn(e, 'subjectref'), false)
    assert.equal(e.data.nullable, null)
    assert.equal(e.data.disabled, false)
    assert.equal(e.data.zero, 0)
    assert.deepEqual(e.data.empty, [])
    assert.deepEqual(e.data.nested.empty, [])
    assert.deepEqual(e.data.nested.objects[0].empty, [])
    assert.match(e.data.text, /Привет.*Bakı.*東京/)
    assert.match(e.data.text, /O'Reilly \\ line\nnext/)
    assert.equal(e.data.fixture, 'synthetic-transport-only')
    assert.deepEqual(JSON.parse(JSON.stringify(e)), e)
    assert.equal(Object.hasOwn(event, 'payloadHash'), false, 'only PostgreSQL computes the source hash')
  }
})

test('fixture obeys the checked-in envelope top-level contract, not merely SQL coherence', () => {
  for (const { envelope } of FIXTURE_PHASES.flatMap(fixtureEvents)) {
    for (const name of envelopeSchema.required) assert.ok(Object.hasOwn(envelope, name), name)
    for (const [name, value] of Object.entries(envelope)) {
      assert.ok(Object.hasOwn(envelopeSchema.properties, name), name)
      const property = envelopeSchema.properties[name]
      const rule = property.$ref ? envelopeSchema.$defs[property.$ref.split('/').at(-1)] : property
      if (rule.const !== undefined) assert.equal(value, rule.const, name)
      if (rule.type === 'string') assert.equal(typeof value, 'string', name)
      if (rule.type === 'integer') assert.ok(Number.isSafeInteger(value), name)
      if (rule.type === 'object') assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), name)
      if (rule.minimum !== undefined) assert.ok(value >= rule.minimum, name)
      if (rule.minLength !== undefined) assert.ok(value.length >= rule.minLength, name)
      if (rule.maxLength !== undefined) assert.ok(value.length <= rule.maxLength, name)
      if (rule.pattern) assert.match(value, new RegExp(rule.pattern), name)
      if (rule.enum) assert.ok(rule.enum.includes(value), name)
      if (rule.format === 'uuid') assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/, name)
      if (rule.format === 'date-time') assert.equal(new Date(value).toISOString(), value, name)
      if (rule.format === 'uri-reference') assert.doesNotThrow(() => new URL(value), name)
    }
  }
})

test('bootstrap creates only prerequisite anchors and the non-superuser role split', () => {
  const sql = bootstrapSql()
  assert.match(sql, /current_database\(\) <> E'event_platform_test'/)
  assert.match(sql, /current_user <> E'event_test'/)
  assert.match(sql, /NOT \(SELECT rolsuper/)
  assert.match(sql, /requires an empty disposable database/)
  assert.deepEqual([...sql.matchAll(/CREATE TABLE public\.(\w+)/g)].map(match => match[1]), ['organizations', 'funds'])
  assert.match(sql, /CREATE ROLE event_app[^;]*NOSUPERUSER[^;]*NOBYPASSRLS/)
  assert.match(sql, /CREATE ROLE event_migrator[^;]*NOSUPERUSER[^;]* BYPASSRLS/)
  assert.match(sql, /GRANT event_app TO event_migrator;/)
  assert.ok(sql.indexOf('SET LOCAL ROLE event_app;') < sql.indexOf('CREATE TABLE public.organizations'))
  assert.match(sql, /Ownership anchor ONLY/)
  assert.doesNotMatch(sql, /CREATE (?:TABLE.*event_outbox|PUBLICATION|.*REPLICATION SLOT)/)
  assert.doesNotMatch(sql, /CREATE ROLE leaddrive_event_cdc/)
  assert.match(sql, /Apply the full foundation migration separately as event_migrator/)
})

test('each phase is tenant-scoped and commits the head, event and outbox together', () => {
  for (const phase of FIXTURE_PHASES) {
    const sql = phaseSql(phase)
    const events = fixtureEvents(phase)
    assert.equal((sql.match(/^BEGIN;/gm) ?? []).length, 2)
    assert.equal((sql.match(/^COMMIT;/gm) ?? []).length, 2)
    assert.equal((sql.match(/^SET CONSTRAINTS ALL IMMEDIATE;/gm) ?? []).length, 2)
    assert.equal((sql.match(/INSERT INTO public.domain_events/g) ?? []).length, events.length)
    assert.equal((sql.match(/INSERT INTO public.event_outbox/g) ?? []).length, events.length)
    assert.match(sql, /current_user <> E'event_app'/)
    assert.match(sql, /rolsuper OR rolbypassrls/)
    assert.match(sql, /current_database\(\) <> E'event_platform_test'/)
    assert.doesNotMatch(sql, /payloadHash|DISABLE|session_replication_role|ON CONFLICT|SET (?:LOCAL )?ROLE/)
    for (const [index, tenant] of FIXTURE_TENANTS.entries()) {
      const transaction = sql.split(/^BEGIN;$/m)[index + 1]
      assert.match(transaction, new RegExp(`SET LOCAL app.org_id = E'${tenant}';`))
      const otherTenant = FIXTURE_TENANTS.find(value => value !== tenant)
      assert.ok(!transaction.includes(otherTenant))
      for (const event of events.filter(value => value.organizationId === tenant)) {
        assert.ok(transaction.includes(sqlQuote(JSON.stringify(event.envelope))))
        assert.ok(transaction.indexOf(sqlQuote(event.eventId)) < transaction.indexOf(sqlQuote(event.outboxId)))
        assert.ok(transaction.indexOf(sqlQuote(event.outboxId)) < transaction.indexOf('COMMIT;'))
      }
    }
  }
})

test('snapshot physical order defeats UUID order; later phases require exact predecessor', () => {
  const snapshot = phaseSql('snapshot')
  for (const tenant of FIXTURE_TENANTS) {
    const [v1, v2] = fixtureEvents('snapshot').filter(event => event.organizationId === tenant)
    assert.ok(snapshot.indexOf(sqlQuote(v2.outboxId)) < snapshot.indexOf(sqlQuote(v1.outboxId)))
  }
  assert.equal((snapshot.match(/INSERT INTO public.event_aggregate_heads/g) ?? []).length, 2)
  for (const [phase, previous, next] of [['stream', 2, 3], ['restart', 3, 4]]) {
    const sql = phaseSql(phase)
    assert.match(sql, new RegExp(`AND "currentVersion" = ${previous};`))
    assert.match(sql, new RegExp(`SET "currentVersion" = ${next},`))
    assert.equal((sql.match(/GET DIAGNOSTICS changed = ROW_COUNT;/g) ?? []).length, 2)
    assert.match(sql, /IF changed <> 1 THEN/)
    assert.doesNotMatch(sql, /INSERT INTO public.event_aggregate_heads/)
  }
})

test('SQL literals escape quotes and backslashes, retain Unicode, and reject NUL/non-strings', () => {
  assert.equal(sqlQuote("a'b\\c"), "E'a''b\\\\c'")
  assert.equal(sqlQuote("'); DROP TABLE organizations; --"), "E'''); DROP TABLE organizations; --'")
  assert.equal(sqlQuote('Bakı\n東京'), "E'Bakı\n東京'")
  for (const value of ['a\0b', undefined, null, 2, {}, []]) assert.throws(() => sqlQuote(value), TypeError)
})

test('unknown phases are rejected instead of generating SQL or silently omitting records', () => {
  for (const phase of ['all', 'prod', 'Snapshot', '', null, undefined, {}, 1]) {
    assert.throws(() => fixtureEvents(phase), RangeError)
    assert.throws(() => phaseSql(phase), RangeError)
  }
})

test('test connector changes only the explicit allowlist and never mutates its template', () => {
  for (const mode of CONNECTOR_MODES) {
    const connector = renderTestConnector(template, { mode })
    assert.equal(connector.name, `leaddrive-event-outbox-test-${mode}`)
    const c = connector.config
    assert.equal(c['database.hostname'], FIXTURE.hostname)
    assert.equal(c['database.dbname'], FIXTURE.database)
    assert.equal(c['database.user'], FIXTURE.cdcRole)
    assert.equal(c['database.password'], FIXTURE.cdcPassword)
    assert.equal(c['database.port'], '5432')
    assert.equal(c['database.sslmode'], 'disable')
    assert.equal(Object.hasOwn(c, 'database.sslrootcert'), false)
    assert.equal(c['slot.name'], `leaddrive_event_outbox_test_${mode}`)
    assert.equal(c['slot.drop.on.stop'], 'false')
    assert.equal(c['topic.prefix'], `ld.test.cdc-source-${mode}`)
    assert.equal(c['transforms.outbox.route.topic.replacement'], `ld.test${mode}.$1.events.v1`)
    assert.equal(fixtureKafkaTopic(mode), `ld.test${mode}.transport.events.v1`)
    assert.equal(FIXTURE.sourceTopic.replace(new RegExp(c['transforms.outbox.route.topic.regex']), c['transforms.outbox.route.topic.replacement']), fixtureKafkaTopic(mode))
    for (const key of new Set([...Object.keys(template.config), ...Object.keys(c)])) {
      if (template.config[key] !== c[key]) assert.ok(TEST_CONNECTOR_CONFIG_CHANGES.includes(key), key)
      if (!TEST_CONNECTOR_CONFIG_CHANGES.includes(key)) assert.equal(c[key], template.config[key], key)
    }
    assert.doesNotMatch(JSON.stringify(connector), /__[A-Z_]+__/)
    assert.equal(c['publication.autocreate.mode'], 'disabled')
    assert.equal(c['errors.tolerance'], 'none')
    assert.equal(c['event.processing.failure.handling.mode'], 'fail')
    assert.equal(c['transforms.outbox.table.op.invalid.behavior'], 'fatal')
    assert.equal(c['snapshot.select.statement.overrides.public.event_outbox'], template.config['snapshot.select.statement.overrides.public.event_outbox'])
  }
  assert.deepEqual(template, JSON.parse(templateText))
  assert.equal(renderTestConnector(template).config['transforms.outbox.table.expand.json.payload'], 'true')
  assert.notEqual(fixtureKafkaTopic('expanded'), fixtureKafkaTopic('raw'))
})

test('raw A/B mode uses unexpanded JSON text with StringConverter, never a production edit', () => {
  const raw = renderTestConnector(template, { mode: 'raw' }).config
  assert.equal(raw['transforms.outbox.table.expand.json.payload'], 'false')
  assert.equal(raw['value.converter'], 'org.apache.kafka.connect.storage.StringConverter')
  assert.equal(Object.hasOwn(raw, 'value.converter.schemas.enable'), false)
  const expanded = renderTestConnector(template, { mode: 'expanded' }).config
  assert.equal(expanded['transforms.outbox.table.expand.json.payload'], 'true')
  assert.equal(expanded['value.converter'], 'org.apache.kafka.connect.json.JsonConverter')
  assert.equal(expanded['value.converter.schemas.enable'], 'false')
})

test('renderer rejects unknown overrides, changed placeholders and malformed templates', () => {
  for (const options of [null, [], 'raw', { mode: 'prod' }, { mode: '' }, { mode: null }, { mode: 'raw', hostname: 'prod' }, { environment: 'prod' }, { password: 'x' }]) {
    assert.throws(() => renderTestConnector(template, options))
  }
  for (const mode of ['prod', '', null, undefined, {}, []]) assert.throws(() => fixtureKafkaTopic(mode), RangeError)
  for (const key of TEST_CONNECTOR_CONFIG_CHANGES) {
    const changed = structuredClone(template)
    changed.config[key] = 'unexpected'
    assert.throws(() => renderTestConnector(changed), /Connector template changed/)
  }
  for (const input of [null, [], {}, { ...template, name: 'already-rendered-prod' }, { ...template, extra: true }, { ...template, config: [] }]) {
    assert.throws(() => renderTestConnector(input), TypeError)
  }
  const unresolved = structuredClone(template)
  unresolved.config['unknown.placeholder'] = '__REQUIRES_REVIEW__'
  assert.throws(() => renderTestConnector(unresolved), /Unresolved/)
})
