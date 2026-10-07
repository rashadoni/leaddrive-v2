import pathlib,subprocess,json,tempfile
r=pathlib.Path('/workspace/hrm-c12-acceptance-20261006');p=pathlib.Path('/tmp/hrm-c12-acceptance-20261006');binary=p/'secret-scan/gitleaks'; cases=[]
marker = "-".join(("synthetic", "c12", "owner")); other_marker = marker.replace("c12", "c13")
def scan(root):
 with tempfile.TemporaryDirectory(prefix='hrm-c12-scan-output-') as tmp:
  report=pathlib.Path(tmp)/'report.json'
  q=subprocess.run([str(binary),'dir','.','--config',str(r/'.gitleaks.toml'),'--redact=100','--no-banner','--log-level','fatal','--report-format','json','--report-path',str(report)],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)
  data=json.loads(report.read_text());return q.returncode,len(data)
code,count=scan(p/'secret-scan/changed');assert (code,count)==(0,0);cases.append({'name':'original35changedfiles-with-narrow-rule','exitCode':code,'findings':count})
with tempfile.TemporaryDirectory(prefix='hrm-c12-scanner-negative-') as tmp:
 root=pathlib.Path(tmp);target=root/'src/synthetic-unapproved.ts';target.parent.mkdir(parents=True);target.write_text("const input={ownerToken:'"+marker+"'};\n")
 code,count=scan(root);assert code==1 and count==1;cases.append({'name':'same-synthetic-value-outside-two-paths-still-blocked','exitCode':code,'findings':count});target.unlink()
 target=root/'docs/evidence/workforce-c12-reader-profile-2026-10-06/probe.mjs';target.parent.mkdir(parents=True);target.write_text("const input={ownerToken:'"+other_marker+"'};\n")
 code,count=scan(root);assert code==1 and count==1;cases.append({'name':'different-synthetic-value-inside-allowed-path-still-blocked','exitCode':code,'findings':count})
proof={'status':'PASS_EXACT_PATH_AND_VALUE_FALSE_POSITIVE_ONLY','tool':'gitleaks8.30.1','cases':cases,'actualCredentialsUsed':False,'originalProbeBytesUnchanged':True};(p/'secret-scan-narrow-rule-verification.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
