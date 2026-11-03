// What the production housekeeping watch must keep doing: notice that the
// login page stopped answering, that last night's backup did not run, and that
// the disk is filling up — and stay quiet otherwise, because a watch nobody
// believes is worse than none.
//
// The verdicts are pure functions, so they are tested on fixtures. The two
// things that cannot be faked without losing the point — the shell that runs on
// production and the page fetch — are run for real: the probe program against
// this machine's own systemd and df, the page check against a local server.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_DIR,
  DISK_CRIT_GIB,
  WATCHED_BACKUP_FILES,
  WATCHED_JOBS,
  WATCHED_MOUNTS,
  assessBackupFiles,
  assessDisks,
  assessUploadsOffsite,
  assessJobs,
  assessPage,
  checkPage,
  parseProbe,
  probeProgram,
} from './host-health-watch.mjs';
import { decide } from './watch-delivery.mjs';

const HOUR = 3600_000;
const NOW = Date.parse('2026-11-02T12:00:00Z');

const WATCHED = WATCHED_JOBS[0];
const DUMP = WATCHED_BACKUP_FILES.find((f) => f.key === 'dump');
const SECRETS = WATCHED_BACKUP_FILES.find((f) => f.key === 'secrets');

function probe({ jobs = [], disks = [], files = [], dir = '', newest = '', offsite = null, now = NOW } = {}) {
  return parseProbe(
    [
      `now=${Math.round(now / 1000)}`,
      ...(offsite ? Object.entries({ offsite: 'present', ...offsite }).map(([k, v]) => `${k}=${v}`) : []),
      ...(dir ? [`backupdir=${dir}`] : []),
      ...(newest ? [`newest=${newest}`] : []),
      ...files.map((f) => `file=${f.key} found=${f.found ?? ''}`),
      ...jobs.map((j) => `unit=${j.unit} load=${j.load ?? 'loaded'} enabled=${j.enabled ?? 'enabled'} result=${j.result ?? 'success'} finished=${j.finished ?? ''}`),
      ...disks.map((d) => `disk=${d.mount} fs=${d.fs} total=${d.total} avail=${d.avail}`),
      '',
    ].join('\n'),
  );
}

const job = (overrides) => ({ unit: WATCHED.unit, ...overrides });
const agoHours = (h, now = NOW) => Math.round((now - h * HOUR) / 1000);

test('the program that runs on production only reads', () => {
  const program = probeProgram();
  // The watch holds a root key. Anything that writes, starts or stops belongs
  // in a deploy, not in a watch.
  for (const forbidden of [/\brm\b/, /\bsystemctl (start|stop|restart|enable|disable)\b/, /\bmv\b/, /\btee\b/, /\bdd\b/, /\bchmod\b/]) {
    assert.doesNotMatch(program, forbidden, `the probe may not contain ${forbidden}`);
  }
  // Every redirection must go to /dev/null: a probe that writes a file on
  // production is no longer a probe.
  for (const [, target] of program.matchAll(/\d?>\s*(\S+)/g)) {
    assert.equal(target, '/dev/null', `the probe redirects output to ${target}`);
  }
  assert.match(program, /systemctl show/);
  assert.match(program, /df -P/);
});

test('the probe runs on a real system and parses', () => {
  // This machine has no production units, which is exactly the shape worth
  // running: it proves the program survives a unit that is not there.
  const out = execFileSync('bash', ['-c', probeProgram()], { encoding: 'utf8' });
  const parsed = parseProbe(out);
  assert.ok(Number.isFinite(parsed.now), 'the probe did not report production time');
  assert.equal(parsed.jobs.size, WATCHED_JOBS.length);
  assert.ok(parsed.disks.length >= 1, 'no filesystem was reported');
  for (const disk of parsed.disks) {
    assert.ok(Number(disk.total) > 0 && Number(disk.avail) >= 0, `unparseable df line: ${JSON.stringify(disk)}`);
  }
});

