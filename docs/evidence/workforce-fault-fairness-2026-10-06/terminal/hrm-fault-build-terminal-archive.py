import json,pathlib,hashlib,datetime
B=pathlib.Path('/tmp');prefix='docs/evidence/workforce-fault-fairness-2026-10-06/terminal/'
source=json.load(open(B/'hrm-fault-source-archive-manifest.json'))
known={x['source_path']:x for x in source['original_files']}
names=['hrm-fault-accept-terminal.py','hrm-fault-build-terminal-archive.py','hrm-fault-tests-typecheck.txt','hrm-fault-root-terminal-acceptance.json','hrm-fault-terminal-metadata.json','hrm-fault-independent-terminal-20261006.json','hrm-fault-root-source-acceptance.json','hrm-fault-root-durable-source.json','hrm-fault-historical-independent-durability-20261006.json','hrm-fault-independent-source-durable-20261006.json','hrm-fault-source-archive-publication.json','hrm-fault-source-archive-readback.json','hrm-fault-restore-artifact-metadata.json','hrm-fault-restore-attempt1-sanitized.json','hrm-fault-restore-attempt1-root.json','hrm-fault-validate-restore.py','hrm-fault-restore-independent-review-20261006.json','hrm-fault-next-dependencies.md']
files={str(B/n) for n in names};seen=set();local={x['path']:x for x in source['local_only_supports']}
def binds(x):
 if isinstance(x,dict):
  if isinstance(x.get('path'),str) and x['path'].startswith('/tmp/') and 'sha256' in x:yield x
  for v in x.values():yield from binds(v)
 elif isinstance(x,list):
  for v in x:yield from binds(v)
while files-seen:
 name=sorted(files-seen)[0];seen.add(name);p=pathlib.Path(name)
 if not p.exists():raise RuntimeError('Missing '+name)
 if p.suffix!='.json':continue
 for x in binds(json.loads(p.read_text())):
  q=pathlib.Path(x['path']);b=q.read_bytes();assert hashlib.sha256(b).hexdigest()==x['sha256'],str(q)
  if 'bytes' in x:assert len(b)==x['bytes'],str(q)
  if str(q) in known:continue
  if len(b)>1000000 and any(s in q.name for s in ['archive-elements','remote','independent-tree','archive-contents','large-blobs','provenance']):
   local[str(q)]={'path':str(q),'bytes':len(b),'sha256':x['sha256'],'reason':'LOCAL_ONLY GitHub transport/content-copy; exact originals recoverable from immutable source/evidence commits and manifest blob identities. Not archived-original credit.'}
  else:files.add(str(q))
files.difference_update(local);files.difference_update(known)
records=[];elements=[]
for name in sorted(files):
 p=pathlib.Path(name);b=p.read_bytes();dest=prefix+p.name
 records.append({'source_path':name,'archive_path':dest,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'blob':hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()})
 elements.append({'path':dest,'mode':'100644','type':'blob','content':b.decode()})
assert len({x['path'] for x in elements})==len(elements)
terminal=json.load(open(B/'hrm-fault-root-terminal-acceptance.json'))
manifest={'status':'EXACT_HEAD_BOUNDED_CANDIDATE_READY_NO_PRODUCTION_ACTIVATION','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':source['head'],'tree':source['tree'],'main':source['main'],'synthetic':source['synthetic'],'sourceArchive':'a10975647599a004e44d25953e00971400bdd989','historical8053Archive':'b0d41908058093c41d18910d1d6bd470ba8847f2','source_archive_originals':source['original_files'],'original_files':records,'local_only_supports':list(local.values()),'acceptance':terminal,'canonical':'82/161DONE,79open,59%,14/15gates; fullHRM/privacy/C12 acceptance remains incomplete'}
mt=json.dumps(manifest,indent=2)+'\n';(B/'hrm-fault-terminal-archive-manifest.json').write_text(mt);elements.append({'path':prefix+'manifest.json','mode':'100644','type':'blob','content':mt})
readme=f'''# PR589 bounded candidate ready: exact b896

Source `{source['head']}`, tree `{source['tree']}`, integrated main `{source['main']}`.
Tested synthetic `{source['synthetic']}` has the same tree. All five required checks
and six additional Workforce checks pass; nine workflows, first attempt. The
ordinary optional PR production build is skipped by existing policy. No raw CI
logs or screenshots were read. Restore safe JSON:15PASS,2cleanup,10auth,34source
bindings; bounded geometry/native keyboard qualifications remain in the receipt.
Other five browser-lane artifact payloads are metadata-only, not new visual credit.

Independent exact-source, restore, hosted and archive evidence is preserved.
The earlier source packet's HOSTED_PENDING words are historical and are superseded
only by these additive terminal receipts. The prior8053 frozen67-file collection
is unchanged atb0d419; it retains its own original base and limitations.

Current source includes eight bounded fault/fairness scenarios and PR594 retention
compatibility, real disposable Redis/PG runs, raw512KiB/canonical64KiB push limits,
and runtime telemetry guards. It preserves PR595–597 as exact accepted main blobs.
Initial broad failures, opt-in skips and55/57historical compiler diagnostics remain
explicit; passing baseline gates is not a global clean compiler/full-suite claim.

{len(records)} new terminal originals plus manifest/README are archived. The99source
originals are retained at their existing paths, not duplicated or counted twice.
Explicit LOCAL_ONLY transport copies are listed with hashes and recoverable Git
identities; they are not represented as durable original files. Prior38privacy,
42request,34logging and29roster originals remain preserved in the evidence chain.

This is candidate readiness, not wholeHRM acceptance. Shared auth/Pino/Sentry,
release/principal cardinality and destinations, signed-device/offline recovery,
representative load/failover and historical api_keys staging provenance remain
open. See the next-dependencies document.82/161DONE,79open,59%,14/15gates unchanged.
No merge, deployment, production activation, credential/permission change,
migration-history/baseline edit or own Support feature change was performed.
'''
elements.append({'path':prefix+'README.md','mode':'100644','type':'blob','content':readme})
payload=json.dumps(elements,ensure_ascii=False);(B/'hrm-fault-terminal-archive-elements.json').write_text(payload)
chunks=B/'hrm-fault-terminal-chunks';chunks.mkdir(exist_ok=True)
for i in range(0,len(payload),90000):(chunks/f'{i//90000:03d}.json').write_text(json.dumps(payload[i:i+90000],ensure_ascii=False))
summary={'originals':len(records),'files':len(elements),'localOnly':len(local),'chars':len(payload),'chunks':(len(payload)+89999)//90000};(B/'hrm-fault-terminal-summary.json').write_text(json.dumps(summary));print(json.dumps(summary))
