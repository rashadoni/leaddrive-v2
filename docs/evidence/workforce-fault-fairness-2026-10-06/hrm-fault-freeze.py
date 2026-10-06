import json,pathlib,hashlib,stat,collections
root=pathlib.Path('/workspace/hrm-integration-fault')
parent=json.load(open('/tmp/hrm-privacy-independent-remote-tree.json'))
old={e['path']:e for e in parent['tree'] if e['type']=='blob'}
incoming={e['path']:e for e in json.load(open('/tmp/hrm-fault-main-files.json'))}
incoming.update({e['path']:e for e in json.load(open('/tmp/hrm-fault-main-advance-files.json'))})
incoming.update({e['path']:e for e in json.load(open('/tmp/hrm-fault-main-advance2-files.json'))})
own=['src/lib/mtm/mobile-sync-push-bounds.ts','src/app/api/v1/mtm/mobile/sync/push/route.ts','src/lib/mtm/mobile-gps-telemetry.ts','src/lib/mtm/mobile-media-telemetry.ts','src/lib/mtm/mobile-sync-telemetry.ts','src/__tests__/api-mtm-mobile-sync-v2-fault-fairness.test.ts','src/__tests__/workforce-sync-fairness.test.ts','src/__tests__/workforce-sync-push-bounds.test.ts','src/__tests__/workforce-pr594-retention-compatibility.test.ts','src/__tests__/workforce-pr594-membership-postgres.test.ts','src/__tests__/workforce-entitlement-failure-matrix.test.ts','src/__tests__/workforce-aux-telemetry-privacy.test.ts','docs/workforce-c12-fault-fairness-matrix-2026-10-06.md','docs/workforce-hrm-completion-roadmap-2026-08-30.md','docs/workforce-hrm-session-log.md','docs/workforce-privacy-audit-2026-10-06.md']
assert not set(own)&set(incoming)
def gh(kind,b):return hashlib.sha1(kind.encode()+b' '+str(len(b)).encode()+b'\0'+b).hexdigest()
paths=sorted(set(old)|set(incoming)|set(own));dirs={};bindings=[];elements=[];changes=[]
for p in paths:
 f=root/p;b=f.read_bytes();sha=gh('blob',b);mode='100755' if f.stat().st_mode&stat.S_IXUSR else '100644'
 if p not in own and p not in incoming: assert (sha,mode)==(old[p]['sha'],old[p]['mode']),p
 if p in incoming and p!='prisma/schema.prisma':assert sha==incoming[p]['sha'],p
 if p in own or p in incoming:
  bindings.append({'path':p,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'blob':sha,'mode':mode,'origin':'own' if p in own else 'integration'})
 if p not in old or (sha,mode)!=(old[p]['sha'],old[p]['mode']):
  changes.append(p);e={'path':p,'mode':mode,'type':'blob'}
  if p in incoming and p!='prisma/schema.prisma':e['sha']=sha
  else:e['content']=b.decode()
  elements.append(e)
 parentpath,_,name=p.rpartition('/');dirs.setdefault(parentpath,[]).append((name,mode,sha,False))
 parentpath=p.rpartition('/')[0]
 while parentpath:dirs.setdefault(parentpath,[]);parentpath=parentpath.rpartition('/')[0]
for p in sorted((p for p in dirs if p),key=lambda p:p.count('/'),reverse=True):
 body=b''.join(m.encode()+b' '+n.encode()+b'\0'+bytes.fromhex(h) for n,m,h,isdir in sorted(dirs[p],key=lambda x:(x[0]+('/' if x[3] else '')).encode()))
 h=gh('tree',body);parentpath,_,name=p.rpartition('/');dirs.setdefault(parentpath,[]).append((name,'40000',h,True))
body=b''.join(m.encode()+b' '+n.encode()+b'\0'+bytes.fromhex(h) for n,m,h,isdir in sorted(dirs[''],key=lambda x:(x[0]+('/' if x[3] else '')).encode()))
proof={'parent':'8053702bbde2a43da537e263630f8a81ded2b659','main':'5c7412266c29a53e12963621b090c4f1aee95a3a','tree':gh('tree',body),'allLocalBlobsVerified':len(paths),'allTreesRecomputed':len(dirs),'unchangedParentBlobs':len(old)-len(set(old)&set(changes)),'changed':changes,'bindings':bindings,'scope':'entire candidate bytes/modes; incoming migration unchanged; schema clean three-way integration; no baseline/Support changes'}
pathlib.Path('/tmp/hrm-fault-source-freeze.json').write_text(json.dumps(proof,indent=2)+'\n')
pathlib.Path('/tmp/hrm-fault-tree-elements.json').write_text(json.dumps(elements,ensure_ascii=False)+'\n')
chunks=pathlib.Path('/tmp/hrm-fault-source-chunks');chunks.mkdir(exist_ok=True)
payload=pathlib.Path('/tmp/hrm-fault-tree-elements.json').read_text()
for i in range(0,len(payload),18000):(chunks/f'{i//18000:03d}.json').write_text(json.dumps(payload[i:i+18000],ensure_ascii=False))
print(json.dumps({k:v for k,v in proof.items() if k not in ['bindings','changed']}));print('changed paths',len(changes),'payload characters',len(payload),'chunks',(len(payload)+17999)//18000)