test('a unit that is not there is an alarm, however healthy systemd calls it', () => {
  // systemd reports Result=success for a unit that has never run, and for one
  // that does not exist at all. Reading that as health is the whole trap.
  const missing = assessJobs(probe({ jobs: [job({ load: 'not-found', enabled: '', result: 'success' })] }));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].critical, true);
  assert.match(missing[0].text, new RegExp(`таймера ${WATCHED.unit}\\.timer на проде нет`));

  const off = assessJobs(probe({ jobs: [job({ enabled: 'disabled', result: 'success' })] }));
  assert.equal(off[0].critical, true);
  assert.match(off[0].text, /не включён \(disabled\) — расписания нет/);

  const never = assessJobs(probe({ jobs: [job({ result: 'success', finished: '' })] }));
  assert.equal(never[0].critical, true);
  assert.match(never[0].text, /ни разу не отработал/);
});

test('a failed last run is named by its result', () => {
  const failed = assessJobs(probe({ jobs: [job({ result: 'exit-code', finished: agoHours(3) })] }));
  assert.equal(failed[0].critical, true);
  assert.match(failed[0].text, /завершился как exit-code \(3 ч назад\)/);
});

test('one missed night warns, two are an alarm, and a fresh backup is silent', () => {
  const at = (h) => assessJobs(probe({ jobs: [job({ finished: agoHours(h) })] }));
  assert.deepEqual(at(10), []);
  assert.deepEqual(at(29), []);
  assert.equal(at(31).length, 1);
  assert.equal(at(31)[0].critical, false, 'the first missed night is a warning');
  assert.equal(at(51)[0].critical, true, 'the second missed night is an alarm');
});

test('the backup the owner relies on is watched by what it leaves on disk', () => {
  // Its scheduler is a host script, not one of our units, so the files are the
  // only honest evidence that last night happened.
  const files = (hours) => probe({
    dir: 'present',
    newest: `${agoHours(hours)}|leaddrive-20261102.dump.age`,
    files: [
      { key: 'dump', found: `${agoHours(hours)}|leaddrive-20261102.dump.age` },
      { key: 'secrets', found: `${agoHours(hours)}|etc-leaddrive-20261102.tgz.age` },
    ],
  });
  assert.deepEqual(assessBackupFiles(files(4)), []);
  assert.deepEqual(assessBackupFiles(files(29)), []);
  const warned = assessBackupFiles(files(31));
  assert.equal(warned.length, 2);
  assert.equal(warned[0].critical, false);
  assert.match(warned[0].text, /leaddrive-20261102\.dump\.age сделан 31 ч назад/);
  assert.equal(assessBackupFiles(files(51))[0].critical, true);

  // Both shapes must be named, so a chain that half-ran is not read as healthy.
  assert.deepEqual(WATCHED_BACKUP_FILES.map((f) => f.key).sort(), ['dump', 'secrets']);
});

test('a shape that matches nothing names what IS there', () => {
  // If the watch is looking for the wrong name, the owner gets something he can
  // act on instead of a frightening "there is no backup".
  const nothing = assessBackupFiles(
    probe({
      dir: 'present',
      newest: `${agoHours(2)}|snapshot-2026-11-02.sql.gpg`,
      files: [{ key: 'dump', found: '' }, { key: 'secrets', found: `${agoHours(2)}|etc-leaddrive-x.tgz.age` }],
    }),
  );
  assert.equal(nothing.length, 1);
  assert.equal(nothing[0].critical, true);
  assert.match(nothing[0].text, /нет ни одного \*\.dump\.age; самый свежий файл там — snapshot-2026-11-02\.sql\.gpg \(2 ч назад\)/);

  const emptyDir = assessBackupFiles(probe({ dir: 'present', files: [{ key: 'dump', found: '' }, { key: 'secrets', found: '' }] }));
  assert.equal(emptyDir.length, 2);
  assert.match(emptyDir[0].text, /и каталог пуст/);
});

test('a missing backup directory is one alarm, not two', () => {
  const gone = assessBackupFiles(probe({ dir: 'missing' }));
  assert.equal(gone.length, 1);
  assert.equal(gone[0].critical, true);
  assert.match(gone[0].text, new RegExp(`каталога бэкапов ${BACKUP_DIR.replace(/\//g, '\\/')} на проде нет`));
});

test('an unanswered probe makes no claim about the backups', () => {
  // A probe that said nothing about the directory must not be read as "no
  // backups": that is how a watch invents an incident out of a network blip.
  assert.deepEqual(assessBackupFiles(probe({})), []);
});

