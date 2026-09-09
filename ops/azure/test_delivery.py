import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('definitions',HERE/'generate-definitions.py')
defs=importlib.util.module_from_spec(spec);spec.loader.exec_module(defs)
class DeliveryTests(unittest.TestCase):
 def test_untrusted_definition_has_no_secrets_or_oauth(self):
  d=defs.checks
  self.assertEqual(d['process']['type'],1)
  self.assertEqual(d['variableGroups'],[])
  self.assertFalse(d['process']['phases'][0]['target']['allowScriptsAuthAccessOption'])
  scripts='\n'.join(s.get('inputs',{}).get('script','') for s in d['process']['phases'][0]['steps'])
  self.assertNotIn('bash scripts/',scripts)
  self.assertNotIn('npm ',scripts)
  self.assertNotIn('SSH_PRIVATE_KEY',json.dumps(d))
  self.assertIn('/usr/local/bin/leaddrive-azure-ci validate',scripts)
 def test_release_has_main_guard_before_code(self):
  s=defs.release['process']['phases'][0]['steps']
  self.assertIn('test "$BUILD_SOURCEBRANCH" = refs/heads/main',s[0]['inputs']['script'])
  self.assertTrue(defs.release['triggers'][0]['batchChanges'])
  self.assertNotIn('SSH_PRIVATE_KEY',json.dumps(defs.release))
 def test_review_script_is_embedded_not_candidate_file(self):
  scripts='\n'.join(s.get('inputs',{}).get('script','') for s in defs.review['process']['phases'][0]['steps'])
  self.assertIn('base64 --decode',scripts)
  self.assertNotIn('node .github/scripts/agent-review.mjs',scripts)
  self.assertIn('git show "$LD_BASE_SHA:.gitleaks.toml"',scripts)
 def test_container_has_no_socket_or_agent_home(self):
  s=(HERE/'ci-container.sh').read_text()
  self.assertNotIn('/var/run/docker.sock',s)
  self.assertIn('dst=/source-ro,readonly',s)
  self.assertIn('--memory=18g --memory-swap=18g',s)
  self.assertIn('flock -w 30',s)
  self.assertIn('trap cleanup EXIT',s)
 def test_candidate_handles_docs_merge_and_sha_mismatch(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);repo=p/'repo';repo.mkdir();reports=p/'reports';reports.mkdir()
   def git(*a):return subprocess.check_output(['git','-C',str(repo),*a],stderr=subprocess.DEVNULL,text=True).strip()
   git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid')
   (repo/'base.txt').write_text('base');git('add','base.txt');git('commit','-m','base')
   git('checkout','-b','docs');(repo/'notes.md').write_text('note');git('add','notes.md');git('commit','-m','docs')
   git('checkout','main');git('merge','--no-ff','docs','-m','synthetic merge')
   env={**os.environ,'BUILD_SOURCEVERSION':git('rev-parse','HEAD'),'BUILD_REASON':'PullRequest','SYSTEM_PULLREQUEST_TARGETBRANCH':'refs/heads/main','BUILD_ARTIFACTSTAGINGDIRECTORY':str(reports)}
   r=subprocess.run(['python3',str(HERE/'resolve-candidate.py')],cwd=repo,env=env,capture_output=True)
   self.assertEqual(r.returncode,0,r.stderr)
   self.assertFalse(json.loads((reports/'candidate.json').read_text())['heavy'])
   env['BUILD_SOURCEVERSION']='0'*40
   r=subprocess.run(['python3',str(HERE/'resolve-candidate.py')],cwd=repo,env=env,capture_output=True)
   self.assertNotEqual(r.returncode,0)
if __name__=='__main__':unittest.main()
