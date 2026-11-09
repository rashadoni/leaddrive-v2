import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "../..")
const INSTALLER = join(ROOT, "scripts/nginx-install-access-log.sh")
const FORMAT = readFileSync(join(ROOT, "ops/nginx/leaddrive-log-format.conf"), "utf8")
const SNIPPET = readFileSync(join(ROOT, "ops/nginx/leaddrive-access-log.conf"), "utf8")
const INCLUDE = "    include snippets/leaddrive-access-log.conf;"

const directives = (source: string) =>
  source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")

// The log_format's single-quoted pieces, concatenated as nginx does.
function formatString(source: string): { name: string; body: string } {
  const statement = directives(source).match(/log_format\s+(\S+)\s+((?:'[^']*'\s*)+);/)
  expect(statement).not.toBeNull()
  const body = [...statement![2].matchAll(/'([^']*)'/g)].map((m) => m[1]).join("")
  return { name: statement![1], body }
}

// The sites as they stand on production (2026-11-09), trimmed to their shape:
// every server block opens with the error-pages include; the catch-all is a
// symlink into sites-available.
const APP_SITE = `server {
    include snippets/leaddrive-error-pages.conf;
    include snippets/leaddrive-deny-cron.conf;
    include snippets/leaddrive-station-routes.conf;
    include snippets/leaddrive-web-routes.conf;
 server_name app.leaddrivecrm.org;
  location / { proxy_pass http://leaddrive_web; proxy_http_version 1.1;
    proxy_read_timeout 86400; client_max_body_size 20m; }
    listen 443 ssl; # managed by Certbot
}
server {
    include snippets/leaddrive-error-pages.conf;
    if ($host = app.leaddrivecrm.org) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

 server_name app.leaddrivecrm.org;
    include snippets/leaddrive-deny-cron.conf;
  listen 80;
    return 404; # managed by Certbot
}
`

describe("the timed access-log format", () => {
  it("is nginx's combined line word for word, with the timing fields only appended", () => {
    const { name, body } = formatString(FORMAT)
    expect(name).toBe("leaddrive_timed")
    // nginx's predefined `combined`. Anything reading the log as combined —
    // logrotate, the log shipping, an awk over $1/$7/$9 — must keep working.
    const combined =
      '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"'
    expect(body.startsWith(combined + " ")).toBe(true)
    const tail = body.slice(combined.length + 1)
    expect(tail).toBe(
      'rt=$request_time urt="$upstream_response_time" ua="$upstream_addr" us="$upstream_status"',
    )
  })

  it("is written by the snippet to the same access.log, by name", () => {
    const access = directives(SNIPPET).match(/^access_log\s+(\S+)\s+(\S+);$/m)
    expect(access?.[1]).toBe("/var/log/nginx/access.log")
    expect(access?.[2]).toBe(formatString(FORMAT).name)
    // One access_log in the snippet: a second would write each request twice.
    expect(directives(SNIPPET).match(/^\s*access_log\b/gm)).toHaveLength(1)
  })
})

const CATCHALL_SITE = `# Any domain not matching explicit server_name blocks lands here
server {
    include snippets/leaddrive-error-pages.conf;
    listen 80 default_server;
    server_name _;
    include snippets/leaddrive-deny-cron.conf;
    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}
`

describe("scripts/nginx-install-access-log.sh", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function host(app = APP_SITE, nginxExit = 0) {
    const dir = mkdtempSync(join(tmpdir(), "nginx-access-log-"))
    dirs.push(dir)
    for (const sub of ["conf.d", "snippets", "bin", "backups", "sites-available", "sites-enabled"]) {
      mkdirSync(join(dir, sub))
    }
    const appPath = join(dir, "sites-enabled/app.leaddrivecrm.org")
    const catchallTarget = join(dir, "sites-available/custom-domains-catchall")
    const catchallPath = join(dir, "sites-enabled/custom-domains-catchall")
    writeFileSync(appPath, app)
    writeFileSync(catchallTarget, CATCHALL_SITE)
    symlinkSync(catchallTarget, catchallPath)
    const calls = join(dir, "calls.log")
    const fake = (name: string, exit: number) => {
      const path = join(dir, "bin", name)
      writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "${calls}"\nexit ${exit}\n`)
      chmodSync(path, 0o755)
      return path
    }
    const env = {
      ...process.env,
      NGINX_SITES_DIR: join(dir, "sites-enabled"),
      NGINX_CONF_D: join(dir, "conf.d"),
      NGINX_SNIPPETS: join(dir, "snippets"),
      NGINX_BIN: fake("nginx", nginxExit),
      SYSTEMCTL_BIN: fake("systemctl", 0),
      BACKUP_PARENT: join(dir, "backups"),
    }
    const run = (...args: string[]) => spawnSync("bash", [INSTALLER, ...args], { env, encoding: "utf8" })
    const site = () => readFileSync(appPath, "utf8")
    const catchall = () => readFileSync(catchallPath, "utf8")
    const called = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "")
    return { dir, run, site, catchall, catchallPath, called }
  }

  const blocksOf = (source: string) => source.split(/^server \{/m).slice(1)
  const withoutInclude = (source: string) => source.split("\n").filter((l) => l !== INCLUDE).join("\n")

  it("includes the snippet once in every server block of every site, right after its error pages, then tests and reloads", () => {
    const h = host()
    const result = h.run("--apply")
    expect(result.status, result.stdout + result.stderr).toBe(0)

    const blocks = [...blocksOf(h.site()), ...blocksOf(h.catchall())]
    expect(blocks).toHaveLength(3)
    for (const block of blocks) {
      const lines = block.split("\n")
      expect(lines.filter((l) => l === INCLUDE)).toHaveLength(1)
      expect(lines[lines.indexOf("    include snippets/leaddrive-error-pages.conf;") + 1]).toBe(INCLUDE)
    }
    // Nothing else changed, and the symlinked site is still a symlink.
    expect(withoutInclude(h.site())).toBe(APP_SITE)
    expect(withoutInclude(h.catchall())).toBe(CATCHALL_SITE)
    expect(lstatSync(h.catchallPath).isSymbolicLink()).toBe(true)

    expect(readFileSync(join(h.dir, "conf.d/leaddrive-log-format.conf"), "utf8")).toBe(FORMAT)
    expect(readFileSync(join(h.dir, "snippets/leaddrive-access-log.conf"), "utf8")).toBe(SNIPPET)
    // Reload, never restart; and only after nginx -t passed.
    expect(h.called()).toBe("nginx -t\nsystemctl reload nginx\n")
    // The previous sites are kept.
    const [backup] = readdirSync(join(h.dir, "backups"))
    const kept = readdirSync(join(h.dir, "backups", backup))
      .filter((f) => f.startsWith("site."))
      .map((f) => readFileSync(join(h.dir, "backups", backup, f), "utf8"))
      .sort()
    expect(kept).toEqual([APP_SITE, CATCHALL_SITE].sort())
  })

  it("is idempotent: a second run changes nothing", () => {
    const h = host()
    expect(h.run("--apply").status).toBe(0)
    const once = [h.site(), h.catchall()]
    expect(h.run("--apply").status).toBe(0)
    expect([h.site(), h.catchall()]).toEqual(once)
    expect(h.run().stdout).not.toContain("include in every server block: no")
  })

  it("puts every file back and reloads nothing when nginx -t refuses", () => {
    const h = host(APP_SITE, 1)
    const result = h.run("--apply")
    expect(result.status).toBe(1)
    expect(h.site()).toBe(APP_SITE)
    expect(h.catchall()).toBe(CATCHALL_SITE)
    expect(lstatSync(h.catchallPath).isSymbolicLink()).toBe(true)
    expect(existsSync(join(h.dir, "conf.d/leaddrive-log-format.conf"))).toBe(false)
    expect(existsSync(join(h.dir, "snippets/leaddrive-access-log.conf"))).toBe(false)
    expect(h.called()).not.toContain("systemctl")
  })

  it("refuses when any server block lacks the anchor, leaving every site untouched", () => {
    const app = APP_SITE.replace(/(server \{\n)    include snippets\/leaddrive-error-pages\.conf;\n(    if)/, "$1$2")
    expect(app).not.toBe(APP_SITE)
    const h = host(app)
    expect(h.run("--apply").status).toBe(1)
    expect(h.site()).toBe(app)
    expect(h.catchall()).toBe(CATCHALL_SITE)
    expect(h.called()).toBe("")
  })

  it("--remove returns every site to exactly what it was", () => {
    const h = host()
    expect(h.run("--apply").status).toBe(0)
    expect(h.run("--remove").status).toBe(0)
    expect(h.site()).toBe(APP_SITE)
    expect(h.catchall()).toBe(CATCHALL_SITE)
  })

  it("the dry run changes nothing", () => {
    const h = host()
    const result = h.run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("include in every server block: no")
    expect(h.site()).toBe(APP_SITE)
    expect(h.catchall()).toBe(CATCHALL_SITE)
    expect(h.called()).toBe("")
  })
})