test('the age is measured by production clock, not by this box', () => {
  // A watch that trusts its own clock turns a drifting workstation into a
  // nightly false alarm.
  const productionNow = NOW - 40 * HOUR;
  const parsed = probe({
    now: productionNow,
    jobs: [job({ finished: Math.round((productionNow - 2 * HOUR) / 1000) })],
    dir: 'present',
    files: [
      { key: 'dump', found: `${Math.round((productionNow - 2 * HOUR) / 1000)}|d.dump.age` },
      { key: 'secrets', found: `${Math.round((productionNow - 2 * HOUR) / 1000)}|etc-leaddrive-x.tgz.age` },
    ],
  });
  assert.deepEqual(assessJobs(parsed), [], 'the box clock was used instead of production time');
  assert.deepEqual(assessBackupFiles(parsed), [], 'the box clock was used instead of production time');
});

test('free space is judged per filesystem, by percent and by gibibytes', () => {
  const gib = 1024 * 1024;
  // Several watched paths on one filesystem must speak once, not four times.
  const shared = assessDisks(
    probe({
      disks: [
        { mount: '/', fs: '/dev/sda1', total: 600 * gib, avail: 3 * gib },
        { mount: '/var/lib/leaddrive-v2', fs: '/dev/sda1', total: 600 * gib, avail: 3 * gib },
      ],
    }),
  );
  assert.equal(shared.length, 1, 'one filesystem, one verdict');
  assert.equal(shared[0].critical, true);
  assert.match(shared[0].text, /\/dev\/sda1 \(\/\)/);

  // A big disk with a small absolute remainder: the percentage says fine, the
  // gibibytes do not, and recordings fill the gap in a day.
  const absolute = assessDisks(probe({ disks: [{ mount: '/', fs: '/dev/sda1', total: 20_000 * gib, avail: 2_400 * gib }] }));
  assert.deepEqual(absolute, [], 'two terabytes free is not a problem, whatever the percentage says');
  const tight = assessDisks(probe({ disks: [{ mount: '/', fs: '/dev/sdb1', total: 100 * gib, avail: 7 * gib }] }));
  assert.equal(tight[0].critical, false, 'seven percent of a hundred gibibytes is a warning');
  const empty = assessDisks(probe({ disks: [{ mount: '/', fs: '/dev/sdc1', total: 100 * gib, avail: (DISK_CRIT_GIB - 1) * gib }] }));
  assert.equal(empty[0].critical, true);
  assert.deepEqual(assessDisks(probe({ disks: [{ mount: '/x', fs: 'none', total: 0, avail: 0 }] })), []);
});

test('the offsite copy of client files is silent until it exists', () => {
  // It is not installed on every host, and the open gap is recorded in the
  // runbook. A watch that reds on a decision not yet taken is noise.
  assert.deepEqual(assessUploadsOffsite(probe({})), []);
});

test('an offsite copy that stopped is an alarm', () => {
  const at = (hours, extra = {}) => assessUploadsOffsite(
    probe({ offsite: { offsite_ran_at: agoHours(hours), offsite_status: 'ok', offsite_pending: 0, ...extra } }),
  );
  assert.deepEqual(at(5), []);
  assert.deepEqual(at(29), []);
  assert.equal(at(31)[0].critical, false);
  assert.match(at(31)[0].text, /не делалась 31 ч/);
  assert.equal(at(51)[0].critical, true);

  // The backlog is named in the message, because "no copy for two days" reads
  // differently when four thousand files are still waiting.
  assert.match(at(51, { offsite_pending: 4000 })[0].text, /в очереди 4000 файл/);

  // Its own verdict is forwarded even while the file is fresh.
  const refused = assessUploadsOffsite(probe({ offsite: { offsite_ran_at: agoHours(1), offsite_status: 'crit', offsite_pending: 3, offsite_failures: 3 } }));
  assert.equal(refused[0].critical, true);
  assert.match(refused[0].text, /не отправила ни одного файла \(отказов 3\)/);
  const partial = assessUploadsOffsite(probe({ offsite: { offsite_ran_at: agoHours(1), offsite_status: 'warn', offsite_pending: 1, offsite_failures: 1 } }));
  assert.equal(partial[0].critical, false);

  // A state file without a run time is broken, not healthy.
  const broken = assessUploadsOffsite(probe({ offsite: { offsite_ran_at: '', offsite_status: 'ok' } }));
  assert.equal(broken[0].critical, true);
});

