import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  assertUniqueEnvKeys,
  classifyRegistryRollback,
  parseEnvDocument,
  readDispatchPauseSnapshot,
  readRegistrySnapshot,
  restoreDispatchPause,
  restoreRegistryCapability,
  setDispatchPause,
  setRegistryCapability,
} from "../../.github/scripts/voice-provider-registry-cutover.mjs"

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/set-voice-provider-registry-cutover.yml"),
  "utf8",
)
const operator = readFileSync(
  join(process.cwd(), ".github/scripts/voice-provider-registry-cutover.mjs"),
  "utf8",
)
const voipConfigRoute = readFileSync(
  join(process.cwd(), "src/app/api/v1/voip/config/route.ts"),
  "utf8",
)

describe("PBX registry production cutover workflow", () => {
  it("is manual, default-off, confirmation-gated, and serialized with deploy", () => {
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).toContain("default: disable")
    expect(workflow).toContain('verify-pbx-access) EXPECTED="VERIFY_PBX_ACCESS"')
    expect(workflow).toContain('pause) EXPECTED="PAUSE_PBX_CALL_DISPATCH"')
    expect(workflow).toContain('pause-and-deploy-pbx) EXPECTED="PAUSE_AND_DEPLOY_PBX"')
    expect(workflow).toContain('stage-transport) EXPECTED="STAGE_PBX_REGISTRY_TRANSPORT"')
    expect(workflow).toContain('enable) EXPECTED="ENABLE_PBX_REGISTRY"')
    expect(workflow).toContain('resume) EXPECTED="RESUME_PBX_CALL_DISPATCH"')
    expect(workflow).toContain('disable) EXPECTED="DISABLE_PBX_REGISTRY"')
    expect(workflow).toContain("group: production-deploy")
    expect(workflow).toContain("cancel-in-progress: false")
    expect(workflow).toContain("SERVER_SSH_KNOWN_HOSTS")
    expect(workflow).toContain('ssh-keygen -F "$SERVER_HOST"')
    expect(workflow).not.toContain("ssh-keyscan")
    expect(workflow).toContain("EXPECTED_SHA: ${{ github.sha }}")
    // The marker has to be read from the standalone bundle the deploy swaps
    // atomically, so the proof travels with the running code. Reading it from
    // $APP_DIR made every stage abort on a host that carried a valid marker.
    expect(workflow).toContain('DEPLOY_SHA_FILE="$NODE_DIR/.deploy-sha"')
    expect(workflow).not.toContain('DEPLOY_SHA_FILE="$APP_DIR/.deploy-sha"')
    expect(workflow).toContain('"$DEPLOY_SHA_FILE")" = "$EXPECTED_SHA"')
    // Before the first cutover none of the voice gates exist in the process,
    // so demanding exactly one occurrence made the first pause unrunnable. A
    // duplicated gate is still ambiguous and must still fail closed.
    // The same "absent means false" rule has to hold for the environment file,
    // not only for the process. Comparing the raw empty read against "false"
    // made the final assertion fail on a host whose gates were never written,
    // and it failed without printing anything, so the stage aborted into its
    // rollback with an empty log.
    expect(workflow).toContain('[ -n "$actual" ] || actual=false')
    expect(workflow).toMatch(/assert_file_flag\(\)/u)
    expect(workflow).toContain("in the environment file, expected")
    expect(workflow).toContain('[ "$count" -le 1 ] || return 1')
    expect(workflow).toContain('if [ "$count" -eq 0 ]; then printf \'false\'; return 0; fi')
  })

  it("lets the reachability probe prove PBX access without committing anything", () => {
    // A PBX reachable only from an operator VPN would strand the integrated
    // operation, so this must be answerable before dispatch is ever paused.
    expect(workflow).toContain("- verify-pbx-access")
    // The probe runs the same pinned-host and wrapper-hash preflight...
    expect(workflow).toContain("inputs.operation == 'verify-pbx-access'")
    // ...and is excluded from every step that changes state.
    expect(workflow).toContain("if: inputs.operation != 'verify-pbx-access'")
    const applyIndex = workflow.indexOf("- name: Apply switch with automatic rollback")
    const cutoverIndex = workflow.indexOf("- name: Run no-call PBX TLS")
    expect(applyIndex).toBeGreaterThan(-1)
    expect(cutoverIndex).toBeGreaterThan(-1)
    // The state-changing step must carry the exclusion, not merely mention it.
    expect(workflow.slice(applyIndex, applyIndex + 400))
      .toContain("if: inputs.operation != 'verify-pbx-access'")
    // The PBX mutation stays bound to the integrated operation alone.
    expect(workflow.slice(cutoverIndex, cutoverIndex + 400))
      .toContain("if: inputs.operation == 'pause-and-deploy-pbx'")
  })

  it("keeps step-only contexts out of the job header", () => {
    // GitHub rejects the whole workflow at dispatch time with
    // "Unrecognized named-value: 'runner'" if a job-level env block references
    // a context that only exists inside a step. That makes every operation
    // undispatchable, and no amount of string matching elsewhere catches it.
    const header = workflow.slice(0, workflow.indexOf("    steps:"))
    for (const context of ["runner.", "steps.", "job.", "env."]) {
      expect(header).not.toContain("${{ " + context)
    }
    // The temporary directory is reached through the plain environment
    // variable instead, and exported so later steps share it.
    expect(workflow).toContain('SSH_DIR="$RUNNER_TEMP/cutover-ssh"')
    expect(workflow).toContain('echo "SSH_DIR=$SSH_DIR" >> "$GITHUB_ENV"')
  })

  it("reports staging capability without changing anything on the PBX", () => {
    const at = workflow.indexOf("- name: Report PBX staging capability")
    expect(at).toBeGreaterThan(-1)
    const step = workflow.slice(at, workflow.indexOf("- name: Apply switch with automatic rollback"))
    // The report matters most when the preflight failed, and a step after a
    // failed one is skipped by default.
    expect(step).toContain("if: always() && inputs.operation == 'verify-pbx-access'")
    // Whether the deploy identity may run anything beyond the wrapper decides
    // if unattended staging is possible at all.
    expect(step).toContain("sudo -n -l")
    // A sudoers banner echoes a host name that is not stored as a secret, so
    // GitHub's own masking would not catch it.
    expect(step).toContain("<addr>")
    expect(step).toContain("<host>")
    // The probe must stay a probe.
    for (const mutation of ["apt-get", "install -d", "systemctl start", "systemctl enable", "rm -f", "tar -x", "mkdir -p /var"]) {
      expect(step).not.toContain(mutation)
    }
  })

  it("runs inside the operator network without touching that operator's own SSH setup", () => {
    // A GitHub-hosted runner cannot reach the PBX at all: it times out.
    expect(workflow).toContain("runs-on: [self-hosted, fanum-pbx-vpn]")
    // A self-hosted runner has a real home directory. Writing key material or a
    // pinned known_hosts into ~/.ssh would clobber the operator's own config.
    expect(workflow).toContain('SSH_DIR="$RUNNER_TEMP/cutover-ssh"')
    // Prose may name the path it is warning about; only commands matter here.
    const body = workflow
      .slice(workflow.indexOf("steps:"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n")
    expect(body).not.toMatch(/(^|[^.\w])~\/\.ssh/u)
    expect(body).not.toContain("$HOME/.ssh")
    // Moving known_hosts out of the default location means every connection has
    // to name it, or ssh silently falls back to the runner user's own file and
    // the pinned-key guarantee quietly disappears.
    for (const marker of ["ssh -o ConnectTimeout=30", "scp -o ConnectTimeout=30", "ssh -o ConnectTimeout=10"]) {
      const at = body.indexOf(marker)
      expect(at).toBeGreaterThan(-1)
      expect(body.slice(at, at + 200)).toContain('UserKnownHostsFile="$SSH_DIR"/known_hosts')
    }
    expect(workflow).toContain('chmod 700 "$SSH_DIR"')
    // OpenSSH rejects a private key whose file does not end in a newline with
    // "invalid format", then reports only "Permission denied (publickey)",
    // which reads like a missing authorisation rather than a broken file.
    // deploy.yml gets this right by accident because echo appends one.
    expect(workflow).toContain(`printf '%s\\n' "$SSH_PRIVATE_KEY"`)
    expect(workflow).toContain(`printf '%s\\n' "$PBX_SSH_PRIVATE_KEY"`)
    expect(workflow).not.toMatch(/printf '%s' "\$(PBX_)?SSH_PRIVATE_KEY"/u)
  })

  it("holds the production lock while it verifies and invokes the exact no-call PBX wrapper", () => {
    expect(workflow).toContain("if: inputs.operation == 'pause-and-deploy-pbx'")
    expect(workflow).toContain("PBX_SSH_KNOWN_HOSTS")
    expect(workflow).toContain('ssh-keygen -F "$PBX_HOST"')
    // Rolled forward with every wrapper correction: the proxy site whose digest
    // the wrapper carries, then each patch under scripts/pbx/patches. The test
    // below proves this value is the end of that chain rather than a guess.
    expect(workflow).toContain("EXPECTED_PBX_WRAPPER_SHA256: 03b1b54bc45bf4f8f8b722045aa8bf5fd42d00e6b47b8bada78c30162de4dce2")
    expect(workflow).toContain("--install-boot-fence")
    expect(workflow).toContain("--stage-crm-deployment-sha")
    expect(workflow).toContain('REVIEWED_CRM_SHA: ${{ github.sha }}')
    expect(workflow).toContain('"${SSH[@]}" "sudo -n \'$REMOTE_WRAPPER\'"')
    expect(workflow).toContain("PBX no-call cutover completed under the production deployment lock")
    expect(workflow).not.toContain("ssh-keyscan")
    const preflight = workflow.indexOf("name: Preflight pinned PBX access and reviewed wrapper")
    const pause = workflow.indexOf("name: Apply switch with automatic rollback")
    const pbxDeploy = workflow.indexOf("name: Run no-call PBX TLS and terminal-observer cutover")
    expect(preflight).toBeGreaterThan(0)
    expect(preflight).toBeLessThan(pause)
    expect(pause).toBeLessThan(pbxDeploy)
  })

  it("pins one wrapper digest, and the recorded patches chain into exactly it", () => {
    // The wrapper lives on the PBX, so the only thing the repository can hold
    // is its digest. Two pins drifting apart, or drifting away from the patches
    // that were actually applied, would send the operator at a wrapper nobody
    // reviewed -- and it would surface as a bare digest mismatch mid-cutover.
    const pinned = [...workflow.matchAll(/EXPECTED_PBX_WRAPPER_SHA256: ([0-9a-f]{64})/gu)].map(
      (match) => match[1],
    )
    expect(pinned.length).toBeGreaterThan(1)
    expect(new Set(pinned).size).toBe(1)

    // Each correction states the digest it consumes and the digest it produces,
    // so the record is a chain from the reviewed bundle to what the operator
    // demands. A gap in it means a wrapper state nobody wrote down.
    const patches = [
      "cutover-wrapper-8088-predicate",
      "cutover-wrapper-dialplan-gate",
      "cutover-wrapper-journal-gate",
    ].map((name) =>
      readFileSync(join(process.cwd(), `scripts/pbx/patches/${name}.patch`), "utf8"),
    )
    const digestsOf = (patch: string) => ({
      before: /before: ([0-9a-f]{64})/u.exec(patch)?.[1],
      after: /after:  ([0-9a-f]{64})/u.exec(patch)?.[1],
    })
    const links = patches.map(digestsOf)
    for (const [index, link] of links.entries()) {
      expect(link.before).toBeDefined()
      expect(link.after).toBeDefined()
      if (index > 0) expect(links[index - 1].after).toBe(link.before)
    }

    // The three above were applied to the running wrapper one at a time while
    // calls were down. The bundle was later rebuilt from the same starting
    // point with all of them plus the new transform pin, which is what the
    // operator now demands — so the chain the pin must match is that rebuild,
    // and it has to start where the incident chain started.
    const reconciliation = digestsOf(
      readFileSync(
        join(process.cwd(), "scripts/pbx/patches/cutover-wrapper-bundle-reconciliation.patch"),
        "utf8",
      ),
    )
    expect(reconciliation.before).toBe(links[0].before)

    // The dial-diagnostics coordinator rolled the wrapper's
    // EXPECTED_COORDINATOR_SHA256 forward, which changed the wrapper's own
    // digest — one more recorded link between the rebuild and today's pin.
    const dialDiagnosticsPin = digestsOf(
      readFileSync(
        join(process.cwd(), "scripts/pbx/patches/cutover-wrapper-dial-diagnostics-pin.patch"),
        "utf8",
      ),
    )
    expect(dialDiagnosticsPin.before).toBe(reconciliation.after)

    // The terminal-conflict tombstone rolled the coordinator pin once more
    // right after the dial-diagnostics wrapper reached the PBX, so the pin
    // sits one recorded link ahead of live until the owner's next deploy.
    const terminalConflictPin = digestsOf(
      readFileSync(
        join(process.cwd(), "scripts/pbx/patches/cutover-wrapper-terminal-conflict-pin.patch"),
        "utf8",
      ),
    )
    expect(terminalConflictPin.before).toBe(dialDiagnosticsPin.after)
    expect(terminalConflictPin.after).toBe(pinned[0])

    // The coordinator has the same drift class: its patch chain must end at
    // the digest the staging script demands, or fanum-pbx-stage either refuses
    // the reviewed payload or accepts an unreviewed one.
    const coordinatorChain = [
      "coordinator-originate-deadlock",
      "coordinator-dial-diagnostics",
      "coordinator-terminal-conflict-tombstone",
    ].map((name) =>
      digestsOf(readFileSync(join(process.cwd(), `scripts/pbx/patches/${name}.patch`), "utf8")),
    )
    for (const [index, link] of coordinatorChain.entries()) {
      if (index > 0) expect(link.before).toBe(coordinatorChain[index - 1].after)
    }
    const stage = readFileSync(join(process.cwd(), "scripts/pbx/fanum-pbx-stage"), "utf8")
    const stagedCoordinator = /^([0-9a-f]{64})  fanum_pbx_coordinator\.py$/mu.exec(stage)?.[1]
    expect(stagedCoordinator).toBe(coordinatorChain[2].after)

    // Defect one: Asterisk's proof demanded an empty 8088 while nginx's proof
    // demanded nginx on it, in the same call.
    expect(patches[0]).toContain("-      && verify_no_tcp_listener 8088; then")
    expect(patches[0]).toContain("+      && verify_no_tcp_listener_owned_by 8088 asterisk; then")
    // Defect two: the authorize AGI was looked for in a sibling context.
    expect(patches[1]).toContain('+asterisk -rx "dialplan show fanum-correlated-dial-gate"')
    // Defect three: an error this host logs on every Asterisk start, including
    // the start the rollback performs, was read as damage from the cutover.
    expect(patches[2]).toContain("+  | grep -Fv 'radiusclient-ng/radiusclient.conf'")
  })

  it("records every live PBX fix, and says which pins it leaves stale", () => {
    // Four of the fixes that made AI calls work live on the PBX filesystem, not
    // in this repository: the reviewed control-plane bundle is not checked in.
    // The only thing version control can hold is the patch and its digests, so
    // a missing record is a fix nobody can reproduce -- and, worse, one that a
    // later staging run would silently overwrite.
    const patchDir = "scripts/pbx/patches"
    const read = (name: string) =>
      readFileSync(join(process.cwd(), `${patchDir}/${name}.patch`), "utf8")

    const coordinator = read("coordinator-originate-deadlock")
    // The deadlock: the originate held the lock its own authorization needed.
    expect(coordinator).toContain("+        result = self.ari.originate(authorization, normalized, canonical)")
    expect(coordinator).toContain("-                result = self.ari.originate(authorization, normalized, canonical)")
    // The live coordinator no longer matches what the wrapper pins.
    expect(coordinator).toContain("before: c029001b9da375939af9aed893ad24177b2642a36a218c6a78c8b7cd884f6db6")
    expect(coordinator).toContain("after:  9ac291ac5152940e302d1cb1060b0dc3c5ab0c1b4a69125c4a6c69dba4e8a1f6")

    // The route mode had to follow the call, not the context that dialled.
    expect(read("dialplan-route-mode"))
      .toContain('+ same => n,Set(FANUM_ROUTE_MODE=${IF($["${FANUM_CALL_MODE}"="ai"]?ai:human)})')

    // Playback pacing depends on these two numbers; wrong ones break the line.
    const voice = read("voice-core-playback-and-audio")
    expect(voice).toContain("+                for pos in range(0, len(pcm24), 320):")
    expect(voice).toContain("+                        played = len(chunk24) / 16")
    expect(voice).toContain('+                        "format": {"type": "audio/pcmu"},')

    // The trap is the point of the document: a cutover re-run aborts on the
    // stale coordinator pin, and staging would restore the deadlock.
    const divergence = readFileSync(join(process.cwd(), "docs/pbx-live-divergence.md"), "utf8")
    expect(divergence).toContain("EXPECTED_COORDINATOR_SHA256")
    expect(divergence).toContain("fanum_dialplan_transform.py")
    for (const digest of ["9ac291ac", "d24bae7a", "7e8a92f2"]) {
      expect(divergence).toContain(digest)
    }
  })

  it("derives the only tenant from production env and requires one active Asterisk row", () => {
    expect(operator).toContain('envValue(document, "VOICE_AGENT_ORGANIZATION_ID")')
    expect(operator).toContain('"organizationId" = $1')
    expect(operator).toContain('"channelType" = \'voip\'')
    expect(operator).toContain('"isActive" = true')
    expect(operator).toContain("settings->>'provider', '')) = 'asterisk'")
    expect(operator).toContain("rows.length !== 1")
    expect(workflow).not.toMatch(/organization.?id:\s*\$\{\{\s*inputs\./iu)
  })

  it("keeps automation off and proves TLS, ARI, and HMAC without a call", () => {
    expect(workflow).toContain("assert_automation_off")
    expect(workflow).toContain("export VOICE_CALL_QUEUE_EXECUTION_ENABLED=false")
    expect(workflow).toContain("export VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED=false")
    expect(workflow).toContain('HEALTH_URL="http://127.0.0.1:3001/api/v1/ping"')
    expect(workflow).toContain("VOICE_OUTBOUND_CALL_DISPATCH_PAUSED")
    expect(workflow).toContain("probe_control_plane")
    expect(workflow).toContain("/api/internal/voice-agent/control-plane-test")
    expect(workflow).toContain('assert_runtime_flags "$EXPECTED_PROVIDER" "$EXPECTED_PAUSE"')
    expect(workflow).toContain("calls_placed=0")
    expect(workflow).not.toContain("/api/v1/calls")
    expect(workflow).not.toContain("/ari/")
    expect(workflow).not.toContain("Originate")
    expect(operator).not.toContain("fetch(")
  })

  it("contains database, environment, process, and health rollback", () => {
    expect(workflow).toContain("CUTOVER_ACTION=rollback")
    expect(workflow).toContain('cp --preserve=mode,ownership "$ENV_BACKUP" "$restore_stage"')
    expect(workflow).toContain('restart_safely "$OLD_RUNTIME_FLAG"')
    expect(workflow).toContain("health_check")
    expect(operator).toContain("pg_advisory_xact_lock")
    // pg_advisory_xact_lock() returns void and $queryRaw* throws trying to
    // deserialize it. The same defect was fixed in the VoIP config route, the
    // dispatch lock and the attestation; this call site was missed and every
    // cutover stage died on it, reported only as a generic failure.
    expect(operator).toMatch(/\$executeRawUnsafe\(\s*\n?\s*"SELECT pg_advisory_xact_lock/u)
    expect(operator).not.toMatch(/\$queryRawUnsafe\(\s*\n?\s*"SELECT pg_advisory_xact_lock/u)
    expect(operator).toContain("`voip-config:${organizationId}`")
    expect(voipConfigRoute).toContain("`voip-config:${auth.orgId}`")
    expect(operator).not.toContain("voice-provider-registry-cutover:${organizationId}")
    expect(operator).toContain("FOR UPDATE")
    expect(operator).toContain("restoreRegistryCapability")
    // A technical setting that was never written is off. Requiring the key to
    // be present made "verify that this is disabled" unsatisfiable on a tenant
    // that had never been through a cutover -- the state every first cutover
    // starts from -- and it broke resume, leaving dispatch paused with no
    // supported way back.
    expect(operator).toContain("const effective = current.present ? current.value : false")
    expect(operator).not.toContain("if (!current.present || current.value !== runtime.target)")
    expect(operator).toContain('const environmentValue = raw === "" ? "false" : raw')
  })

  it("reads an unset capability as disabled", () => {
    // readRegistrySnapshot reports absence rather than a value, and every
    // caller has to fold that into false the same way.
    const untouched = { provider: "asterisk" }
    const snapshot = readRegistrySnapshot(untouched)
    expect(snapshot.present).toBe(false)
    const effective = snapshot.present ? snapshot.value : false
    expect(effective).toBe(false)

    const enabled = setRegistryCapability(untouched, true)
    const enabledSnapshot = readRegistrySnapshot(enabled)
    expect(enabledSnapshot.present).toBe(true)
    expect(enabledSnapshot.present ? enabledSnapshot.value : false).toBe(true)
  })
})

describe("PBX registry operator helpers", () => {
  it("parses quoted env values and rejects duplicate critical keys", () => {
    const parsed = parseEnvDocument([
      "DATABASE_URL='postgresql://example.invalid/db'",
      'VOICE_AGENT_ORGANIZATION_ID="pilot"',
    ].join("\n"))
    expect(parsed.values.get("DATABASE_URL")).toBe("postgresql://example.invalid/db")
    expect(parsed.values.get("VOICE_AGENT_ORGANIZATION_ID")).toBe("pilot")
    expect(() => assertUniqueEnvKeys(parsed, ["DATABASE_URL"])).not.toThrow()

    const duplicate = parseEnvDocument("FLAG=false\nFLAG=true\n")
    expect(() => assertUniqueEnvKeys(duplicate, ["FLAG"])).toThrow(
      "A required production environment key is ambiguous",
    )
  })

  it("changes and restores only the registry capability", () => {
    const original = { provider: "asterisk", password: "preserved" }
    const snapshot = readRegistrySnapshot(original)
    const enabled = setRegistryCapability(original, true)

    expect(enabled).toEqual({ ...original, voiceAttemptRegistryEnabled: true })
    expect(original).not.toHaveProperty("voiceAttemptRegistryEnabled")
    expect(restoreRegistryCapability(enabled, snapshot)).toEqual(original)
  })

  it("changes and restores only the durable dispatch pause", () => {
    const original = { provider: "asterisk", password: "preserved" }
    const snapshot = readDispatchPauseSnapshot(original)
    const paused = setDispatchPause(original, true)

    expect(paused).toEqual({ ...original, outboundCallDispatchPaused: true })
    expect(original).not.toHaveProperty("outboundCallDispatchPaused")
    expect(restoreDispatchPause(paused, snapshot)).toEqual(original)
  })

  it("preserves an explicitly stored prior boolean during rollback", () => {
    const original = {
      provider: "asterisk",
      voiceAttemptRegistryEnabled: true,
      unrelated: "preserved",
    }
    const snapshot = readRegistrySnapshot(original)
    const disabled = setRegistryCapability(original, false)

    expect(restoreRegistryCapability(disabled, snapshot)).toEqual(original)
  })

  it("detects concurrent capability drift without overwriting it", () => {
    const state = {
      setting: "registry",
      target: true,
      original: { present: false, value: null },
    }
    expect(classifyRegistryRollback(
      { provider: "asterisk", voiceAttemptRegistryEnabled: true },
      state,
    )).toBe("restore")
    expect(classifyRegistryRollback({ provider: "asterisk" }, state)).toBe("already_restored")
    expect(() => classifyRegistryRollback(
      { provider: "asterisk", voiceAttemptRegistryEnabled: false },
      state,
    )).toThrow("The Asterisk configuration changed after cutover")
  })
})
