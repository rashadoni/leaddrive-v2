import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const probePath = "scripts/pbx/fanum-inbound-readiness-probe"

describe("inbound PBX readiness probe", () => {
  it("is root-only, read-only, redacted, and incapable of placing a call", () => {
    const probe = readFileSync(probePath, "utf8")

    expect(probe).toContain('[ "$(id -u)" = "0" ]')
    expect(probe).toContain('[ "$#" -eq 0 ]')
    expect(probe).toContain("systemctl is-active asterisk")
    expect(probe).toContain("systemctl is-active fanum-voice")
    expect(probe).toContain("pjsip show endpoint fanum-provider")
    expect(probe).toContain("dialplan show")
    expect(probe).toContain("redact_stream")
    expect(probe).toContain("sha256sum")
    expect(probe).toContain("no file, service, or call was changed")

    expect(probe).not.toMatch(
      /^\s*(?!#).*\bsystemctl\s+(?:start|stop|restart|reload|enable|disable)\b/m,
    )
    expect(probe).not.toMatch(
      /^\s*(?!#).*\basterisk\s+-rx\s+["'][^"']*\b(?:channel\s+originate|originate)\b/im,
    )
    expect(probe).not.toMatch(/^\s*(?!#).*\b(?:cp|mv|rm|install|tee|truncate|chmod|chown)\b/m)
    expect(probe).not.toMatch(/^\s*(?!#).*(?:\bsource\b|\.\s+[^#\n]*\.env\b)/m)
    expect(probe).not.toMatch(/^\s*(?!#).*\b(?:cat|printenv)\b/m)
  })

  it("reports ARI and queue applications that can own the inbound route", () => {
    const probe = readFileSync(probePath, "utf8")

    // A context can hand the channel to ARI and then contain only Hangup after
    // Stasis returns. Omitting Stasis makes a working route look like an
    // immediate rejection and is not sufficient evidence for a safe patch.
    expect(probe).toMatch(/line ~ \/stasis\\\(/)
    expect(probe).toMatch(/line ~ \/queue\\\(/)
  })
})