test('a client file lying plain on the disk is a warning of its own', () => {
  // The only check anywhere that looks at the disk: the code-side guard
  // (tenant-file-readers-guard.test.ts) proves the code seals what it writes,
  // and says nothing about what is already lying there.
  const fresh = (extra) => assessUploadsOffsite(
    probe({ offsite: { offsite_ran_at: agoHours(1), offsite_status: 'ok', offsite_pending: 0, ...extra } }),
  );
  assert.deepEqual(fresh({}), [], 'a state file from before this count must stay silent');
  assert.deepEqual(fresh({ offsite_plain_unexpected: 0 }), []);
  const plain = fresh({ offsite_plain_unexpected: 9 });
  assert.equal(plain.length, 1);
  assert.equal(plain[0].critical, false);
  assert.match(plain[0].text, /9 незашифрованных файл/);

  // It is not the copy's verdict, so both can be said at once.
  const both = assessUploadsOffsite(
    probe({ offsite: { offsite_ran_at: agoHours(60), offsite_status: 'ok', offsite_plain_unexpected: 2 } }),
  );
  assert.deepEqual(both.map((p) => [p.key, p.critical]), [['offsite', true], ['uploads-plain', false]]);
});

test('the probe reads the offsite state only if it is there', () => {
  const program = probeProgram();
  assert.match(program, /if \[ -f \/var\/lib\/leaddrive-uploads-offsite\/state \]; then cat/);
});

