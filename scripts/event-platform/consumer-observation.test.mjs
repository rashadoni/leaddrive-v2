import assert from 'node:assert/strict'
import test from 'node:test'
import { assertBoundedConsumerExit } from './consumer-observation.mjs'

const result = () => ({
  status: 0,
  stdout: 'record-one\nrecord-two\n',
  stderr: '[fixture] ERROR Error processing message, terminating consumer process: (org.apache.kafka.tools.consumer.ConsoleConsumer)\norg.apache.kafka.common.errors.TimeoutException\nProcessed a total of 2 messages\n',
})

test('bounded CLI observation accepts only its expected idle timeout and complete record count', () => {
  assert.equal(assertBoundedConsumerExit(result(), 2), 2)
  const extra = result()
  extra.stdout += 'identical-duplicate-at-new-offset\n'
  extra.stderr = extra.stderr.replace('of 2 messages', 'of 3 messages')
  assert.equal(assertBoundedConsumerExit(extra, 2), 3)
})

test('zero exit and an adequate record count cannot conceal a different receive error', () => {
  for (const error of ['SaslAuthenticationException: denied', 'SerializationException: invalid', 'TopicAuthorizationException: denied']) {
    const bad = result()
    bad.stderr = bad.stderr.replace('TimeoutException', error)
    assert.throws(() => assertBoundedConsumerExit(bad, 2), /expected bounded idle timeout/)
  }
  const bad = result()
  bad.stderr += '[fixture] ERROR a different failure\n'
  assert.throws(() => assertBoundedConsumerExit(bad, 2))
})

test('rejects shutdown/count-only, error exits, missing records, ceilings and ambiguous completion', () => {
  const changes = [
    item => { item.stderr = 'Processed a total of 2 messages\n' },
    item => { item.status = 1 },
    item => { item.status = null },
    item => { item.stdout = 'record-one\n' },
    item => { item.stderr += 'Processed a total of 2 messages\n' },
    item => { item.stderr += 'Caused by: other failure\n' },
    item => { item.stdout = 'x\n'.repeat(256); item.stderr = item.stderr.replace('of 2', 'of 256') },
  ]
  for (const change of changes) {
    const bad = result()
    change(bad)
    assert.throws(() => assertBoundedConsumerExit(bad, 2))
  }
  assert.throws(() => assertBoundedConsumerExit(result(), 3))
  for (const minimum of [0, 256, '2', null, NaN]) assert.throws(() => assertBoundedConsumerExit(result(), minimum))
})
