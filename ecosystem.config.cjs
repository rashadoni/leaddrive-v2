const APP_DIR = process.env.APP_DIR || "/opt/leaddrive-v2"
const APP_PORT = process.env.APP_PORT || 3001
const JOBS_PORT = process.env.JOBS_PORT || 3002
const APP_ENV_FILE = process.env.APP_ENV_FILE || "/etc/leaddrive/app.env"
const RUNTIME_DIR = process.env.LEADDRIVE_RUNTIME_DIR || "/var/lib/leaddrive-v2"
const LOG_DIR = process.env.LEADDRIVE_LOG_DIR || "/var/lib/leaddrive-v2-logs"
const HELP_VIDEO_ASSET_DIR = process.env.HELP_VIDEO_ASSET_DIR || `${RUNTIME_DIR}/help-videos/player`
const MTM_DOCUMENT_STORAGE_DIR = process.env.MTM_DOCUMENT_STORAGE_DIR || `${RUNTIME_DIR}/uploads/mtm-documents`

// One Next.js server, started twice from the same bundle and the same
// environment: once for people (nginx → 3001) and once for the scheduler
// (scripts/cron-trigger.sh → 3002, loopback only). Node runs JavaScript on one
// thread, and on 2026-10-26 the schedule was holding that thread for the
// people: every minute ~20 jobs fire in the same second, every fifth minute
// more, and the social poll runs for 96 s. Measured on production, the web
// process sat at 0–1% CPU between those bursts and at 50–140% inside them,
// while /api/v1/ping went from 0.1 s to 7 s and a dashboard's requests waited
// 4–11 s each. Jobs coordinate through SystemJobLease in PostgreSQL, not
// through process memory, so where they run changes nothing about what they do.
const serverApp = ({ name, port, hostname, errorFile, outFile, maxMemory }) => ({
  name,
  script: `${APP_DIR}/.next/standalone/server.js`,
  cwd: `${APP_DIR}/.next/standalone`,
  interpreter: "node",
  // pm2 otherwise loads its metrics agent, @pm2/io, INTO the app: it wraps the
  // http module to time every request and, on one-second timers, counts the
  // process's handles and sorts its latency samples for percentiles. Profiled
  // on production 2026-10-28 with function names (perf map), that agent was the
  // largest single piece of the web thread's own work between requests — 232
  // of 1491 samples over three minutes, ahead of the shell-events watcher (52).
  // Nothing reads those metrics; pm2's restart-on-memory and its process list
  // do not need them.
  pmx: false,
  instances: 1,
  exec_mode: "fork",
  env: {
    NODE_ENV: "production",
    PORT: port,
    HOSTNAME: hostname,
    APP_ENV_FILE,
    LEADDRIVE_RUNTIME_DIR: RUNTIME_DIR,
    LEADDRIVE_LOG_DIR: LOG_DIR,
    HELP_VIDEO_ASSET_DIR,
    MTM_DOCUMENT_STORAGE_DIR,
  },
  error_file: errorFile,
  out_file: outFile,
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  merge_logs: true,
  max_restarts: 10,
  min_uptime: "10s",
  restart_delay: 5000,
  autorestart: true,
  max_memory_restart: maxMemory,
  kill_timeout: 10000,
  listen_timeout: 10000,
})

