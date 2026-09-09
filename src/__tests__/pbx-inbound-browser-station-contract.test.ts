import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const helperPath = "scripts/pbx/fanum-inbound-browser-agi.py"
const transformPath = "scripts/pbx/fanum-inbound-dialplan-transform.py"
const dialplanPath = "scripts/pbx/fanum-inbound-browser.conf"
const installerPath = "scripts/pbx/fanum-inbound-browser-install"
const servicePath = "scripts/pbx/payload/fanum-inbound-browser-spool.service"
const timerPath = "scripts/pbx/payload/fanum-inbound-browser-spool.timer"

describe("inbound browser station bundle", () => {
  it("passes the executable AGI lifecycle and retry suite", () => {
    expect(() => execFileSync(
      "python3",
      ["-m", "unittest", "discover", "-s", "scripts/pbx/tests", "-p", "test_*.py"],
      { encoding: "utf8", stdio: "pipe" },
    )).not.toThrow()
  })

  it("routes the station-local exact DID and answers after readiness", () => {
    const dialplan = readFileSync(dialplanPath, "utf8")
    const transform = readFileSync(transformPath, "utf8")

    expect(transform).toContain("from-fanum-provider")
    expect(transform).toContain('DESTINATION_ALIAS = "fanum-inbound-browser"')
    expect(transform).toContain(
      'TARGET_APPLICATION = f"Gosub(fanum-inbound-browser,s,1({DESTINATION_ALIAS}))"',
    )
    expect(transform).not.toContain("Gosub(fanum-inbound-browser,s,1(${EXTEN}))")
    expect(transform).toContain("_review_wildcard")
    expect(transform).toContain("read_selector")
    expect(transform).toContain("provider's five-step wildcard remains byte-for-byte intact")
    expect(transform).not.toMatch(/print\([^\n]*(?:did|extension)/i)
    expect(dialplan).not.toMatch(/exten\s*=>\s*_[XZN!.]/)
    expect(dialplan).toContain("Ringing()")
    expect(dialplan).toContain("fanum-inbound-browser-agi.py,ringing")
    expect(dialplan).toContain("fanum-inbound-browser-agi.py,ready")
    expect(dialplan).toContain("FANUM_BROWSER_READY")
    expect(dialplan.indexOf("same => n(answer),Answer()")).toBeGreaterThan(
      dialplan.indexOf("FANUM_BROWSER_READY"),
    )
    expect(dialplan).toContain("AudioSocket(${FANUM_SAFE_CALL_ID},127.0.0.1:9093)")
    expect(dialplan).toContain("hangup_handler_push")
    expect(dialplan).toContain("fanum-inbound-browser-agi.py,terminal")
  })

  it("creates the AudioSocket UUID in the AGI without func_uuid.so", () => {
    const helper = readFileSync(helperPath, "utf8")
    const dialplan = readFileSync(dialplanPath, "utf8")
    const installer = readFileSync(installerPath, "utf8")

    expect(helper).toContain('mode == "identify"')
    expect(helper).toContain('"__FANUM_SAFE_CALL_ID"')
    expect(dialplan).toContain("fanum-inbound-browser-agi.py,identify")
    expect(dialplan).not.toContain("${UUID()}")
    expect(installer).not.toContain("func_uuid.so")

    const clearId = dialplan.indexOf("Set(__FANUM_SAFE_CALL_ID=)")
    const identify = dialplan.indexOf("fanum-inbound-browser-agi.py,identify")
    const agiStatusGate = dialplan.indexOf(
      'GotoIf($["${AGISTATUS}" = "SUCCESS"]?agi-succeeded:invalid-id)',
    )
    const uuidLengthGate = dialplan.indexOf(
      "n(agi-succeeded),GotoIf($[${LEN(${FANUM_SAFE_CALL_ID})} = 36]?identified:invalid-id)",
    )
    const terminalHandler = dialplan.indexOf("hangup_handler_push")
    const ringing = dialplan.indexOf("Ringing()")

    expect(clearId).toBeGreaterThan(-1)
    expect(identify).toBeGreaterThan(clearId)
    expect(agiStatusGate).toBeGreaterThan(identify)
    expect(uuidLengthGate).toBeGreaterThan(agiStatusGate)
    expect(terminalHandler).toBeGreaterThan(uuidLengthGate)
    expect(ringing).toBeGreaterThan(terminalHandler)
  })

  it("installs fail-closed without exposing secrets or disturbing the AI path", () => {
    const installer = readFileSync(installerPath, "utf8")

    expect(installer).toContain('[ "$(id -u)" = "0" ]')
    expect(installer).toContain("fanum-inbound-dialplan-transform.py")
    expect(installer).toContain('/etc/fanum-inbound-browser.did')
    expect(installer).toContain('root:root 600')
    expect(installer).toContain('--verify-selector')
    expect(installer).not.toMatch(/\bread\s+[^\n]*(?:DID|EXTENSION)/i)
    expect(installer).not.toMatch(/FANUM_INBOUND_DID=/)
    expect(installer).not.toMatch(/(?:printf|echo)[^|\n]*INBOUND_SELECTOR/i)
    expect(installer).toContain("sha256sum")
    expect(installer).toContain("EXPECTED_EXTENSIONS_FANUM_SHA256")
    expect(installer).toContain("--preflight")
    expect(installer.indexOf("--preflight")).toBeLessThan(installer.indexOf("changed=1"))
    expect(installer).toContain("--verify-loaded")
    expect(installer).toContain("provider_config_references")
    expect(installer).toContain("--verify-browser-loaded")
    expect(installer).toContain("terminal_report")
    expect(installer).toContain("browser_config_references")
    expect(installer).toContain("terminal_config_references")
    expect(installer).not.toContain("for required in 'Ringing('")
    expect(installer).toContain('install_mode="reapply"')
    expect(installer).toContain("AI_BEFORE")
    expect(installer).toContain("AI_AFTER")
    expect(installer).toContain('asterisk -rx "dialplan reload"')
    expect(installer).toMatch(/systemctl is-active (?:--quiet )?fanum-softphone-bridge/)
    expect(installer).toMatch(/systemctl is-active (?:--quiet )?fanum-softphone-tunnel/)
    expect(installer).not.toMatch(/asterisk\s+-rx\s+["'][^"']*(?:originate|channel\s+originate)/i)
    expect(installer).not.toMatch(/systemctl\s+(?:restart|stop|start)\s+(?:asterisk|fanum-voice)\b/)
    expect(installer).not.toMatch(/(?:cat|printf|echo)[^\n]*(?:TOKEN|SECRET|PASSWORD)/i)
    expect(installer).not.toMatch(/(?:^|\s)(?:source|\.)\s+[^\n]*\.env/m)
    expect(installer).toMatch(
      /timer_was_active[\s\S]*systemctl restart fanum-inbound-browser-spool\.timer[\s\S]*systemctl stop fanum-inbound-browser-spool\.timer/,
    )
  })

  it("reports rollback success only after proving files and loaded dialplan were restored", () => {
    const installer = readFileSync(installerPath, "utf8")

    expect(installer).toContain("loaded_context_fingerprint")
    expect(installer).toContain("loaded_contexts_before_sha256")
    expect(installer.indexOf("loaded_contexts_before_sha256")).toBeLessThan(
      installer.indexOf("changed=1"),
    )
    expect(installer).toContain("verify_restored_file")
    expect(installer).toContain("rollback_failed=0")
    expect(installer).toContain("rollback_failed=1")
    expect(installer).toContain("loaded_contexts_after_sha256")
    expect(installer).toContain("rollback incomplete")
    expect(installer).toMatch(
      /if \[ "\$rollback_failed" = "0" \]; then[\s\S]*rolled back; no call was placed[\s\S]*else[\s\S]*rollback incomplete/,
    )
    expect(installer).not.toMatch(/printf[^\n]*loaded_contexts_(?:before|after)/)
  })

  it("restores runtime directories when installation fails after its first mutation", () => {
    const installer = readFileSync(installerPath, "utf8")
    const changedAt = installer.indexOf("\nchanged=1\n")
    const firstRuntimeDirectoryInstall = installer.indexOf(
      'install -d -o root -g asterisk -m 0750 "$helper_directory"',
    )

    expect(changedAt).toBeGreaterThan(0)
    expect(firstRuntimeDirectoryInstall).toBeGreaterThan(0)
    expect(changedAt).toBeLessThan(firstRuntimeDirectoryInstall)
    expect(installer).toContain("backup_directory")
    expect(installer).toContain("restore_directory")
    expect(installer).toContain("verify_restored_directory")
    expect(installer).toContain('restore_directory "$helper_directory" helper_directory')
    expect(installer).toContain('restore_directory "$SPOOL_DIR" spool_directory')
    expect(installer).toContain('restore_directory "$STATE_DIR" state_directory')
    expect(installer).toContain('rmdir -- "$path"')
  })

  it("keeps retries bounded and isolated in an asterisk-owned spool", () => {
    const helper = readFileSync(helperPath, "utf8")
    const service = readFileSync(servicePath, "utf8")
    const timer = readFileSync(timerPath, "utf8")

    expect(helper).toContain("MAX_SPOOL_FILES")
    expect(helper).toContain("flock")
    expect(helper).toContain("VOICE_CRM_RUNTIME_TOKEN")
    expect(helper).not.toMatch(/print\([^\n]*(?:token|from_number|to_number)/i)
    expect(service).toContain("User=asterisk")
    expect(service).toContain("--drain-spool")
    expect(service).toContain("ProtectSystem=strict")
    expect(timer).toContain("OnUnitInactiveSec=10s")
  })
})
