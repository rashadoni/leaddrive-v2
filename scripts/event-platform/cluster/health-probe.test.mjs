// The production probe parses psql output by hand. On 2026-10-26 the MTM
// visit check stripped the empty last column of a healthy answer
// ("12\t0\t0\t\n"), raised, and took the slot, outbox and Fund views of the
// probe down with it. These run the real parser on psql-shaped output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const probe = fileURLToPath(new URL('./health-probe.py', import.meta.url))

function check(name, code, out, err = '') {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("probe", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.run = lambda *a, **k: (int(sys.argv[2]), sys.argv[3], sys.argv[4])
print(json.dumps(m.guarded(getattr(m, sys.argv[5]), {})))
`
  return JSON.parse(execFileSync('python3', ['-B', '-c', script, probe, String(code), out, err, name], { encoding: 'utf8' }))
}
const visitEvents = (code, out, err) => check('visit_events', code, out, err)
const dealEvents = (code, out, err) => check('deal_events', code, out, err)

test('a healthy answer, whose example column is empty, parses', () => {
  assert.deepEqual(visitEvents(0, '12\t0\t0\t\n'), { windowSeconds: 10800, visits: 12, unstarted: 0, drift: 0, sample: null })
})

test('a gap names its counts and one visit', () => {
  assert.deepEqual(visitEvents(0, '12\t1\t2\tvisit-x\n'), { windowSeconds: 10800, visits: 12, unstarted: 1, drift: 2, sample: 'visit-x' })
})

test('a broken check reports an error instead of raising', () => {
  assert.match(visitEvents(0, 'garbage\n').error, /^ValueError/)
  assert.equal(visitEvents(1, '', 'ERROR: relation "mtm_visits" does not exist\n').error, 'ERROR: relation "mtm_visits" does not exist')
})

test('deals: the same row shape, counted as deals', () => {
  assert.deepEqual(dealEvents(0, '1\t0\t0\t\n'), { windowSeconds: 10800, deals: 1, unstarted: 0, drift: 0, sample: null })
  assert.deepEqual(dealEvents(0, '2\t1\t2\tdeal-x\n'), { windowSeconds: 10800, deals: 2, unstarted: 1, drift: 2, sample: 'deal-x' })
})
