import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Deliberately checks these small, literal mappings, not arbitrary YAML.
function concurrencyMapping(source, indentation) {
  const lines = source.split(/\r?\n/)
  const heading = `${' '.repeat(indentation)}concurrency:`
  const matches = lines.flatMap((line, index) => line === heading ? [index] : [])
  assert.equal(matches.length, 1, `expected one concurrency mapping at indentation ${indentation}`)
  const entries = []
  for (const line of lines.slice(matches[0] + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const spaces = line.length - line.trimStart().length
    if (spaces <= indentation) break
    assert.equal(spaces, indentation + 2, 'concurrency settings must be a flat literal mapping')
    const field = line.trim().match(/^([a-z-]+): (.+)$/)
    assert.ok(field, 'unexpected concurrency setting syntax')
    assert.ok(!entries.some(([name]) => name === field[1]), 'duplicate concurrency setting')
    entries.push([field[1], field[2]])
  }
  return Object.fromEntries(entries)
}

test('stack and both CDC phases share one non-cancelling queued slot while workflow updates keep latest-branch cancellation', () => {
  for (const [workflow, expectedJobs] of [['stack', ['smoke']], ['cdc', ['cdc-smoke', 'full-cdc-fund']]]) {
    const source = readFileSync(new URL(`../../.github/workflows/event-platform-${workflow}.yml`, import.meta.url), 'utf8')
    const jobs = source.match(/^jobs:\n([\s\S]*)$/m)?.[1]
    assert.ok(jobs, `${workflow}: jobs mapping is required`)
    const headings = [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)]
    assert.deepEqual(headings.map(match => match[1]), expectedJobs)
    for (let index = 0; index < headings.length; index++) {
      const job = jobs.slice(headings[index].index, headings[index + 1]?.index ?? jobs.length)
      assert.deepEqual(concurrencyMapping(job, 4), {
        group: 'event-platform-disposable-integration',
        'cancel-in-progress': 'false',
        queue: 'max',
      }, `${workflow}/${headings[index][1]}: only one disposable stack may run; pending jobs must queue`)
    }
    assert.deepEqual(concurrencyMapping(source, 0), {
      group: `event-platform-${workflow}-` + '${{ github.head_ref || github.ref }}',
      'cancel-in-progress': 'true',
    }, `${workflow}: preserve independent workflow-level latest-branch cancellation without queue:max`)
  }
})