module.exports = {
  apps: [
    serverApp({
      name: process.env.PM2_NAME || "leaddrive-v2",
      port: APP_PORT,
      hostname: process.env.APP_HOSTNAME || "127.0.0.1",
      errorFile: `${LOG_DIR}/error.log`,
      outFile: `${LOG_DIR}/out.log`,
      // 512M was far below the app's normal working set, so pm2 was SIGINT/
      // SIGKILL-restarting the single fork instance every 2–5 min; each restart
      // left nginx with no upstream → an 8–10 s burst of 502s (HTML), which
      // clients saw as "Unexpected token '<'" on any fetch().json() (2026-06-07).
      // 1536M then became the same trap a few months later: by October the
      // process held 0.9–1.3 GB within three minutes of starting and swung up to
      // 1.6 GB before the collector caught up, so pm2 killed it 5–15 times a day
      // (`exceeds --max-memory-restart`, 2026-10-15…26) — each kill ~30 s of
      // 502s and then minutes of a cold process. The box has 12 GB with ~9.7 GB
      // available; 2560M sits above that sawtooth and still trips on a genuine
      // runaway leak long before the machine runs out.
      maxMemory: "2560M",
    }),
    serverApp({
      name: process.env.PM2_JOBS_NAME || "leaddrive-v2-jobs",
      port: JOBS_PORT,
      // Never behind nginx and never on another interface, whatever the web
      // app's own bind is set to: only this box's crontab talks to it.
      hostname: "127.0.0.1",
      // Its own files, so a failing job is not read out of the web log and the
      // diagnostics that grep error.log for phone traffic see only that.
      errorFile: `${LOG_DIR}/jobs-error.log`,
      outFile: `${LOG_DIR}/jobs-out.log`,
      // A restart here costs nobody a page: an interrupted job's lease expires
      // and the next tick picks it up.
      maxMemory: "2048M",
    }),
    // The softphone relay — the process that joins a salesperson's browser to
    // an answered call. Present ONLY when the server has been given its
    // secrets, which is what keeps it out of a production file that lacks
    // them: a relay started without them would crash-loop, and pm2 starts
    // every app in this file.
    //
    // It runs from INSIDE the standalone bundle, because that is the only tree
    // a deploy actually replaces. `${APP_DIR}` on production is a stale repo
    // checkout that no deploy has touched in months — pointing at
    // `${APP_DIR}/scripts` looked right, shipped nothing, and failed the deploy
    // of 2026-08-24 the moment pm2 tried to start a script that was not there.
    // The build stages this directory and `ws` beside the bundle for exactly
    // this reason; the deployment test below keeps the two ends tied together.
    ...(process.env.SOFTPHONE_RELAY_SECRET && process.env.SOFTPHONE_PBX_SECRET
      ? [{
          name: "softphone-relay",
          script: `${APP_DIR}/.next/standalone/scripts/softphone-relay/relay.mjs`,
          cwd: `${APP_DIR}/.next/standalone`,
          interpreter: "node",
          instances: 1,
          exec_mode: "fork",
          env: {
            NODE_ENV: "production",
            APP_ENV_FILE,
            LEADDRIVE_RUNTIME_DIR: RUNTIME_DIR,
            LEADDRIVE_LOG_DIR: LOG_DIR,
            CRM_ORIGIN: process.env.CRM_ORIGIN || "http://127.0.0.1:3001",
            SOFTPHONE_RELAY_SECRET: process.env.SOFTPHONE_RELAY_SECRET,
            SOFTPHONE_PBX_SECRET: process.env.SOFTPHONE_PBX_SECRET,
            SOFTPHONE_RELAY_PORT: process.env.SOFTPHONE_RELAY_PORT || "8095",
            // Loopback, and stated here rather than left to the relay's own
            // default so a reader of the production process list can see that
            // this port is not on the internet. TLS and the public name belong
            // to the CRM's front door, which proxies to it.
            SOFTPHONE_RELAY_BIND: process.env.SOFTPHONE_RELAY_BIND || "127.0.0.1",
            SOFTPHONE_PBX_PORT: process.env.SOFTPHONE_PBX_PORT || "8096",
            SOFTPHONE_PBX_BIND: process.env.SOFTPHONE_PBX_BIND || "127.0.0.1",
          },
          error_file: `${LOG_DIR}/softphone-relay-error.log`,
          out_file: `${LOG_DIR}/softphone-relay.log`,
          log_date_format: "YYYY-MM-DD HH:mm:ss Z",
          merge_logs: true,
          // A relay that dies takes one call with it, never the web app: they
          // are separate processes precisely so a bug in audio plumbing cannot
          // put the CRM offline.
          max_restarts: 20,
          min_uptime: "10s",
          restart_delay: 2000,
          autorestart: true,
          max_memory_restart: "256M",
          kill_timeout: 5000,
        }]
      : []),
    // The Q4 BullMQ worker PM2 app is still deferred and HTTP cron remains
    // authoritative. Redis itself is no longer optional for the web process:
    // public lead and portal-registration abuse guards fail closed when
    // REDIS_URL is missing or unreachable. Provision Redis before deploying
    // those route changes; do not add a production in-memory fallback.
  ],
};
