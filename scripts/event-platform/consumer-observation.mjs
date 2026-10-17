/** Accept only the pinned CLI's expected bounded idle-timeout observation. */
export function assertBoundedConsumerExit(result, minimumRecords) {
  const reject = () => { throw new Error('Disposable CDC: consumer did not finish with the expected bounded idle timeout') }
  if (!Number.isSafeInteger(minimumRecords) || minimumRecords < 1 || minimumRecords >= 256
      || !result || result.status !== 0 || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
      || Buffer.byteLength(result.stdout) > 2 * 1024 * 1024 || Buffer.byteLength(result.stderr) > 1024 * 1024) reject()
  const completions = [...result.stderr.matchAll(/^Processed a total of (\d+) messages$/gm)]
  const errors = result.stderr.split('\n').filter(line => /\bERROR\b/.test(line))
  // ConsoleConsumer catches Throwable from receive() and may still exit zero.
  // A count/zero exit alone must not turn auth/deserialization failure green.
  if (completions.length !== 1 || errors.length !== 1
      || !errors[0].includes('Error processing message, terminating consumer process:')
      || !/Error processing message, terminating consumer process:[^\n]*\norg\.apache\.kafka\.common\.errors\.TimeoutException(?::[^\n]*)?(?:\n|$)/.test(result.stderr)
      || /Caused by:/.test(result.stderr)) reject()
  const count = Number(completions[0][1])
  const lines = (result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout).split('\n')
  if (count < minimumRecords || count >= 256 || lines.length !== count || lines.some(line => !line)) reject()
  return count
}
