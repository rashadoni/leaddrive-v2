import os,json,pathlib,subprocess,secrets,tempfile,time,hashlib
root=pathlib.Path('/workspace/hrm-c12-acceptance-20261006'); out=pathlib.Path('/tmp/hrm-c12-acceptance-20261006'); container=None
paths=sorted(list(root.glob('src/lib/workforce/reconciliation*.ts'))+list(root.glob('src/__tests__/workforce-reconciliation*.test.ts'))+[root/'prisma/schema.prisma',root/'prisma/migrations/20261005193000_workforce_reconciliation_operations/migration.sql'])
def bindings():return [{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
proof={'status':'RUNNING','fixture':'isolated existing selected-DDL regression suites; not historical staging','sourceBindings':bindings()}
def command(args,**kw):
 r=subprocess.run(args,capture_output=True,text=True,timeout=120,**kw)
 if r.returncode:raise RuntimeError('OWNED_FIXTURE_COMMAND_FAILED')
 return r.stdout.strip()
try:
 with tempfile.TemporaryDirectory(prefix='hrm-c12-regression-') as tmp:
  password=secrets.token_hex(24); envfile=pathlib.Path(tmp)/'postgres.env'; envfile.write_text('POSTGRES_PASSWORD='+password+'\n');envfile.chmod(0o600)
  image='sha256:f1447071e6c8449dcf4056aa0994c81d3566ce5ee232de36b04dc25696a116dd'
  container=command(['docker','run','--detach','--memory','2g','--cpus','2','--publish','127.0.0.1::5432','--env-file',str(envfile),image])
  binding=command(['docker','port',container,'5432/tcp']);assert binding.startswith('127.0.0.1:')
  for i in range(80):
   if subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
   time.sleep(.25)
  else:raise RuntimeError('OWNED_FIXTURE_NOT_READY')
  dbs={'WORKFORCE_EXPORT_AUDIT_TEST_DATABASE_URL':'hrm_export_audit_test','WORKFORCE_CURSOR_TEST_DATABASE_URL':'hrm_cursor_fencing_test','WORKFORCE_ROSTER_HEALTH_TEST_DATABASE_URL':'hrm_roster_health_test','WORKFORCE_RECONCILIATION_SWEEP_TEST_DATABASE_URL':'hrm_reconciliation_sweep_test','WORKFORCE_APPROVAL_GROUP_TEST_DATABASE_URL':'hrm_approval_group_test'}
  env=os.environ.copy()
  for key,db in dbs.items():
   command(['docker','exec',container,'createdb','-U','postgres',db]); env[key]=f'postgresql://postgres:{password}@{binding}/{db}'
  raw=out/'regression-final-private.json'; started=time.monotonic()
  r=subprocess.run([str(root/'node_modules/.bin/vitest'),'run',*map(lambda p:str(p.relative_to(root)),root.glob('src/__tests__/workforce-reconciliation*.test.ts')),'--maxWorkers=1','--reporter=json','--outputFile='+str(raw)],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
  raw.chmod(0o600); data=json.loads(raw.read_text())
  proof.update({'exitCode':r.returncode,'elapsedSeconds':round(time.monotonic()-started,2),'tests':data['numTotalTests'],'pass':data['numPassedTests'],'failed':data['numFailedTests'],'skipped':data['numPendingTests'],'files':[{'name':pathlib.Path(x['name']).name,'status':x['status'],'tests':len(x['assertionResults']),'failedNames':[a['fullName'] for a in x['assertionResults'] if a['status']=='failed']} for x in data['testResults']]})
  assert bindings()==proof['sourceBindings'];assert r.returncode==0 and data['numTotalTests']==152 and data['numPassedTests']==152 and data['numPendingTests']==0
  proof['status']='PASS_152_ZERO_SKIP'
except Exception as e:proof['status']='FAIL';proof['failureClass']=type(e).__name__
finally:
 if container:
  r=subprocess.run(['docker','rm','--force','--volumes',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30);proof['cleanup']='PASS' if r.returncode==0 else 'FAIL'
 if proof.get('cleanup')!='PASS':proof['status']='FAIL'
 (out/'existing-pg-regression-final.json').write_text(json.dumps(proof,indent=2)+'\n')
 print(json.dumps({k:v for k,v in proof.items() if k!='sourceBindings'}))