test('the page verdict says whether the application is alive', () => {
  assert.deepEqual(assessPage({ ok: true, ms: 900 }), []);
  const slow = assessPage({ ok: true, ms: 7_000 });
  assert.equal(slow[0].critical, false);
  assert.match(slow[0].text, /открылась за 7\.0 с/);

  const down = assessPage({ ok: false, reason: 'код 502', pingOk: false, ms: 300 });
  assert.equal(down[0].critical, true);
  assert.match(down[0].text, /прод не отвечает снаружи: код 502/);

  // The useful alarm: the box answers, the page does not. That is a different
  // call at three in the morning than "production is gone".
  const partial = assessPage({ ok: false, reason: 'код 500', pingOk: true, ms: 300 });
  assert.match(partial[0].text, /приложение живо, страница — нет/);
});

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('the page check follows the redirect a person follows, and reads the markup', async () => {
  const app = await serve((request, response) => {
    if (request.url === '/') {
      response.writeHead(307, { location: '/login' });
      response.end();
      return;
    }
    if (request.url === '/login') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/css/x.css"/></head><body>LeadDrive</body></html>');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const ok = await checkPage(app.base, 5_000);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.ok(ok.ms >= 0);
  } finally {
    await app.close();
  }
});

test('a 200 that is not the application is not a healthy page', async () => {
  // This is what a cache or an edge error page looks like: the status is fine
  // and nothing of the app is in the body. A watch that only reads the status
  // calls that green.
  const edge = await serve((request, response) => {
    if (request.url === '/') {
      response.writeHead(307, { location: '/login' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body>Error 1102</body></html>');
  });
  try {
    const verdict = await checkPage(edge.base, 5_000);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /не похож на страницу приложения/);
  } finally {
    await edge.close();
  }
});

test('a redirect that leads somewhere else is not a healthy page', async () => {
  const elsewhere = await serve((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html>/_next/static/ но это не /login</html>');
  });
  try {
    const verdict = await checkPage(elsewhere.base, 5_000);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /увело не на \/login/);
  } finally {
    await elsewhere.close();
  }
});

test('nothing speaks on the first pass, and the recovery is announced once', () => {
  const problems = assessPage({ ok: false, reason: 'код 502', pingOk: false, ms: 10 });
  const needsTwoRuns = () => true;
  const first = decide(problems, {}, NOW, { needsTwoRuns });
  assert.deepEqual(first.sends, [], 'a single bad pass must not page anybody');
  assert.equal(first.held[0].detail, 'прогон 1 из 2');

  const second = decide(problems, { incidents: first.incidents }, NOW + 5 * 60_000, { needsTwoRuns });
  assert.equal(second.sends.length, 1);
  assert.equal(second.sends[0].critical, true);

  const third = decide(problems, { incidents: second.incidents }, NOW + 10 * 60_000, { needsTwoRuns });
  assert.deepEqual(third.sends, [], 'an alarm repeats hourly, not every pass');
  // The reminder is an hour after the message went out, not after the pass
  // that found the problem.
  const hourLater = decide(problems, { incidents: second.incidents }, NOW + 70 * 60_000, { needsTwoRuns });
  assert.equal(hourLater.sends[0].repeat, true);

  const healthy = decide([], { incidents: second.incidents }, NOW + 15 * 60_000, { needsTwoRuns });
  assert.equal(healthy.recovered, true);
  const after = decide([], { incidents: healthy.incidents }, NOW + 20 * 60_000, { needsTwoRuns });
  assert.equal(after.recovered, false, 'recovery is announced once, not for ever');
});

test('a warning is said once and not repeated until it becomes an alarm', () => {
  const warning = [{ key: 'disk:/dev/sda1', critical: false, text: 'место' }];
  const needsTwoRuns = () => true;
  const ripe = decide(warning, { incidents: { 'disk:/dev/sda1': { streak: 1, reported: false, lastSent: 0, critical: false } } }, NOW, { needsTwoRuns });
  assert.equal(ripe.sends.length, 1);
  const again = decide(warning, { incidents: ripe.incidents }, NOW + 2 * HOUR, { needsTwoRuns });
  assert.deepEqual(again.sends, []);
  assert.equal(again.held[0].reason, 'said-once');
});

test('the uncommissioned chain is deliberately not watched, and says why', () => {
  // Measured on production 2026-11-02: leaddrive-postgres-backup and
  // leaddrive-secrets-snapshot are `disabled`, leaddrive-runtime-files-snapshot
  // is not installed, and log shipping cannot work until the runbook's log
  // evidence is finished. That is the documented state of a host whose recovery
  // gate runs in plain mode. A watch that reds on a chosen gap reds for ever,
  // and then nobody reads it at all.
  for (const unit of ['leaddrive-postgres-backup', 'leaddrive-secrets-snapshot', 'leaddrive-runtime-files-snapshot', 'leaddrive-log-ship']) {
    assert.ok(!WATCHED_JOBS.some((j) => j.unit === unit), `${unit} is not active on production and must not be watched yet`);
  }
  // What IS watched must be a unit the deploy keeps alive.
  assert.deepEqual(WATCHED_JOBS.map((j) => j.unit), ['leaddrive-wal-backup']);
  const source = readFileSync('scripts/backup/host-health-watch.mjs', 'utf8');
  assert.match(source, /commissioning chain .* are deliberately NOT here/s);
  assert.match(source, /Put each one back\s+(\/\/\s+)?the day its activation is finished/i);
});

test('every watched path is absolute and production-owned', () => {
  for (const mount of WATCHED_MOUNTS) assert.match(mount, /^\//);
  assert.ok(WATCHED_MOUNTS.includes('/'), 'the root filesystem must be watched');
});

test('both installers ship the shared delivery module they import', () => {
  // The watches import ./watch-delivery.mjs from their installed copy. An
  // installer that forgets it installs a watch that crashes on every pass.
  for (const installer of ['scripts/backup/install-host-watch.sh', 'scripts/backup/install-wal-watch.sh']) {
    const source = readFileSync(installer, 'utf8');
    assert.match(source, /watch-delivery\.mjs" "\$dest\/watch-delivery\.mjs"/, `${installer} does not install the shared module`);
  }
});

test('the watch tells the owner when it breaks itself', () => {
  const unit = readFileSync('ops/backup/watch/ld-host-watch.service', 'utf8');
  assert.match(unit, /OnFailure=ld-host-watch-failed\.service/);
  const failed = readFileSync('ops/backup/watch/ld-host-watch-failed.service', 'utf8');
  assert.match(failed, /--notify-failure/);
  const timer = readFileSync('ops/backup/watch/ld-host-watch.timer', 'utf8');
  assert.match(timer, /OnCalendar=\*:0\/5/);
  assert.match(timer, /WantedBy=timers\.target/);
});

test('the installer refuses to pretend: no notifier, no key, no watch', () => {
  const source = readFileSync('scripts/backup/install-host-watch.sh', 'utf8');
  assert.match(source, /no Telegram notifier at/);
  assert.match(source, /no production key at/);
  for (const unit of ['ld-host-watch.service', 'ld-host-watch.timer', 'ld-host-watch-failed.service']) {
    assert.ok(source.includes(unit), `${unit} is never installed`);
  }
});
