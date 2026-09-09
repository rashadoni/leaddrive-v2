const APP_DIR = process.env.APP_DIR || "/opt/leaddrive-v2"
const APP_PORT = process.env.APP_PORT || 3001
const APP_ENV_FILE = process.env.APP_ENV_FILE || "/etc/leaddrive/app.env"
const RUNTIME_DIR = process.env.LEADDRIVE_RUNTIME_DIR || "/var/lib/leaddrive-v2"
const LOG_DIR = process.env.LEADDRIVE_LOG_DIR || "/var/lib/leaddrive-v2-logs"
const HELP_VIDEO_ASSET_DIR = process.env.HELP_VIDEO_ASSET_DIR || `${RUNTIME_DIR}/help-videos/player`
const MTM_DOCUMENT_STORAGE_DIR = process.env.MTM_DOCUMENT_STORAGE_DIR || `${RUNTIME_DIR}/uploads/mtm-documents`

module.exports = {
  apps: [
    {
      name: process.env.PM2_NAME || "leaddrive-v2",
      script: `${APP_DIR}/.next/standalone/server.js`,
      cwd: `${APP_DIR}/.next/standalone`,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: APP_PORT,
        HOSTNAME: process.env.APP_HOSTNAME || "127.0.0.1",
        APP_ENV_FILE,
        LEADDRIVE_RUNTIME_DIR: RUNTIME_DIR,
        LEADDRIVE_LOG_DIR: LOG_DIR,
        HELP_VIDEO_ASSET_DIR,
        MTM_DOCUMENT_STORAGE_DIR,
      },
      error_file: `${LOG_DIR}/error.log`,
      out_file: `${LOG_DIR}/out.log`,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      autorestart: true,
      // 512M was far below the app's normal working set (~500–564 MB for this
      // Next.js standalone build with 100+ routes), so pm2 was SIGINT/SIGKILL-
      // restarting the single fork instance every 2–5 min. Each restart left
      // nginx with no upstream → an 8–10 s burst of 502s (HTML), which clients
      // saw as "Unexpected token '<', \"<!DOCTYPE\"" on any fetch().json().
      // Box has ~6.5 GB free; 1536M gives ~3× headroom over steady state and
      // still trips on a genuine runaway leak. (2026-06-07 incident.)
      max_memory_restart: "1536M",
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
    // The softphone relay — the process that joins a salesperson's browser to
    // an answered call. Present ONLY when the server has been given its
    // secrets, which is what keeps today's production file exactly one app
    // long: a relay started without them would crash-loop, and pm2 starts
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
