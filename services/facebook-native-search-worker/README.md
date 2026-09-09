# Facebook native search worker

This service reproduces Facebook's authenticated **global native search** on
the always-on `remote-dev` Chrome profile and sends strictly normalized public
results to LeadDrive. It is intentionally Facebook-specific.

## Safety boundaries

- It connects only to the existing CDP endpoint
  `http://127.0.0.1:9222`. There is no browser `launch()` call.
- Initial canary search is serial and fixed at exactly 8 scrolls: one query per
  cycle, at least 1800 seconds plus 0–120 seconds of jitter between queries,
  at most 2 queries/hour and 8/day. These are hard local safety limits.
- Every results request is assembled under a deterministic 240 KiB local
  budget (below the server's 256 KiB cap). Omitted items are not marked seen
  and the coverage report is explicitly `PARTIAL`, so they can be retried.
- `/search/top/` is required. The worker verifies both the visible
  **Recent posts** switch and the resulting non-empty `filters` URL parameter.
- A result is accepted only when the article has a strong Facebook publication
  ID and an explicit public-audience accessibility marker. The live Russian
  marker `svg[role=img] > title` containing `Доступно всем` is supported.
- Login, checkpoint, changed route/filter, or ambiguous DOM causes a
  fail-closed `BLOCKED` report. Auth/filter blocks stop the daemon cleanly so a
  service manager does not hammer Facebook.
- An explicit Meta temporary-block/checkpoint page stops immediately. A
  verified Recent-posts search that still yields no articles after 8 scrolls
  reports `PARTIAL / SEARCH_RESULTS_EMPTY_ANOMALY` and also stops for manual
  review. The worker contains no proxy, masking, challenge bypass, or
  anti-detection behavior.
- Cookies, token values, post text, raw queries, DOM, screenshots, and API
  response bodies are never written to logs.
- Job queries and target IDs containing NUL or other C0/DEL control characters
  are rejected before collection so the cross-language job hash stays
  unambiguous.
- The API token is read from a `0600` file. CDP remains loopback-only.

Facebook may change its DOM, rate-limit the account, or challenge an automated
session. This worker is therefore a controlled supplementary acquisition
channel, not a contractual replacement for an official/commercial listening
API. Operation must comply with the account owner's permissions and applicable
Meta terms.

Keep these canary limits unchanged for a minimum 7-day soak. Review blocks,
empty-result anomalies, result quality, session stability, and account notices
before considering a separately reviewed change. The worker itself never
automatically raises limits.

## Flow

1. `GET jobsUrl` with the dedicated bearer token.
2. Validate `facebook-native-search-jobs-v2` jobs, including the exact active
   `facebook-native-search-targets-v1` binding. One normalized query can carry
   1–25 unique, sorted scenario/subject/source targets; the worker verifies the
   server-compatible job hash before opening Facebook. Tighten local caps with
   server limits (remote values can never make local pacing less strict).
3. Attach to the existing persistent Chrome over CDP.
4. For each job, open `/search/top/?q=...`, activate and verify Recent posts,
   then inspect only `[role=feed] [role=article]`.
5. Scroll serially exactly 8 times. Hash article HTML inside the page; raw HTML never
   leaves browser memory.
6. Require explicit public audience evidence, canonicalize a strong post/reel/
   video/photo ID, and build the strict `facebook-native-search-results-v2`
   item.
7. Atomically dedupe by `(jobId, externalId)` and queue the run in SQLite WAL.
   The server fans each accepted item out to every exact target in the binding.
   A meaningful text/author/link change is queued once as an update; capture
   time, scroll position, relative date, and DOM-hash noise are ignored.
8. `POST resultsUrl`. A failed delivery remains durable with exponential retry.
   Even a zero-result run is posted so coverage is observable. HTTP 409 remains
   retryable because it represents the tenant collection fence. HTTP 410 means
   the exact job/target binding is stale: that outbox record is atomically
   retired as `abandoned / HTTP_410`, its seen entries are invalidated for safe
   recollection, and other current jobs may continue.

SQLite has three relevant records: collection runs, the durable seen-ID index,
and immutable items belonging to a pending run. A process lock prevents two
workers from sharing the browser or database.

## Install

The persistent Chrome service and its authenticated profile must already be
healthy:

```bash
curl --fail http://127.0.0.1:9222/json/version
```

Copy this directory to:

```text
/home/codex-alt/services/leaddrive-facebook-native-search-worker
```

Use the existing browser virtual environment or install only the Python
Playwright client. Do **not** download or launch another browser:

```bash
/home/codex-alt/services/leaddrive-facebook-browser/venv/bin/pip install \
  -r requirements.txt
```

Create `config.json` from `config.example.json`, then create the dedicated API
token file without printing the token:

```bash
install -d -m 0700 secrets state
install -m 0600 /dev/null secrets/api-token
```

Write the issued token interactively, validate locally, and run one cycle:

```bash
/home/codex-alt/services/leaddrive-facebook-browser/venv/bin/python main.py \
  --config config.json --validate-config
/home/codex-alt/services/leaddrive-facebook-browser/venv/bin/python main.py \
  --config config.json --once
```

For persistent operation, install the supplied unit as
`/etc/systemd/system/facebook-native-search-worker.service`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now facebook-native-search-worker
sudo systemctl status facebook-native-search-worker
```

Logs contain only event names, counts, run/job IDs, one-way query references,
and classified error codes:

```bash
journalctl -u facebook-native-search-worker -f
```

If the unit is inactive after `worker_stopped_for_manual_action`, repair the
Facebook session in the persistent remote browser and explicitly restart it.

## Tests

Tests use only the Python standard library and do not connect to Facebook:

```bash
python3 -m unittest discover -s tests -v
```

They cover the strict API contract, exact public marker, permalink
canonicalization, SQLite WAL/outbox/dedupe, remote limit tightening, token file
permissions, and authenticated GET/POST transport.

## Other platforms

The durable job/outbox pattern can be reused, but the collector cannot.
Instagram, TikTok, and YouTube have different search semantics, DOMs,
authentication risks, content IDs, and public-audience evidence. Each platform
needs a separate adapter and parser contract; sharing Facebook selectors or
session logic would make the system less stable.
