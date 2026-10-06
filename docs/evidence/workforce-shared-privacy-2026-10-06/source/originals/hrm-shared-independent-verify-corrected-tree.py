import json,hashlib,pathlib,stat
root=pathlib.Path('/workspace/hrm-shared-privacy')
remote=json.load(open('/tmp/hrm-shared-corrected-independent-remote-1.json'))
parent=json.load(open('/tmp/hrm-fault-b896-independent-tree.json'))
freeze=json.load(open('/tmp/hrm-shared-source-freeze.json'))
assert not remote['truncated']
blobs={x['path']:x for x in remote['tree'] if x['type']=='blob'}
old={x['path']:x for x in parent['tree'] if x['type']=='blob'}
changed=sorted(p for p,x in blobs.items() if p not in old or (x['sha'],x['mode'])!=(old[p]['sha'],old[p]['mode']))
matches=[];mismatch=[]
for p,x in blobs.items():
 f=root/p;b=f.read_bytes();sha=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest();mode='100755' if f.stat().st_mode&stat.S_IXUSR else '100644'
 (matches if (sha,mode)==(x['sha'],x['mode']) else mismatch).append(p)
entries={x['path']:x for x in remote['tree']};computed={p:x['sha'] for p,x in blobs.items()}
dirs=['']+[x['path'] for x in remote['tree'] if x['type']=='tree']
for d in sorted(dirs,key=lambda p:len(p.split('/')) if p else 0,reverse=True):
 children=[(p[len(d)+1:] if d else p,x) for p,x in entries.items() if p.rpartition('/')[0]==d]
 children.sort(key=lambda z:(z[0]+('/' if z[1]['type']=='tree' else '')).encode())
 raw=b''.join((('40000' if x['type']=='tree' else x['mode'])+' '+n).encode()+b'\0'+bytes.fromhex(computed[(d+'/' if d else '')+n]) for n,x in children)
 computed[d]=hashlib.sha1(b'tree '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 assert computed[d]==(remote['sha'] if not d else entries[d]['sha'])
out={'remoteTree':remote['sha'],'blobCount':len(blobs),'treesRecomputed':len(dirs),'localMatching':len(matches),'mismatch':mismatch,'changed':changed,'removed':sorted(set(old)-set(blobs)),'unchanged':len(blobs)-len(changed),'bindingMatches':[]}
for b in freeze['bindings']:
 raw=(root/b['path']).read_bytes();out['bindingMatches'].append({'path':b['path'],'matches':hashlib.sha256(raw).hexdigest()==b['sha256']})
json.dump(out,open('/tmp/hrm-shared-independent-tree-proof-2d723.json','w'),indent=2)
print(json.dumps({k:v for k,v in out.items() if k not in ['changed','bindingMatches']}))
