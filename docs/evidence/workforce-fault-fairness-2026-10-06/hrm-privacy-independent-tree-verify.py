import json,pathlib,hashlib,stat
r=pathlib.Path('/workspace/hrm-privacy-audit');m=json.load(open('/tmp/hrm-privacy-independent-remote-tree.json'));old=json.load(open('/tmp/hrm-request-independent-remote-tree.json'));commit=json.load(open('/tmp/hrm-privacy-independent-remote-commit.json'));assert not m['truncated'];assert commit['parents'][0]['sha']=='ef5d90010d9b317a493dfe7ae574b1863f3c83fb';assert len(commit['parents'])==1
blobs={x['path']:x for x in m['tree'] if x['type']=='blob'};base={x['path']:x for x in old['tree'] if x['type']=='blob'};trees={x['path']:x['sha'] for x in m['tree'] if x['type']=='tree'};dirs={}
for p,e in blobs.items():
 f=r/p;b=f.read_bytes();h=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest();assert h==e['sha'],p
 mode='100755' if f.stat().st_mode & stat.S_IXUSR else '100644';assert mode==e['mode'],p
 parent,_,name=p.rpartition('/');dirs.setdefault(parent,[]).append((name,mode,h,False))
for p in sorted(trees,key=lambda x:x.count('/'),reverse=True):
 children=dirs.get(p,[]);body=b''.join(mode.encode()+b' '+name.encode()+b'\0'+bytes.fromhex(h) for name,mode,h,isdir in sorted(children,key=lambda x:(x[0]+('/' if x[3] else '')).encode()))
 h=hashlib.sha1(b'tree '+str(len(body)).encode()+b'\0'+body).hexdigest();assert h==trees[p],p
 parent,_,name=p.rpartition('/');dirs.setdefault(parent,[]).append((name,'40000',h,True))
body=b''.join(mode.encode()+b' '+name.encode()+b'\0'+bytes.fromhex(h) for name,mode,h,isdir in sorted(dirs[''],key=lambda x:(x[0]+('/' if x[3] else '')).encode()));h=hashlib.sha1(b'tree '+str(len(body)).encode()+b'\0'+body).hexdigest();assert h==m['sha']==commit['tree']['sha']
changed=[p for p,e in blobs.items() if p in base and (e['sha'],e['mode'])!=(base[p]['sha'],base[p]['mode'])];new=sorted(set(blobs)-set(base));removed=sorted(set(base)-set(blobs));assert len(changed)==36 and len(new)==6 and not removed
proof={'head':commit['sha'],'tree':h,'parent':commit['parents'][0]['sha'],'allLocalBlobBytesAndModesVerified':len(blobs),'allGitTreesRecomputed':len(trees)+1,'unchangedParentBlobs':len(base)-len(changed),'modified':changed,'added':new,'deleted':removed}
p=pathlib.Path('/tmp/hrm-privacy-independent-full-tree-proof.json');p.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({k:v for k,v in proof.items() if k not in ['modified','added']}))
